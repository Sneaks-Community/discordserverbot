import Database from "better-sqlite3";

import { config } from "../config/index.js";
import { dbLogger } from "../utils/logger.js";

let db = null;

/**
 * Keyed by SQL text. Statements belong to the connection that created them, so
 * this is cleared whenever the connection changes.
 * @type {Map<string, import("better-sqlite3").Statement>}
 */
const statementCache = new Map();

/**
 * The path is DATABASE_PATH. In Docker set it to /app/data/db.sqlite so the file
 * lands on the persistent volume, not the container's writable layer.
 */
export function initDB() {
    const dbPath = config.databasePath;
    dbLogger.info(`Initializing database at: ${dbPath}`);
    // A repeat call must not leak the previous connection or its statements.
    closeDB();
    db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    // Wait out a WAL checkpoint or open sqlite3 shell instead of throwing SQLITE_BUSY.
    // better-sqlite3 blocks the process meanwhile; 5s outlasts a checkpoint.
    db.pragma("busy_timeout = 5000");

    const initTransaction = db.transaction(() => {
        // REPLACE changes the rowid, safe because nothing references this table.
        // NOT NULL binds only new databases; follows.js's Zod schemas guard old ones.
        db.exec(`
            CREATE TABLE IF NOT EXISTS players_follow (
                discord_id TEXT NOT NULL,
                map_name TEXT NOT NULL,
                UNIQUE(discord_id, map_name) ON CONFLICT REPLACE
            )
        `);
        db.exec("CREATE INDEX IF NOT EXISTS idx_map_name ON players_follow(map_name)");
        // Redundant with the UNIQUE index, which leads with discord_id.
        db.exec("DROP INDEX IF EXISTS idx_discord_id");

        // CHECK (id = 1): one server list message is the table's own invariant.
        db.exec(`
            CREATE TABLE IF NOT EXISTS embed_message (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                channel_id TEXT NOT NULL,
                message_id TEXT NOT NULL
            )
        `);
    });

    initTransaction();
}

export function closeDB() {
    statementCache.clear();
    if (db) {
        db.close();
        db = null;
    }
}

/**
 * Prepares on first use, then reuses.
 * @param {string} sql
 * @returns {import("better-sqlite3").Statement}
 * @throws {Error} If the database has not been initialized
 */
export function getStatement(sql) {
    if (!db) throw new Error("Database not initialized");
    let stmt = statementCache.get(sql);
    if (!stmt) {
        stmt = db.prepare(sql);
        statementCache.set(sql, stmt);
    }
    return stmt;
}
