import { MessageFlags } from "discord.js";

/** @typedef {import('discord.js').ChatInputCommandInteraction} Interaction */

/** @param {Interaction} interaction */
export async function handleSlashPing(interaction) {
    const { ping } = interaction.client.ws;
    // -1 until the first heartbeat is acknowledged, shortly after connecting.
    const latency = ping >= 0 ? `${ping}ms` : "not measured yet";
    await interaction.reply({ content: `🏓 Pong! Gateway latency: ${latency}`, flags: MessageFlags.Ephemeral });
}
