/**
 * The single declaration of every slash command. What Discord registers, what
 * the dispatcher routes and what /help lists all derive from this array.
 *
 * utilityCommands imports getHelpEntries from here, so /help's handler makes
 * this module part of an import cycle. That is only harmless because every
 * handler is an exported function declaration, which ESM hoists before any
 * module body runs; turning one into a `const` arrow breaks startup with a TDZ
 * error.
 */

import { SlashCommandBuilder } from "discord.js";

import { handleSlashListallfollows, handleSlashRemoveuser, handleSlashTestnotify } from "./adminCommands.js";
import { handleSlashFollow, handleSlashListfollows, handleSlashUnfollow } from "./followCommands.js";
import { handleSlashKeywords, handleSlashPlayers } from "./playerCommands.js";
import { handleSlashHelp, handleSlashPing } from "./utilityCommands.js";

/**
 * @typedef {object} CommandDefinition
 * @property {boolean} admin - Whether the admin role is required
 * @property {string} description - The description Discord shows
 * @property {Function} handler
 * @property {string} name
 * @property {Function} [options] - Adds the command's string option, if it takes one
 */

/** @type {ReadonlyArray<CommandDefinition>} */
const COMMAND_DEFINITIONS = Object.freeze([
    { admin: false, description: "Show players on a server", handler: handleSlashPlayers, name: "players",
        options: opt => opt.setName("server").setDescription("Server keyword or name").setRequired(false) },
    { admin: false, description: "List all available server keywords", handler: handleSlashKeywords, name: "keywords" },
    { admin: false, description: "Follow a map to receive DM notifications", handler: handleSlashFollow, name: "follow",
        options: opt => opt.setName("map").setDescription("Map name to follow").setRequired(true) },
    { admin: false, description: "Stop following a map, or all your maps at once", handler: handleSlashUnfollow, name: "unfollow",
        options: opt => opt.setName("map").setDescription("Map name to unfollow (or 'all' for all maps)").setRequired(true) },
    { admin: false, description: "List all maps you are following", handler: handleSlashListfollows, name: "listfollows" },
    { admin: false, description: "Show list of available commands", handler: handleSlashHelp, name: "help" },
    { admin: false, description: "Check bot latency", handler: handleSlashPing, name: "ping" },
    { admin: true, description: "List all users and their followed maps (Admin only)", handler: handleSlashListallfollows, name: "listallfollows" },
    { admin: true, description: "DM yourself a sample map notification (Admin only)", handler: handleSlashTestnotify, name: "testnotify",
        options: opt => opt.setName("map").setDescription("Map name to test").setRequired(true) },
    { admin: true, description: "Remove all follows for a user (Admin only)", handler: handleSlashRemoveuser, name: "removeuser",
        options: opt => opt.setName("userid").setDescription("Discord user ID").setRequired(true) }
]);

/**
 * For the dispatcher's O(1) lookup.
 * @type {Map<string, CommandDefinition>}
 */
export const COMMANDS_BY_NAME = new Map(COMMAND_DEFINITIONS.map(def => [def.name, def]));

/**
 * @param {CommandDefinition} def
 * @returns {import('discord.js').RESTPostAPIChatInputApplicationCommandsJSONBody}
 */
function buildCommand(def) {
    const builder = new SlashCommandBuilder()
        .setName(def.name)
        .setDescription(def.description);

    // Trims the picker only; the dispatcher still checks the role itself.
    if (def.admin) {
        builder.setDefaultMemberPermissions(0);
    }
    if (def.options) {
        builder.addStringOption(def.options);
    }

    return builder.toJSON();
}

/**
 * Every command in the shape the registration endpoint takes.
 * @returns {Array<import('discord.js').RESTPostAPIChatInputApplicationCommandsJSONBody>}
 */
export function buildSlashCommands() {
    return COMMAND_DEFINITIONS.map(buildCommand);
}

/**
 * Reads the options back off the built payload rather than restating them.
 * @param {CommandDefinition} def
 * @returns {string} - e.g. `/players [server]`
 */
function formatUsage(def) {
    const options = buildCommand(def).options ?? [];

    return [`/${def.name}`, ...options.map(opt => (opt.required ? `<${opt.name}>` : `[${opt.name}]`))].join(" ");
}

/**
 * @param {boolean} includeAdmin - Whether to list the admin-only commands
 * @returns {Array<{description: string, usage: string}>}
 */
export function getHelpEntries(includeAdmin) {
    return COMMAND_DEFINITIONS
        .filter(def => includeAdmin || !def.admin)
        .map(def => ({ description: def.description, usage: formatUsage(def) }));
}
