/**
 * One server across ticks: a DM goes out only when an online server reports a
 * map other than the last one it was seen on.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

process.env.DISCORD_GUILD_ID = "123456789012345678";
process.env.DISCORD_TOKEN = "test-token";
process.env.LOG_LEVEL = "silent";

const { detectMapChange } = await import("../src/services/serverService.js");

const OFFLINE = Object.freeze({ online: false });

/**
 * @param {string} map
 * @returns {object} - An online snapshot entry
 */
function online(map) {
    return { map, online: true };
}

/**
 * Feeds ticks through detectMapChange the way updateServerData does, from a fresh start.
 * @param {Array<object | undefined>} ticks - One snapshot entry per tick, oldest first
 * @returns {string[]} - The maps that would have been notified
 */
function notifiedMaps(ticks) {
    let lastSeen = "";
    const notified = [];

    for (const live of ticks) {
        const result = detectMapChange(lastSeen, live);
        if (result.changed) notified.push(result.lastSeen);
        lastSeen = result.lastSeen;
    }

    return notified;
}

describe("detectMapChange", () => {
    it("records a first sighting without notifying, even after offline ticks", () => {
        assert.deepEqual(notifiedMaps([online("de_dust2")]), []);
        assert.deepEqual(notifiedMaps([OFFLINE, undefined, online("de_dust2")]), []);
        assert.deepEqual(detectMapChange("", online("de_dust2")), { changed: false, lastSeen: "de_dust2" });
    });

    it("notifies once per map change", () => {
        assert.deepEqual(notifiedMaps([online("de_dust2"), online("de_inferno"), online("de_inferno"), online("de_mirage")]), ["de_inferno", "de_mirage"]);
    });

    it("compares across an offline gap with the map from before it", () => {
        assert.deepEqual(notifiedMaps([online("de_dust2"), OFFLINE, undefined, online("de_inferno")]), ["de_inferno"]);
    });

    it("stays quiet when a server returns on the same map", () => {
        assert.deepEqual(notifiedMaps([online("de_dust2"), OFFLINE, online("de_dust2")]), []);
    });
});
