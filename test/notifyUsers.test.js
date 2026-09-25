/**
 * One map change fans out as DMs; whoever the fanout left out is pinged in a
 * single fallback channel post.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { RESTJSONErrorCodes } from "discord.js";

const GUILD_ID = "123456789012345678";
const FALLBACK_CHANNEL_ID = "300000000000000001";
const REFUSING_ID = "100000000000000002";

// Before the imports, which read the environment once.
const workingDir = mkdtempSync(join(tmpdir(), "csgobot-notify-"));
process.env.DATABASE_PATH = join(workingDir, "notify.sqlite");
process.env.DISCORD_GUILD_ID = GUILD_ID;
process.env.DISCORD_TOKEN = "test-token";
process.env.FALLBACK_CHANNEL_ID = FALLBACK_CHANNEL_ID;
process.env.LOG_LEVEL = "silent";
process.env.MAX_NOTIFICATION_RECIPIENTS = "2";

const { initNotificationService, notifyUsers } = await import("../src/services/notificationService.js");
const { closeDB, followMap, initDB } = await import("../src/db/index.js");

/**
 * Refuses DMs to REFUSING_ID and delivers the rest; fallback posts are collected.
 * @returns {{bot: object, posts: object[]}}
 */
function fakeBot() {
    const posts = [];
    const channel = {
        guild: { members: { me: {} } },
        guildId: GUILD_ID,
        isDMBased: () => false,
        isTextBased: () => true,
        permissionsFor: () => ({ missing: () => [] }),
        send: (payload) => {
            posts.push(payload);
            return Promise.resolve();
        }
    };
    const refusal = Object.assign(new Error("Cannot send messages to this user"), { code: RESTJSONErrorCodes.CannotSendMessagesToThisUser });

    return {
        bot: {
            channels: { cache: new Map([[FALLBACK_CHANNEL_ID, channel]]) },
            users: { send: (id) => (id === REFUSING_ID ? Promise.reject(refusal) : Promise.resolve()) }
        },
        posts
    };
}

describe("notifyUsers", () => {
    before(() => {
        initDB();
        followMap("100000000000000001", "de_dust2");
        followMap(REFUSING_ID, "de_dust2");
        followMap("100000000000000003", "de_dust2");
    });

    after(() => {
        closeDB();
        rmSync(workingDir, { force: true, recursive: true });
    });

    it("pings the refused and over-cap followers, not the delivered one, in one fallback post", async () => {
        const { bot, posts } = fakeBot();
        initNotificationService(bot);

        await notifyUsers("de_dust2", { ip: "1.2.3.4:27015", nick: "Surf" });

        assert.equal(posts.length, 1);
        assert.equal(posts[0].content, "de_dust2 is now on Surf!\nsteam://connect/1.2.3.4:27015\n<@100000000000000002> <@100000000000000003>");
        assert.deepEqual(posts[0].allowedMentions, { users: ["100000000000000002", "100000000000000003"] });
    });
});
