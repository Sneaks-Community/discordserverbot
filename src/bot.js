import Discord, { Events, GatewayIntentBits, Options, Partials, RESTJSONErrorCodes, SnowflakeUtil } from "discord.js";

import { registerSlashCommands, handleInteraction } from "./commands/index.js";
import { config, validateConfig } from "./config/index.js";
import { initDB, closeDB, unfollowAll, clearEmbedMessage, getEmbedMessage, setEmbedMessage } from "./db/index.js";
import { makeEmbed } from "./embeds/serverEmbeds.js";
import { startCleanupInterval, clearCleanupInterval } from "./services/cacheService.js";
import { reconcileFollows } from "./services/followReconciliation.js";
import { recordTick, startHealthServer, stopHealthServer } from "./services/healthService.js";
import { notifyUsers, initNotificationService } from "./services/notificationService.js";
import { refresh, getServerData, updateServerData } from "./services/serverService.js";
import { getTerminalReason, TerminalError } from "./utils/discordErrors.js";
import { botLogger, flushLogs } from "./utils/logger.js";
import { findChannelProblem, STATUS_PERMISSIONS } from "./utils/permissions.js";

let embedInterval = null;

/**
 * Sent with IDENTIFY, so it applies from login and on every reconnect. discord.js
 * maps a Custom activity's `name` to its `state`, so `name` covers every type.
 * @returns {import('discord.js').PresenceData}
 */
function buildPresence() {
    const { botActivityText: text, botActivityType: type } = config;

    return { activities: text ? [{ name: text, type }] : [] };
}

// Cache growth here is measured in weeks of uptime, so hourly is ample.
const CACHE_SWEEP_INTERVAL_SECONDS = 3600;

const MESSAGE_CACHE_LIFETIME_SECONDS = 7200;

/**
 * Matches every cache entry but the bot's own. A GuildMember's id is its user's
 * id, so this reads the same for the user and member caches.
 * @param {{ id: string }} entry - A cached user or member
 * @returns {boolean} - Whether the entry may be swept
 */
function isNotClient(entry) {
    return entry.id !== bot.user?.id;
}

// discord.js calls a sweeper's filter once per sweep, then uses what it returns.
const sweepAllButClient = () => isNotClient;

const bot = new Discord.Client({
    // Server and map names come straight from the game servers; deny mentions on every send.
    allowedMentions: { parse: [] },
    intents: [
        GatewayIntentBits.Guilds,
        // Privileged, for guildMemberRemove: enable "Server Members Intent" in the
        // Developer Portal or login fails with "Used disallowed intents".
        GatewayIntentBits.GuildMembers
    ],
    partials: [Partials.GuildMember],
    presence: buildPresence(),
    // discord.js leaves the user and member caches unbounded by default. Everything
    // swept here is re-fetched on demand.
    sweepers: {
        ...Options.DefaultSweeperSettings,
        // Keep the bot's own member: if swept, guild.members.me becomes a roleless
        // partial and permission checks under-report.
        guildMembers: { filter: sweepAllButClient, interval: CACHE_SWEEP_INTERVAL_SECONDS },
        messages: { interval: CACHE_SWEEP_INTERVAL_SECONDS, lifetime: MESSAGE_CACHE_LIFETIME_SECONDS },
        users: { filter: sweepAllButClient, interval: CACHE_SWEEP_INTERVAL_SECONDS }
    }
});

/**
 * Rejects rather than exits on startup failure; index.js owns the exit.
 * @throws {ConfigError} If the configuration is unusable
 */
export async function initBot() {
    validateConfig();
    initDB();
    initNotificationService(bot);

    // Awaited so a bad token or disallowed intents rejects initBot. Pino redacts
    // only object keys, so never interpolate the token into a message.
    await bot.login(config.discordToken);
}

bot.on(Events.ClientReady, async () => {
    try {
        botLogger.info("Started as " + bot.user.tag);

        // First: guilds joined while offline emit no guildCreate, so only this catches them.
        await enforceSingleGuild();

        // Before the first tick, so a wedge in the steps below still answers.
        startHealthServer(bot);

        // Non-fatal: Discord keeps the registered commands, so a failed PUT must not
        // crash-loop the bot.
        try {
            await registerSlashCommands(bot);
        } catch (err) {
            botLogger.error({ err }, "Failed to register slash commands; continuing with the set Discord already has");
        }

        await intervalFunction();
        embedInterval = setInterval(intervalFunction, config.serverUpdateIntervalMs);
        startCleanupInterval();

        // Not awaited: a full member fetch is slow and nothing depends on it.
        void reconcileFollows(bot);
    } catch (err) {
        botLogger.fatal({ err }, "Failed during ready initialization");
        void gracefulShutdown("ready failure", 1);
    }
});

/**
 * Map-change detection shares this tick so it reads the snapshot refresh() just
 * wrote. Each later step is isolated so a broken embed cannot block notifications.
 */
