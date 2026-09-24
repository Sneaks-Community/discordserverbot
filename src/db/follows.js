/**
 * Every input is Zod-validated and every query is parameterized; do not build
 * SQL by interpolation here.
 */

import { discordIdSchema, mapNameSchema } from "../schemas/validationSchemas.js";
import { getStatement } from "./connection.js";
import { validateOrThrow } from "./statements.js";

/**
 * @param {string} discord_id
 * @param {string} map_name
 */
export function followMap(discord_id, map_name) {
    const validatedDiscordId = validateOrThrow(discordIdSchema, discord_id, "followMap/discord_id");
    const validatedMapName = validateOrThrow(mapNameSchema, map_name, "followMap/map_name");
    // Columns named, not positional: adding one later must not shift these.
    getStatement("INSERT INTO players_follow (discord_id, map_name) VALUES (?, ?)").run(validatedDiscordId, validatedMapName);
}

/**
 * @param {string} discord_id
 * @param {string} map_name
 */
export function unfollowMap(discord_id, map_name) {
    const validatedDiscordId = validateOrThrow(discordIdSchema, discord_id, "unfollowMap/discord_id");
    const validatedMapName = validateOrThrow(mapNameSchema, map_name, "unfollowMap/map_name");
    getStatement("DELETE FROM players_follow WHERE discord_id = ? AND map_name = ?").run(validatedDiscordId, validatedMapName);
}

/**
 * Ordered by user then map. Free: UNIQUE(discord_id, map_name) already covers
 * both columns, so SQLite reads the rows out in that order rather than sorting.
 * @returns {Array} - Rows with discord_id and map_name properties
 */
export function getAllFollows() {
    return getStatement("SELECT discord_id, map_name FROM players_follow ORDER BY discord_id, map_name").all();
}

/**
 * @returns {Array<string>} - Discord user IDs
 */
export function getFollowerIds() {
    const rows = getStatement("SELECT DISTINCT discord_id FROM players_follow").all();
    return rows.map((row) => row.discord_id);
}

/**
 * @param {string} discord_id
 * @returns {Array} - Rows with a map_name property
 */
export function getUserFollows(discord_id) {
    const validatedDiscordId = validateOrThrow(discordIdSchema, discord_id, "getUserFollows/discord_id");
    return getStatement("SELECT map_name FROM players_follow WHERE discord_id = ? ORDER BY map_name").all(validatedDiscordId);
}

/**
 * @param {string} discord_id
 * @returns {number}
 */
export function countUserFollows(discord_id) {
    const validatedDiscordId = validateOrThrow(discordIdSchema, discord_id, "countUserFollows/discord_id");
    const row = getStatement("SELECT COUNT(*) AS count FROM players_follow WHERE discord_id = ?").get(validatedDiscordId);
    return row?.count ?? 0;
}

/**
 * @param {string} discord_id
 * @param {string} map_name
 * @returns {boolean}
 */
export function isFollowingMap(discord_id, map_name) {
    const validatedDiscordId = validateOrThrow(discordIdSchema, discord_id, "isFollowingMap/discord_id");
    const validatedMapName = validateOrThrow(mapNameSchema, map_name, "isFollowingMap/map_name");
    const row = getStatement("SELECT 1 FROM players_follow WHERE discord_id = ? AND map_name = ?").get(validatedDiscordId, validatedMapName);
    return row !== undefined;
}

/**
 * @param {string} map_name
 * @returns {Array} - Rows with a discord_id property
 */
export function getUsersFollowingMap(map_name) {
    const validatedMapName = validateOrThrow(mapNameSchema, map_name, "getUsersFollowingMap/map_name");
    return getStatement("SELECT discord_id FROM players_follow WHERE map_name = ?").all(validatedMapName);
}

/** @param {string} discord_id */
export function unfollowAll(discord_id) {
    const validatedDiscordId = validateOrThrow(discordIdSchema, discord_id, "unfollowAll/discord_id");
    getStatement("DELETE FROM players_follow WHERE discord_id = ?").run(validatedDiscordId);
}
