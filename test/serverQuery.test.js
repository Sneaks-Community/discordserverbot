/**
 * One gamedig reply becomes one snapshot entry. Some protocols fill fields from
 * the game server's own data, so those are checked before they reach Discord.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { GameDig } from "gamedig";

process.env.DISCORD_GUILD_ID = "123456789012345678";
process.env.DISCORD_TOKEN = "test-token";
process.env.LOG_LEVEL = "silent";

const { getInfo } = await import("../src/services/serverService.js");

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
});