async function intervalFunction() {
    recordTick();

    let refreshed;

    try {
        refreshed = await refresh();
    } catch (err) {
        botLogger.error({ err }, "Failed to refresh server data");
        return;
    }

    // A skipped pass read nothing new; republishing would only bump the "Last Updated" footer.
    if (refreshed) {
        let embed = null;

        try {
            embed = makeEmbed(getServerData());
        } catch (err) {
            botLogger.error({ err }, "Failed to build the server embed; skipping the embed update for this tick");
        }

        if (embed) {
            await publishEmbed(embed);
        }
    }

    // Still runs on a skipped pass: a map change the previous tick could not
    // notify on (fanout still running) is detected here rather than deferred.
    try {
        await updateServerData(notifyUsers);
    } catch (err) {
        botLogger.error({ err }, "Failed to check for map changes");
    }
}

/**
 * @param {import('discord.js').TextChannel} channel
 * @param {string} messageId
 * @param {import('discord.js').EmbedBuilder} embed
 * @returns {Promise<boolean>} - False if a new message must replace it; other failures throw
 */
async function editTrackedMessage(channel, messageId, embed) {
    try {
        const message = await channel.messages.fetch(messageId);
        await message.edit({ embeds: [embed] });
        return true;
    } catch (err) {
        // getTerminalReason treats this code as terminal; here a deleted
        // message is recoverable by posting another.
        if (err?.code === RESTJSONErrorCodes.UnknownMessage) {
            botLogger.warn({ channelId: channel.id, messageId }, "The server list message is gone; posting a new one");
            return false;
        }

        // Happens after a bot token change with the database kept.
        if (err?.code === RESTJSONErrorCodes.CannotEditMessageAuthoredByAnotherUser) {
            botLogger.warn({ channelId: channel.id, messageId }, "The server list message was posted by another account and cannot be edited; posting a new one (delete the old one by hand)");
            return false;
        }

        throw err;
    }
}

let isPublishing = false;

/**
 * Keeps EMBED_CHANNEL_ID holding one up-to-date server list message. Not retried
 * here: @discordjs/rest already retries 5xx and timeouts, and the next tick is the retry.
 * @param {import('discord.js').EmbedBuilder} embed
 * @returns {Promise<void>}
 */
async function publishEmbed(embed) {
    const channelId = config.embedChannelId;

    // Empty means the feature is off, which validateConfig already warned about.
    if (!channelId) {
        return;
    }

    // A publish can outlast a tick, and two with no tracked message would both post.
    if (isPublishing) {
        botLogger.debug("Skipping embed update -- the previous one is still in progress");
        return;
    }

    isPublishing = true;
    try {
        const channel = await bot.channels.fetch(channelId);

        // Terminal, so the log names the fix rather than a bare failure.
        const problem = findChannelProblem(channel, STATUS_PERMISSIONS);
        if (problem) {
            throw new TerminalError(
                `Permission check failed for channel ${channelId}: ${problem}`,
                `${problem} in channel ${channelId}; grant the bot those permissions there`
            );
        }

        const tracked = getEmbedMessage();

        // EMBED_CHANNEL_ID changed. The old message is left frozen, not deleted
        // from a channel the bot is no longer configured for.
        if (tracked && tracked.channelId !== channelId) {
            botLogger.info({ channelId, previousChannelId: tracked.channelId }, "EMBED_CHANNEL_ID changed; posting a new server list and abandoning the old message");
            clearEmbedMessage();
        } else if (tracked && await editTrackedMessage(channel, tracked.messageId, embed)) {
            return;
        }

        // When REST re-sends a timed-out post, the nonce makes Discord return the first message.
        const message = await channel.send({ embeds: [embed], enforceNonce: true, nonce: SnowflakeUtil.generate().toString() });

        // Not left to the catch below: the post succeeded, so that log would mislead.
        try {
            setEmbedMessage(channelId, message.id);
        } catch (err) {
            botLogger.error({ channelId, err, messageId: message.id }, "Posted the server list but could not record its ID; the next update will post another");
        }
    } catch (err) {
        const reason = getTerminalReason(err);
        if (reason) {
            botLogger.error({ channelId, err }, `Embed update cannot succeed until this is fixed. ${reason}`);
        } else {
            botLogger.error({ channelId, err }, "Failed to update embed; the next tick will try again");
        }
    } finally {
        isPublishing = false;
    }
}

/** @param {import('discord.js').Guild} guild */
async function leaveOtherGuild(guild) {
    botLogger.warn({ guildId: guild.id, guildName: guild.name }, "Leaving a guild this instance does not serve");

    try {
        await guild.leave();
    } catch (err) {
        botLogger.error({ err, guildId: guild.id }, "Failed to leave that guild");
    }
}

/**
 * Leaves every guild but DISCORD_GUILD_ID. Absence from that guild is fatal, since
 * otherwise a typo in the ID would make the bot leave its real guild.
 * @throws {Error} If the bot is not in the configured guild
 */
