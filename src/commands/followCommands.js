import { MessageFlags } from "discord.js";

import { config } from "../config/index.js";
import { followMap, unfollowMap, countUserFollows, getUserFollows, isFollowingMap, unfollowAll } from "../db/index.js";
import { mapNameSchema } from "../schemas/validationSchemas.js";
import { checkRateLimit } from "../services/cacheService.js";
import { escapeForDiscord } from "../utils/discordEscape.js";
import { commandLogger } from "../utils/logger.js";
import { replyWithPagedEmbed } from "../utils/pagination.js";
import { validateWithZod } from "../utils/zodValidator.js";

/** @typedef {import('discord.js').ChatInputCommandInteraction} Interaction */
/** @typedef {import('discord.js').InteractionResponse} Reply */

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

    const userId = interaction.user.id;

    const withinLimit = await enforceRateLimit(interaction, {
        action: "follow",
        gerund: "following",
        limit: config.rateLimitFollowPerMinute,
        userId
    });
    if (!withinLimit) return;

    // The schema lowercases, which is the casing follows are stored under.
    const mapValidation = validateWithZod(mapNameSchema, rawMap, "Map name");
    if (!mapValidation.valid) {
        return interaction.reply({ content: mapValidation.error, flags: MessageFlags.Ephemeral });
    }
    const sanitizedMap = mapValidation.data;

    if (isFollowingMap(userId, sanitizedMap)) {
        return interaction.reply({ content: "You are already following this map.", flags: MessageFlags.Ephemeral });
    }

    // Checked after the duplicate test so re-following a listed map is never refused.
    const followCount = countUserFollows(userId);
    if (followCount >= config.maxFollowsPerUser) {
        return interaction.reply({
            content: `You are already following the maximum of ${config.maxFollowsPerUser} maps. Use \`/unfollow <map>\` to make room, or \`/unfollow all\` to start over.`,
            flags: MessageFlags.Ephemeral
        });
    }

    followMap(userId, sanitizedMap);

    await interaction.reply({ content: `You are now following ${sanitizedMap}. You will be notified when the map comes on a server.`, flags: MessageFlags.Ephemeral });

    commandLogger.info({ map: sanitizedMap, userId, username: interaction.user.tag }, "User followed map");
}

/**
 * @param {Interaction} interaction
 * @returns {Promise<void|Reply>} - Early returns carry the reply; no caller reads it
 */
export async function handleSlashUnfollow(interaction) {
    const rawMap = interaction.options.getString("map");

    const userId = interaction.user.id;

    const withinLimit = await enforceRateLimit(interaction, {
        action: "unfollow",
        gerund: "unfollowing",
        limit: config.rateLimitUnfollowPerMinute,
        userId
    });
    if (!withinLimit) return;

    if (rawMap.trim().toLowerCase() === "all") {
        unfollowAll(userId);
        await interaction.reply({ content: "You are no longer following any maps.", flags: MessageFlags.Ephemeral });
        commandLogger.info({ userId, username: interaction.user.tag }, "User unfollowed all maps");
    } else {
        const mapValidation = validateWithZod(mapNameSchema, rawMap, "Map name");
        if (!mapValidation.valid) {
            return interaction.reply({ content: mapValidation.error, flags: MessageFlags.Ephemeral });
        }
        const sanitizedMap = mapValidation.data;

        if (!isFollowingMap(userId, sanitizedMap)) {
            return interaction.reply({ content: "You are not following this map. Use `/listfollows` to see a list of maps you are following.", flags: MessageFlags.Ephemeral });
        }

        unfollowMap(userId, sanitizedMap);
        await interaction.reply({ content: `You are no longer following ${sanitizedMap}.`, flags: MessageFlags.Ephemeral });
        commandLogger.info({ map: sanitizedMap, userId, username: interaction.user.tag }, "User unfollowed map");
    }
}

/**
 * @param {Interaction} interaction
 * @returns {Promise<void|Reply>} - Early returns carry the reply; no caller reads it
 */
export async function handleSlashListfollows(interaction) {
    const userId = interaction.user.id;

    const follows = getUserFollows(userId);

    if (follows.length === 0) {
        return interaction.reply({ content: "You are not following any maps.", flags: MessageFlags.Ephemeral });
    }

    // Paged: MAX_FOLLOWS_PER_USER still allows a list past the embed description limit.
    const lines = follows.map((follow) => escapeForDiscord(follow.map_name));

    await replyWithPagedEmbed(interaction, {
        lines,
        title: `List of maps you are following (${follows.length}):`
    });
}
