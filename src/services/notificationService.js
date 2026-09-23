import { SnowflakeUtil } from "discord.js";
import pLimit from "p-limit";

import { CONFIG_VALUES, config } from "../config/index.js";
import { getUsersFollowingMap } from "../db/index.js";
import { createBaseEmbed, formatPlayerCounts } from "../embeds/baseEmbed.js";
import { mapNameSchema } from "../schemas/validationSchemas.js";
import { getTerminalReason, isRecipientRefusal, isRetryableDiscordError, TerminalError } from "../utils/discordErrors.js";
import { serviceLogger } from "../utils/logger.js";
import { getMapImage } from "../utils/mapUtils.js";
import { validateChannelForSend } from "../utils/permissions.js";
import { withRetry } from "../utils/retry.js";
import { validateWithZod } from "../utils/zodValidator.js";
import { checkRateLimit, isDmRefused, markDmRefused } from "./cacheService.js";

let botInstance = null;

// Per user per map per minute. Not configurable: above 1 just resends the
// duplicate. The overall ceiling is RATE_LIMIT_NOTIFICATION_PER_MINUTE.
const NOTIFICATION_MAX_PER_MAP = 1;

// Concurrent DM sends per map change. Not configurable: discord.js's REST queue
// is the real throttle, so a larger number only queues deeper.
const NOTIFICATION_CONCURRENCY = 5;

/**
 * What became of one recipient's DM. Only `failed` and `refused` reach the
 * fallback channel; a suppressed duplicate is a deliberate drop.
 */
const DELIVERY = Object.freeze({
    delivered: "delivered",
    failed: "failed",
    refused: "refused",
    suppressed: "suppressed"
});

/** @param {import('discord.js').Client} bot */
export function initNotificationService(bot) {
    botInstance = bot;
}

/**
 * @param {string} mapName - As normalized by getInfo
 * @param {object} serverObj
 * @param {import('discord.js').Client} [bot] - Defaults to the initNotificationService client
 * @returns {Promise<void>}
 */
export async function notifyUsers(mapName, serverObj, bot = botInstance) {
    const server = serverObj?.nick ?? "unknown server";

    // gamedig's connect address when there is one: the configured ip may omit the
    // port, and steam://connect needs the port the game actually listens on.
    const ip = serverObj?.fullIP ?? serverObj?.ip ?? "unknown IP";

    // Names the follow schema rejects have no followers. Returned, not thrown: an
    // escaping throw would stall map-change detection for this server.
    const validatedMap = validateWithZod(mapNameSchema, mapName, "notifyUsers/map");
    if (!validatedMap.valid) {
        serviceLogger.debug({ map: mapName, reason: validatedMap.error, server }, "Skipping notifications for unfollowable map name");
        return;
    }

    const followers = getUsersFollowingMap(validatedMap.data);

    // Dropped before the cap, so the fanout budget goes to users who can receive a DM.
    const deliverable = followers.filter((follower) => !isDmRefused(follower.discord_id));
    const inCooldown = followers.length - deliverable.length;

    const recipients = deliverable.slice(0, CONFIG_VALUES.MAX_NOTIFICATION_RECIPIENTS);
    const overCap = deliverable.length - recipients.length;
    if (overCap > 0) {
        serviceLogger.warn(
            {
                cap: CONFIG_VALUES.MAX_NOTIFICATION_RECIPIENTS,
                map: mapName,
                notified: recipients.length,
                server,
                skipped: overCap
            },
            "Notification fanout truncated by MAX_NOTIFICATION_RECIPIENTS"
        );
    }

    // The validated lowercase name, the form follows are stored under.
    const mapImage = getMapImage(validatedMap.data);

    const event = { bot, ip, mapImage, mapName, server, serverObj, validatedMapName: validatedMap.data };

    // This is about our own wall clock, not about protecting Discord: discord.js's
    // REST queue already enforces the global rate limit and sleeps on a 429.
    const limit = pLimit(NOTIFICATION_CONCURRENCY);
    const outcomes = await Promise.all(recipients.map((user) => limit(() => deliverNotification(user, event))));

    // One fallback message per map change, not one per failing recipient.
    const undeliverable = tallyUndeliverable(outcomes, inCooldown, overCap);
    if (undeliverable.total > 0) {
        await sendFallbackNotification(event, undeliverable);
    }
}

/**
 * The DM a map change sends, to one user only and outside the rate limits.
 * @param {import('discord.js').User} user
 * @param {string} map - A name mapNameSchema accepted
 * @returns {Promise<void>}
 */
