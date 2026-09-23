/** Shared by the dispatcher and /help so both agree on who is an admin. */

import { PermissionFlagsBits } from "discord.js";

import { config } from "../config/index.js";

// envSchema guarantees a snowflake, or "" (disabled) for the role.
const adminRoleId = config.security.adminRoleId;
const primaryGuildID = config.discord.guildID;

/**
 * Admins and the owner qualify too: setDefaultMemberPermissions(0) shows them the commands.
 * An uncached guild's raw member has `roles` as an ID array with no `cache`; both are handled.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @returns {boolean}
 */
export function hasAdminRole(interaction) {
    // Administrator and ownership hold in any guild, and these commands act on the whole database.
    if (interaction.guildId !== primaryGuildID) return false;

    if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) === true) return true;

    const ownerId = interaction.guild?.ownerId;
    if (ownerId && ownerId === interaction.user?.id) return true;

    if (!adminRoleId) return false;

    const roles = interaction.member?.roles;
    if (!roles) return false;

    return Array.isArray(roles) ? roles.includes(adminRoleId) : roles.cache?.has(adminRoleId) === true;
}
