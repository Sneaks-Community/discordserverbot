/**
 * One map change fans out as DMs; whoever the fanout left out is counted in a
 * single fallback channel post.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

const GUILD_ID = "123456789012345678";
const FALLBACK_CHANNEL_ID = "300000000000000001";

// Before the imports, which read the environment once.
const workingDir = mkdtempSync(join(tmpdir(), "csgobot-notify-"));
process.env.DATABASE_PATH = join(workingDir, "notify.sqlite");
process.env.DISCORD_GUILD_ID = GUILD_ID;
process.env.DISCORD_TOKEN = "test-token";
process.env.FALLBACK_CHANNEL_ID = FALLBACK_CHANNEL_ID;
process.env.LOG_LEVEL = "silent";
process.env.MAX_NOTIFICATION_RECIPIENTS = "1";

const { notifyUsers } = await import("../src/services/notificationService.js");
const { closeDB, followMap, initDB } = await import("../src/db/index.js");

/**
 * DMs always succeed; fallback posts are collected.
 * @returns {{bot: object, posts: object[]}}
 */
function fakeBot() {
    const posts = [];
    const channel = {
        guild: { members: { me: {} } },
        guildId: GUILD_ID,
        isTextBased: () => true,
        permissionsFor: () => ({ has: () => true }),
        send: (payload) => {
            posts.push(payload);
            return Promise.resolve();
        }
    };

    return {
        bot: {
            channels: { cache: new Map([[FALLBACK_CHANNEL_ID, channel]]) },
            users: { send: () => Promise.resolve() }
        },
        posts
    };
}

describe("notifyUsers", () => {
    before(() => {
        initDB();
        followMap("100000000000000001", "de_dust2");
        followMap("100000000000000002", "de_dust2");
    });

    after(() => {
        closeDB();
        rmSync(workingDir, { force: true, recursive: true });
    });

    it("counts followers left out by the recipient cap in the fallback post", async () => {
        const { bot, posts } = fakeBot();

        await notifyUsers("de_dust2", { ip: "1.2.3.4:27015", nick: "Surf" }, bot);

        assert.equal(posts.length, 1);
        assert.match(posts[0].content, /1 follower could not be DMed: 1 over the recipient cap/);
    });
});
