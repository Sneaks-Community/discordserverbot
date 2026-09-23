/**
 * What the bot reads on every tick to decide whether to edit its server list
 * message or post a new one. The single-row invariant is the point: if this table
 * could ever hold two rows, the bot would leave abandoned embeds in the channel.
 *
 * These run in declaration order, each depending on the state the previous left.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, it } from "node:test";

import Database from "better-sqlite3";

// Set before the config module is imported, or DATABASE_PATH falls back to
// db.sqlite in the working directory.
const workingDir = mkdtempSync(join(tmpdir(), "csgobot-embed-"));
const dbPath = join(workingDir, "embed.sqlite");
process.env.DATABASE_PATH = dbPath;
process.env.DISCORD_GUILD_ID = "123456789012345678";
process.env.DISCORD_TOKEN = "test-token";
process.env.LOG_LEVEL = "silent";

const { clearEmbedMessage, closeDB, getEmbedMessage, initDB, setEmbedMessage } = await import("../src/db/index.js");

const CHANNEL_ID = "111111111111111111";
const MESSAGE_ID = "222222222222222222";

/**
 * @returns {number} - Rows in embed_message, read through a second connection
 */
function rowCount() {
    const raw = new Database(dbPath);
    try {
        return raw.prepare("SELECT COUNT(*) AS count FROM embed_message").get().count;
    } finally {
        raw.close();
    }
}

before(() => {
    initDB();
});

after(() => {
    closeDB();
    rmSync(workingDir, { force: true, recursive: true });
});

it("reports no tracked message before the bot has posted one", () => {
    assert.equal(getEmbedMessage(), null);
});

it("stores and returns the channel and message together", () => {
    setEmbedMessage(CHANNEL_ID, MESSAGE_ID);

    assert.deepEqual(getEmbedMessage(), { channelId: CHANNEL_ID, messageId: MESSAGE_ID });
});

it("replaces the tracked message rather than accumulating rows", () => {
    setEmbedMessage(CHANNEL_ID, "333333333333333333");

    assert.deepEqual(getEmbedMessage(), { channelId: CHANNEL_ID, messageId: "333333333333333333" });
    assert.equal(rowCount(), 1);
});

it("records a move to another channel", () => {
    setEmbedMessage("444444444444444444", "555555555555555555");

    assert.deepEqual(getEmbedMessage(), { channelId: "444444444444444444", messageId: "555555555555555555" });
    assert.equal(rowCount(), 1);
});

it("forgets the message when cleared", () => {
    clearEmbedMessage();

    assert.equal(getEmbedMessage(), null);
    assert.equal(rowCount(), 0);
});

it("rejects an ID that is not a snowflake", () => {
    assert.throws(() => setEmbedMessage("not-a-channel", MESSAGE_ID));
    assert.throws(() => setEmbedMessage(CHANNEL_ID, "not-a-message"));
    assert.equal(getEmbedMessage(), null);
});

it("refuses a second row even if something bypasses the module", () => {
    setEmbedMessage(CHANNEL_ID, MESSAGE_ID);

    const raw = new Database(dbPath);
    try {
        assert.throws(
            () => raw.prepare("INSERT INTO embed_message (id, channel_id, message_id) VALUES (2, ?, ?)").run(CHANNEL_ID, MESSAGE_ID),
            /CHECK constraint failed/
        );
    } finally {
        raw.close();
    }

    assert.equal(rowCount(), 1);
});
