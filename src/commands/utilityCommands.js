import { MessageFlags } from "discord.js";

import { createBaseEmbed } from "../embeds/baseEmbed.js";
import { hasAdminRole } from "./adminAuth.js";
import { getHelpEntries } from "./definitions.js";

/** @typedef {import('discord.js').ChatInputCommandInteraction} Interaction */

/**
 * Built from the same definitions Discord is registered with, so it cannot
 * drift. Admin commands are listed only for admins.
 * @param {Interaction} interaction
 */
export async function handleSlashHelp(interaction) {
    // No footer: the command list is not a snapshot, so "Last Updated" misleads.
    const embed = createBaseEmbed("List of commands", { footer: null })
        .addFields(getHelpEntries(hasAdminRole(interaction)).map(({ description, usage }) => ({ name: usage, value: description })));

    await interaction.reply({ embeds: [embed] });
}

/** @param {Interaction} interaction */
export async function handleSlashPing(interaction) {
    const { ping } = interaction.client.ws;
    // -1 until the first heartbeat is acknowledged, shortly after connecting.
    const latency = ping >= 0 ? `${ping}ms` : "not measured yet";
    await interaction.reply({ content: `🏓 Pong! Gateway latency: ${latency}`, flags: MessageFlags.Ephemeral });
}
