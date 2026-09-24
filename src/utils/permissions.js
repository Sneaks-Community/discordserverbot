import { PermissionFlagsBits } from "discord.js";

const { EmbedLinks, ReadMessageHistory, SendMessages, ViewChannel } = PermissionFlagsBits;

export const SEND_PERMISSIONS = [ViewChannel, SendMessages, EmbedLinks];

/** The server list channel also needs history, to fetch the message it edits. */
export const STATUS_PERMISSIONS = [...SEND_PERMISSIONS, ReadMessageHistory];

/**
 * Worded for an operator, since callers put it in their remediation hint.
 * @param {import('discord.js').Channel | null} channel
 * @param {bigint[]} required
 * @returns {string | null} - Null when the bot can post there
 */
export function findChannelProblem(channel, required) {
    if (!channel?.isTextBased() || channel.isDMBased()) return "Not a text channel in a guild";

    const missing = channel.permissionsFor(channel.guild.members.me)?.missing(required);
    if (!missing) return "Could not resolve the bot's permissions";

    return missing.length > 0 ? `Missing permissions: ${missing.join(", ")}` : null;
}