export async function sendTestNotification(user, map) {
    const serverObj = { ip: "0.0.0.0:27015", nick: "Test Server" };
    const event = { ip: serverObj.ip, mapImage: getMapImage(map), mapName: map, server: serverObj.nick, serverObj };

    await user.send({ content: buildNotificationContent(event), embeds: [buildMapNotificationEmbed(event)] });
}

/**
 * @param {string[]} outcomes - One DELIVERY value per attempted recipient
 * @param {number} inCooldown - Recipients skipped before the attempt
 * @param {number} overCap - Followers past MAX_NOTIFICATION_RECIPIENTS
 * @returns {{failed: number, inCooldown: number, overCap: number, refused: number, total: number}}
 */
function tallyUndeliverable(outcomes, inCooldown, overCap) {
    const failed = outcomes.filter((outcome) => outcome === DELIVERY.failed).length;
    const refused = outcomes.filter((outcome) => outcome === DELIVERY.refused).length;

    return { failed, inCooldown, overCap, refused, total: failed + refused + inCooldown + overCap };
}

/**
 * One line, so the channel message says who missed out rather than only
 * repeating the announcement.
 * @param {object} undeliverable - Tally from tallyUndeliverable
 * @param {number} undeliverable.failed
 * @param {number} undeliverable.inCooldown
 * @param {number} undeliverable.overCap
 * @param {number} undeliverable.refused
 * @param {number} undeliverable.total
 * @returns {string}
 */
function describeUndeliverable({ failed, inCooldown, overCap, refused, total }) {
    const parts = [];
    if (refused > 0) parts.push(`${refused} refused the DM`);
    if (inCooldown > 0) parts.push(`${inCooldown} skipped after an earlier refusal`);
    if (failed > 0) parts.push(`${failed} failed`);
    if (overCap > 0) parts.push(`${overCap} over the recipient cap`);

    return `_${total} follower${total === 1 ? "" : "s"} could not be DMed: ${parts.join(", ")}._`;
}

/**
 * The DM and the fallback message show the same thing, so both call this.
 * @param {object} event - Loop-invariant details shared by every recipient
 * @param {string|false} event.mapImage
 * @param {string} event.mapName
 * @param {string} event.server
 * @param {object} event.serverObj
 * @returns {import('discord.js').EmbedBuilder}
 */
function buildMapNotificationEmbed({ mapImage, mapName, server, serverObj }) {
    const embed = createBaseEmbed(`${mapName} is now on ${server}`)
        .setDescription(`**__Players:__** ${formatPlayerCounts(serverObj)}`);

    if (mapImage) embed.setImage(mapImage);

    return embed;
}

/**
 * Carries the connect link, which an embed cannot make clickable.
 * @param {object} event - Loop-invariant details shared by every recipient
 * @param {string} event.ip
 * @param {string} event.mapName
 * @param {string} event.server
 * @returns {string}
 */
function buildNotificationContent({ ip, mapName, server }) {
    return `${mapName} is now on ${server}!\nsteam://connect/${ip}`;
}

/**
 * Reports its outcome rather than throwing, so one bad recipient cannot abandon
 * the rest of the fanout.
 * @param {object} user - Follow row with a discord_id
 * @param {object} event - Loop-invariant details shared by every recipient
 * @returns {Promise<string>} - One of the DELIVERY values
 */
async function deliverNotification(user, event) {
    const { bot, mapName, server, validatedMapName } = event;

    try {
        // Keyed per map, so a user following three maps that rotate together
        // hears about all three; only a repeat of the same map is suppressed.
        const perMap = checkRateLimit(user.discord_id, `notification:${validatedMapName}`, NOTIFICATION_MAX_PER_MAP);
        if (!perMap.allowed) {
            serviceLogger.debug(
                { map: mapName, server, userId: user.discord_id },
                "Skipping duplicate notification for the same map"
            );
            return DELIVERY.suppressed;
        }

        // Checked second so a suppressed duplicate spends none of the ceiling.
        const perUser = checkRateLimit(user.discord_id, "notification", CONFIG_VALUES.NOTIFICATION_RATE_LIMIT_PER_MINUTE);
        if (!perUser.allowed) {
            serviceLogger.warn(
                {
                    limit: CONFIG_VALUES.NOTIFICATION_RATE_LIMIT_PER_MINUTE,
                    map: mapName,
                    retryAfter: perUser.retryAfter,
                    server,
                    userId: user.discord_id
                },
                "Notification dropped: user is at their per-minute notification limit"
            );
            return DELIVERY.suppressed;
        }

        // Mentions denied: the map name and server nick come from the game
        // server, and escapeForDiscord neutralizes markdown but not "@".
        await bot.users.send(user.discord_id, {
            allowedMentions: { parse: [] },
            content: buildNotificationContent(event),
            embeds: [buildMapNotificationEmbed(event)]
        });

        serviceLogger.info({ map: mapName, userId: user.discord_id }, "Sent notification");
        return DELIVERY.delivered;
    } catch (e) {
        const userId = user.discord_id;
        const reason = getTerminalReason(e);

        if (isRecipientRefusal(e)) {
            // Only the recipient can undo a refusal, so skip them until the cooldown expires.
            markDmRefused(userId);
            serviceLogger.warn({ err: e, map: mapName, userId }, `DM refused by Discord, skipping this recipient until the cooldown expires. ${reason}`);
            return DELIVERY.refused;
        }

        if (reason) {
            serviceLogger.warn({ err: e, map: mapName, userId }, `DM cannot be delivered, not retrying. ${reason}`);
        } else {
            serviceLogger.warn({ err: e, map: mapName, userId }, "Failed to send DM to user");
        }

        return DELIVERY.failed;
    }
}

