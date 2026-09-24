import { MessageFlags } from "discord.js";

import { getAllFollows, unfollowAll } from "../db/index.js";
import { discordIdSchema, mapNameSchema } from "../schemas/validationSchemas.js";
import { sendTestNotification } from "../services/notificationService.js";
import { replyWithPagedEmbed } from "../utils/pagination.js";
import { validateWithZod } from "../utils/zodValidator.js";

/** @typedef {import('discord.js').ChatInputCommandInteraction} Interaction */
/** @typedef {import('discord.js').InteractionResponse} Reply */

/**
 * @param {Interaction} interaction
 * @returns {Promise<void|Reply>} - Early returns carry the reply; no caller reads it
 */
export async function handleSlashListallfollows(interaction) {
    const follows = getAllFollows();

    // getAllFollows returns rows already ordered by user, so nothing to sort.
    if (!follows || follows.length === 0) {
        return interaction.reply({ content: "There are no users following any maps.", flags: MessageFlags.Ephemeral });
    }

    // Paged rather than truncated: an admin needs the whole list, which grows with every follow.
    const lines = follows.map((follow) => `<@${follow.discord_id}>: ${follow.map_name}`);

    await replyWithPagedEmbed(interaction, {
        lines,
        title: `List of all followed maps (${follows.length}):`
    });
}

/**
 * @param {Interaction} interaction
 * @returns {Promise<void|import('discord.js').Message>} - No caller reads it
 */
export async function handleSlashTestnotify(interaction) {
    // The DM can outrun Discord's 3 second reply deadline. Every reply here is
    // ephemeral, so the flag carries over to each editReply below.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const map = interaction.options.getString("map");

    if (!map) {
        return interaction.editReply({ content: "Please enter a valid map name." });
    }

    const mapValidation = validateWithZod(mapNameSchema, map, "Map name");
    if (!mapValidation.valid) {
        return interaction.editReply({ content: mapValidation.error });
    }
    const sanitizedMap = mapValidation.data;

    try {
        await sendTestNotification(interaction.user, sanitizedMap);
    } catch (err) {
        return interaction.editReply({ content: `Could not DM you: ${err.message}` });
    }

    await interaction.editReply({ content: `Sent you a test notification for ${sanitizedMap}.` });
}

/**
 * @param {Interaction} interaction
 * @returns {Promise<void|Reply>} - Early returns carry the reply; no caller reads it
 */
export async function handleSlashRemoveuser(interaction) {
    const userId = interaction.options.getString("userid");

    if (!userId) {
        return interaction.reply({ content: "Please enter a valid user ID.", flags: MessageFlags.Ephemeral });
    }

    const userIdValidation = validateWithZod(discordIdSchema, userId, "User ID");
    if (!userIdValidation.valid) {
        return interaction.reply({ content: userIdValidation.error, flags: MessageFlags.Ephemeral });
    }

    unfollowAll(userIdValidation.data);
    // A real mention in content: deny pings rather than rely on the ephemeral flag staying put.
    await interaction.reply({ content: `Removed all maps from user <@${userId}>.`, flags: MessageFlags.Ephemeral });
}
