import { ActionRowBuilder, ButtonBuilder, ButtonStyle, SnowflakeUtil } from "discord.js";
import pLimit from "p-limit";

import { config } from "../config/index.js";
import { getUsersFollowingMap } from "../db/index.js";
import { createBaseEmbed, formatPlayerCounts } from "../embeds/baseEmbed.js";
import { mapNameSchema } from "../schemas/validationSchemas.js";
import { getTerminalReason, isRecipientRefusal, isRetryableDiscordError, TerminalError } from "../utils/discordErrors.js";
import { serviceLogger } from "../utils/logger.js";
import { getMapImage } from "../utils/mapUtils.js";
import { findChannelProblem, SEND_PERMISSIONS } from "../utils/permissions.js";
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

// Users pinged per fallback post: inside Discord's 100 allowed mentions, and with
// the announcement, inside its 2000 characters of content.
const FALLBACK_MAX_MENTIONS = 50;

// Alert button custom IDs: this, then what /unfollow's map option would take.
export const UNFOLLOW_BUTTON_PREFIX = "unfollow:";

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
 * @returns {Promise<void>}
 */
export async function notifyUsers(mapName, serverObj) {
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

    const recipients = deliverable.slice(0, config.maxNotificationRecipients);
    const overCap = deliverable.length - recipients.length;
    if (overCap > 0) {
        serviceLogger.warn(
            {
                cap: config.maxNotificationRecipients,
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

    const event = { ip, mapImage, mapName, server, serverObj, validatedMapName: validatedMap.data };

    // This is about our own wall clock, not about protecting Discord: discord.js's
    // REST queue already enforces the global rate limit and sleeps on a 429.
    const limit = pLimit(NOTIFICATION_CONCURRENCY);
    const outcomes = await Promise.all(recipients.map((user) => limit(() => deliverNotification(user, event))));

    // Followers never attempted, in cooldown or over the cap, missed the DM too.
    const done = new Set(recipients.filter((_, i) => outcomes[i] === DELIVERY.delivered || outcomes[i] === DELIVERY.suppressed));
    const missed = followers.filter((follower) => !done.has(follower)).map((follower) => follower.discord_id);

    // One fallback message per map change, not one per failing recipient.
    if (missed.length > 0) {
        await sendFallbackNotification(event, missed);
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
    const event = { ip: serverObj.ip, mapImage: getMapImage(map), mapName: map, server: serverObj.nick, serverObj, validatedMapName: map };

    await user.send({
        components: [buildUnfollowButtons(event)],
        content: buildNotificationContent(event),
        embeds: [buildMapNotificationEmbed(event)]
    });
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
    // No "Last Updated" footer or timestamp: the message's own time already says when.
    const embed = createBaseEmbed(`${mapName} is now on ${server}`, { footer: null })
        .setTimestamp(null)
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
 * One button for the alert's map and one for all maps, each doing what /unfollow would.
 * @param {object} event - Loop-invariant details shared by every recipient
 * @param {string} event.validatedMapName
 * @returns {ActionRowBuilder}
 */
function buildUnfollowButtons({ validatedMapName }) {
    // A map named "all" would repeat the second button's custom ID, which Discord rejects.
    const buttons = [...new Set([validatedMapName, "all"])].map((option) => new ButtonBuilder()
        .setCustomId(`${UNFOLLOW_BUTTON_PREFIX}${option}`)
        .setLabel(`Unfollow ${option}`)
        .setStyle(ButtonStyle.Secondary));

    return new ActionRowBuilder().addComponents(buttons);
}

/**
 * Reports its outcome rather than throwing, so one bad recipient cannot abandon
 * the rest of the fanout.
 * @param {object} user - Follow row with a discord_id
 * @param {object} event - Loop-invariant details shared by every recipient
 * @returns {Promise<string>} - One of the DELIVERY values
 */
async function deliverNotification(user, event) {
    const { mapName, server, validatedMapName } = event;

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
        const perUser = checkRateLimit(user.discord_id, "notification", config.rateLimitNotificationPerMinute);
        if (!perUser.allowed) {
            serviceLogger.warn(
                {
                    limit: config.rateLimitNotificationPerMinute,
                    map: mapName,
                    retryAfter: perUser.retryAfter,
                    server,
                    userId: user.discord_id
                },
                "Notification dropped: user is at their per-minute notification limit"
            );
            return DELIVERY.suppressed;
        }

        await botInstance.users.send(user.discord_id, {
            components: [buildUnfollowButtons(event)],
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
    const { discordGuildId: guildId, fallbackChannelId: channelId } = config;

    const channel = bot.channels.cache.get(channelId) ?? (await bot.channels.fetch(channelId));
    if (!channel) {
        throw new TerminalError(
            `Fallback channel ${channelId} not found`,
            `FALLBACK_CHANNEL_ID ${channelId} does not resolve to a channel the bot can see; check the ID and that the channel is in guild ${guildId}`
        );
    }

    // Checked rather than assumed: fetch() also resolves DM channels, and an ID
    // left over from a guild the bot has since left would fail further in.
    const channelGuildId = channel.guildId ?? channel.guild?.id;
    if (channelGuildId !== guildId) {
        throw new TerminalError(
            `Fallback channel ${channelId} is in guild ${channelGuildId}, not the served guild ${guildId}`,
            `FALLBACK_CHANNEL_ID ${channelId} is not a channel in guild ${guildId}; point it at one there`
        );
    }

    return channel;
}

/**
 * The one message per map change, pinging every follower the DM did not reach.
 * @param {object} event - Loop-invariant details shared by every recipient
 * @param {string[]} userIds - Discord IDs of those followers
 * @returns {Promise<void>}
 */
async function sendFallbackNotification(event, userIds) {
    const { mapName } = event;

    // Without this, an unconfigured fallback costs three retried throws with backoff.
    if (!config.fallbackChannelId) {
        serviceLogger.debug({ map: mapName, undeliverable: userIds.length }, "No fallback channel configured, skipping fallback notification");
        return;
    }

    const pinged = userIds.slice(0, FALLBACK_MAX_MENTIONS);
    const unpinged = userIds.length - pinged.length;
    const mentions = pinged.map((id) => `<@${id}>`).join(" ") + (unpinged > 0 ? ` and ${unpinged} more` : "");

    // One nonce for every attempt, so a retried post returns the first instead of repeating it.
    const nonce = SnowflakeUtil.generate().toString();

    try {
        await withRetry(async () => {
            const channel = await resolveFallbackChannel(botInstance);
            // Terminal: another attempt cannot grant a missing permission.
            const problem = findChannelProblem(channel, SEND_PERMISSIONS);
            if (problem) {
                throw new TerminalError(
                    `Fallback channel permission error: ${problem}`,
                    `${problem} in the fallback channel ${config.fallbackChannelId}; grant the bot those permissions there`
                );
            }
            await channel.send({
                // Replaces the client's deny-all for this send, so only these users are pinged.
                allowedMentions: { users: pinged },
                components: [buildUnfollowButtons(event)],
                content: `${buildNotificationContent(event)}\n${mentions}`,
                embeds: [buildMapNotificationEmbed(event)],
                enforceNonce: true,
                nonce
            });
        }, { isRetryable: isRetryableDiscordError });

        serviceLogger.info({ map: mapName, undeliverable: userIds.length }, "Sent one fallback notification for the undeliverable recipients");
    } catch (fallbackError) {
        const reason = getTerminalReason(fallbackError);
        if (reason) {
            serviceLogger.error({ err: fallbackError, map: mapName }, `Fallback notification cannot succeed and will not be retried. ${reason}`);
        } else {
            serviceLogger.error({ err: fallbackError, map: mapName }, "Failed to send fallback notification");
        }
    }
}