/**
 * Fetches on a cache miss: the cache only holds channels the gateway has mentioned,
 * so after a restart a cache-only lookup fails until that channel sees activity.
 * @param {import('discord.js').Client} bot
 * @returns {Promise<object>} - The resolved channel
 * @throws {TerminalError} If the channel does not resolve, or is in another guild
 */
async function resolveFallbackChannel(bot) {
    const { channelID } = config.fallback;
    const guildID = config.discord.guildID;

    const channel = bot.channels.cache.get(channelID) ?? (await bot.channels.fetch(channelID));
    if (!channel) {
        throw new TerminalError(
            `Fallback channel ${channelID} not found`,
            `FALLBACK_CHANNEL_ID ${channelID} does not resolve to a channel the bot can see; check the ID and that the channel is in guild ${guildID}`
        );
    }

    // Checked rather than assumed: fetch() also resolves DM channels, and an ID
    // left over from a guild the bot has since left would fail further in.
    const channelGuildID = channel.guildId ?? channel.guild?.id;
    if (channelGuildID !== guildID) {
        throw new TerminalError(
            `Fallback channel ${channelID} is in guild ${channelGuildID}, not the served guild ${guildID}`,
            `FALLBACK_CHANNEL_ID ${channelID} is not a channel in guild ${guildID}; point it at one there`
        );
    }

    return channel;
}

/**
 * The one message per map change covering every recipient it could not reach.
 * @param {object} event - Loop-invariant details shared by every recipient
 * @param {{failed: number, inCooldown: number, overCap: number, refused: number, total: number}} undeliverable
 * @returns {Promise<void>}
 */
async function sendFallbackNotification(event, undeliverable) {
    // The client threaded through from notifyUsers, not module-level botInstance,
    // so an explicitly passed client is honoured.
    const { bot, mapName } = event;

    // Without this, an unconfigured fallback costs three retried throws with backoff.
    if (!config.fallback.channelID) {
        serviceLogger.debug({ map: mapName, undeliverable: undeliverable.total }, "No fallback channel configured, skipping fallback notification");
        return;
    }

    // No init and no client passed. Without this, withRetry burns three TypeErrors.
    if (!bot) {
        serviceLogger.error({ map: mapName }, "No Discord client available, skipping fallback notification");
        return;
    }

    // One nonce for every attempt, so a retried post returns the first instead of repeating it.
    const nonce = SnowflakeUtil.generate().toString();

    try {
        await withRetry(async () => {
            const channel = await resolveFallbackChannel(bot);
            // Terminal: another attempt cannot grant a missing permission.
            const permCheck = validateChannelForSend(channel);
            if (!permCheck.valid) {
                throw new TerminalError(
                    `Fallback channel permission error: ${permCheck.error}`,
                    `${permCheck.error} in the fallback channel ${config.fallback.channelID}; grant the bot those permissions there`
                );
            }
            // As with the DM, and it matters more here: an @everyone slipping
            // through would reach the whole guild.
            await channel.send({
                allowedMentions: { parse: [] },
                content: `${buildNotificationContent(event)}\n${describeUndeliverable(undeliverable)}`,
                embeds: [buildMapNotificationEmbed(event)],
                enforceNonce: true,
                nonce
            });
        }, { isRetryable: isRetryableDiscordError });

        serviceLogger.info({ map: mapName, ...undeliverable }, "Sent one fallback notification for the undeliverable recipients");
    } catch (fallbackError) {
        const reason = getTerminalReason(fallbackError);
        if (reason) {
            serviceLogger.error({ err: fallbackError, map: mapName }, `Fallback notification cannot succeed and will not be retried. ${reason}`);
        } else {
            serviceLogger.error({ err: fallbackError, map: mapName }, "Failed to send fallback notification");
        }
    }
}
