import { MessageFlags } from "discord.js";

import { serverObject } from "../config/index.js";
import { playerListEmbed, makeServerList } from "../embeds/playerEmbeds.js";
import { isServerDataEmpty, getServerData, getServerByKeyword } from "../services/serverService.js";
import { joinWithinLimit, MESSAGE_CONTENT_LIMIT } from "../utils/truncate.js";

/** @typedef {import('discord.js').ChatInputCommandInteraction} Interaction */
/** @typedef {import('discord.js').InteractionResponse} Reply */

/**
 * @param {Interaction} interaction
 * @returns {Promise<void|Reply>} - Early returns carry the reply; no caller reads it
 */
export async function handleSlashPlayers(interaction) {
    if (isServerDataEmpty()) {
        return interaction.reply({ content: "Please Wait. The bot is starting.", flags: MessageFlags.Ephemeral });
    }

    const serverInput = interaction.options.getString("server");

    if (!serverInput) {
        const serverData = getServerData();
        const embed = makeServerList(serverData);
        return interaction.reply({ embeds: [embed] });
    }

    const server = getServerByKeyword(serverInput.trim().toLowerCase());

    if (!server) {
        return interaction.reply({ content: "Please enter a valid server.", flags: MessageFlags.Ephemeral });
    }

    const embed = playerListEmbed(server);
    await interaction.reply({ embeds: [embed] });
}

/**
 * @param {Interaction} interaction
 * @returns {Promise<void|Reply>} - Early returns carry the reply; no caller reads it
 */
export async function handleSlashKeywords(interaction) {
    // 25 servers with several keywords each can pass the 2000 character content
    // limit, which rejects the whole reply, so drop whole server entries instead.
    const entries = Object.values(serverObject).map((server) => {
        const keywords = server.keywords.map((k) => `\t${k}`).join("");
        return `**${server.nick}:**\n${keywords}`;
    });

    const content = joinWithinLimit(entries, MESSAGE_CONTENT_LIMIT);

    await interaction.reply({ content: content || "No servers configured." });
}