async function enforceSingleGuild() {
    const primaryGuildId = config.discordGuildId;

    if (!bot.guilds.cache.has(primaryGuildId)) {
        throw new Error(`The bot is not in DISCORD_GUILD_ID ${primaryGuildId}; check the ID and that the bot has been invited to that guild`);
    }

    await Promise.all(bot.guilds.cache.filter((guild) => guild.id !== primaryGuildId).map(leaveOtherGuild));
}

/**
 * discord.js emits this only for genuinely new guilds while the shard is ready,
 * so a guild returning after an outage (guildAvailable) cannot trip it.
 */
bot.on(Events.GuildCreate, (guild) => {
    if (guild.id === config.discordGuildId) {
        return;
    }

    void leaveOtherGuild(guild);
});

/** Scoped to the served guild: a leave elsewhere must not wipe this guild's follows. */
bot.on(Events.GuildMemberRemove, (member) => {
    if (member.guild?.id !== config.discordGuildId) {
        return;
    }

    try {
        unfollowAll(member.id);
        botLogger.info({ guildId: member.guild?.id, userId: member.id }, "Removed follows for departed member");
    } catch (err) {
        botLogger.error({ err, guildId: member.guild?.id, userId: member.id }, "Failed to remove follows for departed member");
    }
});

bot.on(Events.InteractionCreate, async (interaction) => {
    await handleInteraction(interaction);
});

/**
 * The intervals keep running through a reconnect: server queries do not touch
 * Discord, and embed edits are REST calls that the next tick retries.
 */
bot.on(Events.ShardDisconnect, (event, shardId) => {
    // Only emitted for unrecoverable close codes. Exit so the restart policy fires
    // rather than failing every edit and DM forever.
    botLogger.fatal({ code: event.code, shardId }, "Shard disconnected and will not reconnect");
    void gracefulShutdown(`shardDisconnect(${event.code})`, 1);
});

bot.on(Events.ShardError, (error, shardId) => {
    botLogger.error({ err: error, shardId }, "Shard websocket error");
});

bot.on(Events.ShardReconnecting, (shardId) => {
    botLogger.warn({ shardId }, "Shard reconnecting to Discord");
});

bot.on(Events.ShardResume, (shardId, replayedEvents) => {
    botLogger.info({ replayedEvents, shardId }, "Shard resumed its session");
});

bot.on(Events.ShardReady, (shardId) => {
    botLogger.info({ shardId }, "Shard ready");
});

// Inside Docker's 10s default grace period, so the process exits on its own terms.
const SHUTDOWN_TIMEOUT_MS = 5000;

let isShuttingDown = false;

/**
 * @param {string} signal - What triggered the shutdown, for the log line
 * @param {number} [initialExitCode] - Non-zero when a failure caused the shutdown
 * @returns {Promise<void>}
 */
async function gracefulShutdown(signal, initialExitCode = 0) {
    if (isShuttingDown) {
        botLogger.debug(`Ignoring ${signal}, shutdown already in progress`);
        return;
    }
    isShuttingDown = true;

    botLogger.info(`Received ${signal}, shutting down...`);

    // Caps a hung destroy. Not unref'd: that would let Node exit 0 once the loop
    // empties, reporting a stalled shutdown as clean.
    const hardExit = setTimeout(async () => {
        botLogger.error(`Shutdown did not finish within ${SHUTDOWN_TIMEOUT_MS}ms, exiting anyway`);
        await flushLogs();
        process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);

    if (embedInterval) {
        clearInterval(embedInterval);
        embedInterval = null;
    }

    clearCleanupInterval();

    // Before destroy(): the listener must not outlive the shutdown.
    stopHealthServer();

    let exitCode = initialExitCode;

    try {
        await bot.destroy();
    } catch (destroyError) {
        botLogger.error({ err: destroyError }, "Failed to close the Discord connection");
        exitCode = 1;
    }

    // Separate try: the DB must close even if destroy failed, or SQLite skips its WAL checkpoint.
    try {
        closeDB();
    } catch (dbError) {
        botLogger.fatal({ err: dbError }, "Failed to close the database");
        exitCode = 1;
    }

    if (exitCode === 0) {
        botLogger.info("Shutdown complete.");
    } else {
        botLogger.warn("Shutdown complete, with errors.");
    }

    // Before clearTimeout, so hardExit still caps a hung flush.
    await flushLogs();

    clearTimeout(hardExit);
    process.exit(exitCode);
}

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

// `reason` may not be an Error; pino's err serializer passes those through unchanged.
process.on("unhandledRejection", (reason) => {
    botLogger.error({ err: reason }, "Unhandled promise rejection");
});

process.on("uncaughtException", async (err) => {
    botLogger.fatal({ err }, "Uncaught exception");

    // Best effort: an open connection skips SQLite's WAL checkpoint.
    try {
        closeDB();
    } catch (dbError) {
        botLogger.error({ err: dbError }, "Failed to close the database during crash exit");
    }

    // Registering this handler stops Node exiting on its own, so the flush can be
    // awaited; flushLogs is capped, so a broken process cannot linger here.
    await flushLogs();

    process.exit(1);
});
