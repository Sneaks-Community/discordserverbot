/**
 * Every input is Zod-validated and every query is parameterized; do not build
 * SQL by interpolation here.
 */

import { discordIdSchema, mapNameSchema } from "../schemas/validationSchemas.js";
import { runStatement, validateOrThrow } from "./statements.js";

/**
 * Follow a map for a user
 * @param {string} discord_id - The Discord user ID
 * @param {string} map_name - The map name to follow
 */
export function followMap(discord_id, map_name) {
    const validatedDiscordId = validateOrThrow(discordIdSchema, discord_id, "followMap/discord_id");
    const validatedMapName = validateOrThrow(mapNameSchema, map_name, "followMap/map_name");
    // Columns named, not positional: adding one later must not shift these.
    runStatement("INSERT INTO players_follow (discord_id, map_name) VALUES (?, ?)", [validatedDiscordId, validatedMapName], "followMap", "run");
}

/**
 * Unfollow a map for a user
 * @param {string} discord_id - The Discord user ID
 * @param {string} map_name - The map name to unfollow
 */
export function unfollowMap(discord_id, map_name) {
    const validatedDiscordId = validateOrThrow(discordIdSchema, discord_id, "unfollowMap/discord_id");
    const validatedMapName = validateOrThrow(mapNameSchema, map_name, "unfollowMap/map_name");
    runStatement("DELETE FROM players_follow WHERE discord_id = ? AND map_name = ?", [validatedDiscordId, validatedMapName], "unfollowMap", "run");
}

/**
 * Ordered by user then map. Free: UNIQUE(discord_id, map_name) already covers
 * both columns, so SQLite reads the rows out in that order rather than sorting.
 * @returns {Array} - Rows with discord_id and map_name properties
 */
export function getAllFollows() {
    return runStatement("SELECT discord_id, map_name FROM players_follow ORDER BY discord_id, map_name", [], "getAllFollows", "all");
}

/**
 * Every user holding at least one follow. DISTINCT because the table is one row
 * per (user, map).
 * @returns {Array<string>} - Discord user IDs
 */
export function getFollowerIds() {
    const rows = runStatement("SELECT DISTINCT discord_id FROM players_follow", [], "getFollowerIds", "all");
    return rows.map((row) => row.discord_id);
}

/**
 * @param {string} discord_id
 * @returns {Array} - Rows with a map_name property
 */
export function getUserFollows(discord_id) {
    const validatedDiscordId = validateOrThrow(discordIdSchema, discord_id, "getUserFollows/discord_id");
    return runStatement("SELECT map_name FROM players_follow WHERE discord_id = ?", [validatedDiscordId], "getUserFollows", "all");
}

/**
 * @param {string} discord_id
 * @returns {number}
 */
export function countUserFollows(discord_id) {
    const validatedDiscordId = validateOrThrow(discordIdSchema, discord_id, "countUserFollows/discord_id");
    const row = runStatement("SELECT COUNT(*) AS count FROM players_follow WHERE discord_id = ?", [validatedDiscordId], "countUserFollows", "get");
    return row?.count ?? 0;
}

/**
 * Selects a constant, not columns: only the row's existence matters, and
 * `.get()` yields undefined when there is none.
 * @param {string} discord_id
 * @param {string} map_name
 * @returns {boolean}
 */
export function isFollowingMap(discord_id, map_name) {
    const validatedDiscordId = validateOrThrow(discordIdSchema, discord_id, "isFollowingMap/discord_id");
    const validatedMapName = validateOrThrow(mapNameSchema, map_name, "isFollowingMap/map_name");
    const row = runStatement("SELECT 1 FROM players_follow WHERE discord_id = ? AND map_name = ?", [validatedDiscordId, validatedMapName], "isFollowingMap", "get");
    return row !== undefined;
}

/**
 * @param {string} map_name
 * @returns {Array} - Rows with a discord_id property
 */
export function getUsersFollowingMap(map_name) {
    const validatedMapName = validateOrThrow(mapNameSchema, map_name, "getUsersFollowingMap/map_name");
    return runStatement("SELECT discord_id FROM players_follow WHERE map_name = ?", [validatedMapName], "getUsersFollowingMap", "all");
}

/** @param {string} discord_id */
export function unfollowAll(discord_id) {
    const validatedDiscordId = validateOrThrow(discordIdSchema, discord_id, "unfollowAll/discord_id");
    runStatement("DELETE FROM players_follow WHERE discord_id = ?", [validatedDiscordId], "unfollowAll", "run");
}
