/**
 * One map change fans out as DMs; whoever the fanout left out is pinged in a
 * single fallback channel post. Every alert carries unfollow buttons.
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
const { handleInteraction } = await import("../src/commands/index.js");
const { closeDB, followMap, getUserFollows, initDB } = await import("../src/db/index.js");

/**
 * Refuses DMs to REFUSING_ID and delivers the rest; DMs and fallback posts are collected.
 * @returns {{bot: object, dms: object[], posts: object[]}}
 */
function fakeBot() {
    const dms = [];
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
            users: {
                send: (id, payload) => {
                    if (id === REFUSING_ID) return Promise.reject(refusal);
                    dms.push(payload);
                    return Promise.resolve();
                }
            }
        },
        dms,
        posts
    };
}

/**
 * A button press from a DM, with only what the router and the unfollow path read.
 * @param {string} customId
 * @param {string} userId
 * @returns {object}
 */
function buttonPress(customId, userId) {
    return {
        customId,
        inGuild: () => false,
        isButton: () => true,
        isChatInputCommand: () => false,
        reply: () => Promise.resolve(),
        user: { id: userId, tag: "tester" }
    };
}

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

describe("notifyUsers", () => {
    it("pings the refused and over-cap followers, not the delivered one, in one fallback post", async () => {
        const { bot, posts } = fakeBot();
        initNotificationService(bot);

        await notifyUsers("de_dust2", { ip: "1.2.3.4:27015", nick: "Surf" });

        assert.equal(posts.length, 1);
        assert.equal(posts[0].content, "de_dust2 is now on Surf!\n`1.2.3.4:27015`\n<@100000000000000002> <@100000000000000003>");
        assert.deepEqual(posts[0].allowedMentions, { users: ["100000000000000002", "100000000000000003"] });
    });
});

describe("unfollow buttons", () => {
    it("unfollow the alert's map, then every map, for whoever presses them in the DM", async () => {
        const clicker = "100000000000000004";
        followMap(clicker, "de_inferno");
        followMap(clicker, "de_nuke");
        const { bot, dms } = fakeBot();
        initNotificationService(bot);

        await notifyUsers("de_inferno", { ip: "1.2.3.4:27015", nick: "Surf" });

        const [mapButton, allButton] = dms[0].components[0].components.map((button) => button.toJSON());
        assert.deepEqual([mapButton.label, allButton.label], ["Unfollow de_inferno", "Unfollow all"]);

        await handleInteraction(buttonPress(mapButton.custom_id, clicker));
        assert.deepEqual(getUserFollows(clicker).map((follow) => follow.map_name), ["de_nuke"]);

        await handleInteraction(buttonPress(allButton.custom_id, clicker));
        assert.deepEqual(getUserFollows(clicker), []);
    });
});
