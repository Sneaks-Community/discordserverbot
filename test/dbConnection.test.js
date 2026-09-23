/**
 * The connection lifecycle, checked against the file on disk rather than through
 * the module that created it: the schema, the WAL pragma, the statement cache
 * belonging to one connection, and the index that lets getAllFollows return rows
 * in order without a sort step.
 *
 * These run in declaration order on purpose, because each one depends on the state
 * the previous left behind.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, it } from "node:test";

import Database from "better-sqlite3";

// The required variables matter here: without them parseEnv falls back to placeholder
// values, DATABASE_PATH included, and these tests would run against db.sqlite in the
// working directory instead of a temporary one.
const workingDir = mkdtempSync(join(tmpdir(), "csgobot-conn-"));
const dbPath = join(workingDir, "connection.sqlite");
process.env.DATABASE_PATH = dbPath;
process.env.DISCORD_GUILD_ID = "123456789012345678";
process.env.DISCORD_TOKEN = "test-token";
process.env.LOG_LEVEL = "silent";

const { getStatement } = await import("../src/db/connection.js");
const { closeDB, countUserFollows, followMap, initDB } = await import("../src/db/index.js");

/**
 * Inspect the database through a second connection, so the assertions read the
 * file rather than the module's own handle.
 * @param {Function} run - Receives the raw better-sqlite3 handle
 * @returns {any} - Whatever `run` returned
 */
function withRawDatabase(run) {
    const raw = new Database(dbPath);
    try {
        return run(raw);
    } finally {
        raw.close();
    }
}

after(() => {
    rmSync(workingDir, { force: true, recursive: true });
});

it("refuses to prepare a statement before the database is initialized", () => {
    assert.throws(() => getStatement("SELECT 1"), /Database not initialized/);
});

it("creates the table and both indexes", () => {
    initDB();

    const names = withRawDatabase((raw) =>
        raw.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'index')").all().map((row) => row.name)
    );

    assert.ok(names.includes("players_follow"));
    assert.ok(names.includes("idx_map_name"));
    assert.ok(names.includes("sqlite_autoindex_players_follow_1"), "the UNIQUE constraint's index");
});

it("drops an older database's discord_id index and looks users up through the UNIQUE index", () => {
    withRawDatabase((raw) => raw.exec("CREATE INDEX idx_discord_id ON players_follow(discord_id)"));
    initDB();

    const { hasIndex, plan } = withRawDatabase((raw) => ({
        hasIndex: raw.prepare("SELECT 1 FROM sqlite_master WHERE name = 'idx_discord_id'").get() !== undefined,
        plan: raw.prepare("EXPLAIN QUERY PLAN SELECT map_name FROM players_follow WHERE discord_id = ?").all("100000000000000042").map((row) => row.detail).join("; ")
    }));

    assert.equal(hasIndex, false);
    assert.ok(plan.includes("sqlite_autoindex_players_follow_1"), plan);
});

it("puts the database in WAL mode", () => {
    assert.equal(withRawDatabase((raw) => raw.pragma("journal_mode", { simple: true })), "wal");
});

it("returns getAllFollows' rows in order without sorting them", () => {
    const plan = withRawDatabase((raw) =>
        raw
            .prepare("EXPLAIN QUERY PLAN SELECT discord_id, map_name FROM players_follow ORDER BY discord_id, map_name")
            .all()
            .map((row) => row.detail)
            .join("; ")
    );

    assert.ok(plan.includes("USING COVERING INDEX"), plan);
    assert.ok(!plan.includes("TEMP B-TREE"), plan);
});

it("rejects a row the schema forbids", () => {
    // Both columns are NOT NULL, which the Zod schemas enforce first; this is the
    // backstop for anything that ever reaches a statement another way.
    assert.throws(
        () => withRawDatabase((raw) => raw.prepare("INSERT INTO players_follow (discord_id, map_name) VALUES (?, ?)").run(null, "de_dust2")),
        /NOT NULL/
    );
});

it("is safe to initialize twice and keeps the existing data", () => {
    followMap("100000000000000042", "de_dust2");
    initDB();

    assert.equal(countUserFollows("100000000000000042"), 1);
});

it("makes statements unusable again after closeDB", () => {
    closeDB();

    assert.throws(() => getStatement("SELECT 1"), /Database not initialized/);
    assert.throws(() => countUserFollows("100000000000000042"), /Database not initialized/);
});
