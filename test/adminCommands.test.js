import assert from "node:assert/strict";
import { describe, it } from "node:test";

process.env.DISCORD_GUILD_ID = "123456789012345678";
process.env.DISCORD_TOKEN = "test-token";
process.env.LOG_LEVEL = "silent";

const { handleSlashTestnotify } = await import("../src/commands/adminCommands.js");

/**
 * @param {Function} send - Stands in for the admin's User#send
 * @returns {object} - The fields the handler reads, plus a `replies` log
 */
function interaction(send) {
    const replies = [];

    return {
        deferReply: () => Promise.resolve(),
        editReply: (payload) => {
            replies.push(payload.content);
            return Promise.resolve(payload);
        },
        options: { getString: () => "de_dust2" },
        replies,
        user: { send }
    };
}

// No database is open, so any follower lookup would throw.
describe("handleSlashTestnotify", () => {
    it("DMs only the admin who ran it", async () => {
        const dms = [];
        const admin = interaction((payload) => {
            dms.push(payload);
            return Promise.resolve();
        });

        await handleSlashTestnotify(admin);

        assert.equal(dms.length, 1);
        assert.match(dms[0].content, /^de_dust2 is now on Test Server!/);
        assert.match(admin.replies[0], /de_dust2/);
    });

    it("replies with Discord's error when the admin's DMs are closed", async () => {
        const admin = interaction(() => Promise.reject(new Error("Cannot send messages to this user")));

        await handleSlashTestnotify(admin);

        assert.match(admin.replies[0], /Cannot send messages to this user/);
    });
});
