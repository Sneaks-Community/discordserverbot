/**
 * The server list embed: its interval text is a promise to readers, and passing
 * Discord's 6000-character total would 400 every edit.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { embedLength } from "discord.js";

process.env.DISCORD_GUILD_ID = "123456789012345678";
process.env.DISCORD_TOKEN = "test-token";
process.env.LOG_LEVEL = "silent";

const { describeInterval, makeEmbed } = await import("../src/embeds/serverEmbeds.js");

describe("describeInterval", () => {
    it("reads sub-minute intervals in seconds", () => {
        assert.equal(describeInterval(30_000), "30 seconds");
        assert.equal(describeInterval(45_000), "45 seconds");
    });

    it("singularizes one second and one minute", () => {
        assert.equal(describeInterval(1000), "1 second");
        assert.equal(describeInterval(60_000), "1 minute");
    });

    it("keeps one decimal so the default interval stays honest", () => {
        assert.equal(describeInterval(90_000), "1.5 minutes");
    });

    it("drops a trailing zero rather than writing \"2.0 minutes\"", () => {
        assert.equal(describeInterval(120_000), "2 minutes");
    });

    it("rounds to the nearest tenth of a minute", () => {
        assert.equal(describeInterval(100_000), "1.7 minutes");
    });
});

describe("makeEmbed", () => {
    it("keeps 25 servers with maximum-length fields within 6000 characters, skipping what does not fit", () => {
        // Clamped to a 256-character name and a 1024-character value.
        const huge = { fullIP: "1.2.3.4:27015", map: "m".repeat(2000), name: "n".repeat(300), online: true };
        const servers = [...Array(24).fill(huge), { name: "Small", online: false }];

        const embed = makeEmbed(Object.fromEntries(servers.map((server, i) => [`server${i}`, server]))).toJSON();

        assert.ok(embedLength(embed) <= 6000, `${embedLength(embed)} characters`);
        // Four maximum-length fields fit, and a later server that fits is still added.
        assert.equal(embed.fields.length, 5);
        assert.equal(embed.fields.at(-1).name, "Small");
    });

    it("adds no Connect link while CONNECT_BASE_URL is unset", () => {
        const { fields } = makeEmbed({ surf: { fullIP: "1.2.3.4:27015", map: "surf_beginner", name: "Surf", online: true } }).toJSON();

        assert.ok(!fields[0].value.includes("Connect"), fields[0].value);
    });
});
