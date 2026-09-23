/**
 * One gamedig query becomes one snapshot entry: server-supplied fields are checked
 * before they reach Discord, and a failing server is logged once per outage.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { GameDig } from "gamedig";

process.env.DISCORD_GUILD_ID = "123456789012345678";
process.env.DISCORD_TOKEN = "test-token";
process.env.LOG_LEVEL = "silent";

const { getInfo } = await import("../src/services/serverService.js");
const { serviceLogger } = await import("../src/utils/logger.js");

const SERVER = Object.freeze({ ip: "1.2.3.4:27015", keywords: ["surf"], nick: "Surf" });

describe("getInfo", () => {
    it("keeps a host:port connect string and falls back to the configured ip for anything else", async (t) => {
        let connect;
        t.mock.method(GameDig, "query", () => Promise.resolve({ bots: [], connect, map: "de_dust2", maxplayers: 10, numplayers: 0, players: [] }));

        for (const [reported, expected] of [
            ["5.6.7.8:27016", "5.6.7.8:27016"],
            ["play.example.test:7777", "play.example.test:7777"],
            ["[Join](https://evil.test):27015", SERVER.ip],
            ["5.6.7.8", SERVER.ip],
            [`${"a".repeat(254)}:27015`, SERVER.ip],
            [["5.6.7.8:27016"], SERVER.ip],
            [undefined, SERVER.ip]
        ]) {
            connect = reported;
            assert.equal((await getInfo(SERVER, 1)).fullIP, expected, String(reported));
        }
    });

    it("keeps maxplayers only as a finite number", async (t) => {
        let maxplayers;
        t.mock.method(GameDig, "query", () => Promise.resolve({ bots: [], map: "de_dust2", maxplayers, numplayers: 0, players: [] }));

        for (const [reported, expected] of [
            [24, 24],
            ["32", 32],
            ["[Join](https://evil.test)", undefined],
            [{}, undefined],
            [undefined, undefined]
        ]) {
            maxplayers = reported;
            assert.equal((await getInfo(SERVER, 1)).maxPlayers, expected, String(reported));
        }
    });

    it("warns about a failed query once per outage, then logs it at debug", async (t) => {
        t.mock.method(GameDig, "query", () => Promise.reject(new Error("Failed all 1 attempts")));
        const warn = t.mock.method(serviceLogger, "warn");
        const debug = t.mock.method(serviceLogger, "debug");

        assert.equal((await getInfo(SERVER, 1)).online, false);
        assert.equal((await getInfo(SERVER, 1, true)).online, false);

        assert.equal(warn.mock.callCount(), 1);
        assert.equal(debug.mock.callCount(), 1);
    });
});
