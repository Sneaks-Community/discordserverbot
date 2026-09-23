import { MessageFlags } from "discord.js";

import { CONFIG_VALUES } from "../config/index.js";
import { followMap, unfollowMap, countUserFollows, getUserFollows, isFollowingMap, unfollowAll } from "../db/index.js";
import { discordIdSchema, mapNameSchema } from "../schemas/validationSchemas.js";
import { checkRateLimit } from "../services/cacheService.js";
import { escapeForDiscord } from "../utils/discordEscape.js";
import { commandLogger } from "../utils/logger.js";
import { replyWithPagedEmbed } from "../utils/pagination.js";
import { validateWithZod } from "../utils/zodValidator.js";

/** @typedef {import('discord.js').ChatInputCommandInteraction} Interaction */
/** @typedef {import('discord.js').InteractionResponse} Reply */

/**
 * Replies itself if the invoker's ID is invalid, so callers only check for null.
 * @param {Interaction} interaction
 * @returns {Promise<?string>} - The validated ID, or null if already replied to
 */
async function resolveUserId(interaction) {
    const result = validateWithZod(discordIdSchema, interaction.user.id, "User ID");
    if (result.valid) return result.data;

    await interaction.reply({ content: result.error, flags: MessageFlags.Ephemeral });
    return null;
}

/**
 * Replies itself when the user is over the limit.
 * @param {Interaction} interaction
 * @param {object} options
 * @param {string} options.action - Rate limit key, one bucket per action
 * @param {string} options.gerund - Reads as "before ... another map"
 * @param {number} options.limit
 * @param {string} options.userId
 * @returns {Promise<boolean>} - Whether the command may proceed
 */
async function enforceRateLimit(interaction, { action, gerund, limit, userId }) {
    const result = checkRateLimit(userId, action, limit);
    if (result.allowed) return true;

    await interaction.reply({ content: `Rate limit exceeded. Please wait ${result.retryAfter} seconds before ${gerund} another map.`, flags: MessageFlags.Ephemeral });
    return false;
}

/**
 * @param {Interaction} interaction
 * @returns {Promise<void|Reply>} - Early returns carry the reply; no caller reads it
 */
export async function handleSlashFollow(interaction) {
    const rawMap = interaction.options.getString("map");

    const sanitizedUserId = await resolveUserId(interaction);
    if (!sanitizedUserId) return;

    const withinLimit = await enforceRateLimit(interaction, {
        action: "follow",
        gerund: "following",
        limit: CONFIG_VALUES.FOLLOW_RATE_LIMIT_PER_MINUTE,
        userId: sanitizedUserId
    });
    if (!withinLimit) return;

    // The schema lowercases, which is the casing follows are stored under.
    const mapValidation = validateWithZod(mapNameSchema, rawMap, "Map name");
    if (!mapValidation.valid) {
        return interaction.reply({ content: mapValidation.error, flags: MessageFlags.Ephemeral });
    }
    const sanitizedMap = mapValidation.data;

    if (isFollowingMap(sanitizedUserId, sanitizedMap)) {
        return interaction.reply({ content: "You are already following this map.", flags: MessageFlags.Ephemeral });
    }

    // Checked after the duplicate test so re-following a listed map is never refused.
    const followCount = countUserFollows(sanitizedUserId);
    if (followCount >= CONFIG_VALUES.MAX_FOLLOWS_PER_USER) {
        return interaction.reply({
            content: `You are already following the maximum of ${CONFIG_VALUES.MAX_FOLLOWS_PER_USER} maps. Use \`/unfollow <map>\` to make room, or \`/unfollow all\` to start over.`,
            flags: MessageFlags.Ephemeral
        });
    }

    followMap(sanitizedUserId, sanitizedMap);

    await interaction.reply({ content: `You are now following ${sanitizedMap}. You will be notified when the map comes on a server.`, flags: MessageFlags.Ephemeral });

    commandLogger.info({ map: sanitizedMap, userId: sanitizedUserId, username: interaction.user.tag }, "User followed map");
}

/**
 * @param {Interaction} interaction
 * @returns {Promise<void|Reply>} - Early returns carry the reply; no caller reads it
 */
export async function handleSlashUnfollow(interaction) {
    const rawMap = interaction.options.getString("map");

    const sanitizedUserId = await resolveUserId(interaction);
    if (!sanitizedUserId) return;

    const withinLimit = await enforceRateLimit(interaction, {
        action: "unfollow",
        gerund: "unfollowing",
        limit: CONFIG_VALUES.UNFOLLOW_RATE_LIMIT_PER_MINUTE,
        userId: sanitizedUserId
    });
    if (!withinLimit) return;

    if (rawMap.trim().toLowerCase() === "all") {
        unfollowAll(sanitizedUserId);
        await interaction.reply({ content: "You are no longer following any maps.", flags: MessageFlags.Ephemeral });
        commandLogger.info({ userId: sanitizedUserId, username: interaction.user.tag }, "User unfollowed all maps");
    } else {
        const mapValidation = validateWithZod(mapNameSchema, rawMap, "Map name");
        if (!mapValidation.valid) {
            return interaction.reply({ content: mapValidation.error, flags: MessageFlags.Ephemeral });
        }
        const sanitizedMap = mapValidation.data;

        if (!isFollowingMap(sanitizedUserId, sanitizedMap)) {
            return interaction.reply({ content: "You are not following this map. Use `/listfollows` to see a list of maps you are following.", flags: MessageFlags.Ephemeral });
        }

        unfollowMap(sanitizedUserId, sanitizedMap);
        await interaction.reply({ content: `You are no longer following ${sanitizedMap}.`, flags: MessageFlags.Ephemeral });
        commandLogger.info({ map: sanitizedMap, userId: sanitizedUserId, username: interaction.user.tag }, "User unfollowed map");
    }
}

/**
 * @param {Interaction} interaction
 * @returns {Promise<void|Reply>} - Early returns carry the reply; no caller reads it
 */
export async function handleSlashListfollows(interaction) {
    const sanitizedUserId = await resolveUserId(interaction);
    if (!sanitizedUserId) return;

    const follows = getUserFollows(sanitizedUserId);

    if (follows.length === 0) {
        return interaction.reply({ content: "You are not following any maps.", flags: MessageFlags.Ephemeral });
    }

    // Paged: MAX_FOLLOWS_PER_USER still allows a list past the embed description limit.
    const lines = follows.map((follow) => escapeForDiscord(follow.map_name));

    await replyWithPagedEmbed(interaction, {
        ephemeral: true,
        lines,
        title: `List of maps you are following (${follows.length}):`
    });
}
