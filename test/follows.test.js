/**
 * The follow operations against a real SQLite file, because the behavior worth
 * testing is the behavior SQLite provides: the UNIQUE(discord_id, map_name)
 * conflict clause, the ordering getAllFollows relies on, and the Zod validation
 * that stands between a Discord interaction and a statement.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

// config reads the environment once, when it is imported, so all of this has to be
// set before the dynamic import below. The required variables are part of that:
// without them parseEnv reports errors and hands back placeholder values, which
// would take DATABASE_PATH with it and write db.sqlite into the working directory.
const workingDir = mkdtempSync(join(tmpdir(), "csgobot-follows-"));
process.env.DATABASE_PATH = join(workingDir, "follows.sqlite");
process.env.DISCORD_GUILD_ID = "123456789012345678";
process.env.DISCORD_TOKEN = "test-token";
process.env.LOG_LEVEL = "silent";

const {
    closeDB,
    countUserFollows,
    followMap,
    getAllFollows,
    getUserFollows,
    getUsersFollowingMap,
    initDB,
    isFollowingMap,
    unfollowAll,
    unfollowMap
} = await import("../src/db/index.js");

/** Every test owns its user id, so one shared database needs no cleanup between them. */
const USER = Object.freeze({
    all: "100000000000000007",
    conflict: "100000000000000002",
    count: "100000000000000004",
    listA: "100000000000000005",
    listB: "100000000000000006",
    other: "100000000000000008",
    shared: "100000000000000009",
    simple: "100000000000000001",
    unfollow: "100000000000000003"
});

before(() => {
    initDB();
});

after(() => {
    closeDB();
    rmSync(workingDir, { force: true, recursive: true });
});

describe("following and unfollowing", () => {
    it("records a follow and reads it back", () => {
        followMap(USER.simple, "de_dust2");

        assert.equal(isFollowingMap(USER.simple, "de_dust2"), true);
        assert.deepEqual(getUserFollows(USER.simple), [{ map_name: "de_dust2" }]);
    });

    it("reports a map the user does not follow", () => {
        assert.equal(isFollowingMap(USER.simple, "de_nuke"), false);
    });

    it("stores and matches map names case-insensitively", () => {
        followMap(USER.conflict, "DE_Mirage");

        assert.deepEqual(getUserFollows(USER.conflict), [{ map_name: "de_mirage" }]);
        assert.equal(isFollowingMap(USER.conflict, "de_MIRAGE"), true);
    });

    it("replaces rather than duplicates a repeated follow", () => {
        followMap(USER.conflict, "de_mirage");
        followMap(USER.conflict, "de_mirage");

        assert.equal(countUserFollows(USER.conflict), 1);
    });

    it("removes only the map asked for", () => {
        followMap(USER.unfollow, "de_inferno");
        followMap(USER.unfollow, "de_overpass");
        unfollowMap(USER.unfollow, "de_inferno");

        assert.equal(isFollowingMap(USER.unfollow, "de_inferno"), false);
        assert.equal(isFollowingMap(USER.unfollow, "de_overpass"), true);
    });

    it("ignores an unfollow of a map that was never followed", () => {
        unfollowMap(USER.unfollow, "de_vertigo");

        assert.equal(countUserFollows(USER.unfollow), 1);
    });

    it("counts nothing for a user with no follows", () => {
        assert.equal(countUserFollows(USER.count), 0);
        assert.deepEqual(getUserFollows(USER.count), []);
    });

    it("clears one user's follows and leaves everyone else alone", () => {
        followMap(USER.all, "de_cache");
        followMap(USER.all, "de_train");
        followMap(USER.other, "de_cache");

        unfollowAll(USER.all);

        assert.equal(countUserFollows(USER.all), 0);
        assert.equal(countUserFollows(USER.other), 1);
    });
});

describe("lookups by map", () => {
    it("finds every follower of a map", () => {
        followMap(USER.shared, "cs_office");
        followMap(USER.other, "cs_office");

        const followers = getUsersFollowingMap("cs_office").map((row) => row.discord_id);

        assert.equal(followers.length, 2);
        assert.ok(followers.includes(USER.shared));
        assert.ok(followers.includes(USER.other));
    });
});

describe("getAllFollows", () => {
    it("returns rows ordered by user and then by map", () => {
        followMap(USER.listB, "de_zulu");
        followMap(USER.listB, "de_alpha");
        followMap(USER.listA, "de_yankee");
        followMap(USER.listA, "de_bravo");

        // Other tests share the table, so compare only the rows this test owns;
        // filtering preserves the order the query returned them in.
        const mine = getAllFollows().filter((row) => row.discord_id === USER.listA || row.discord_id === USER.listB);

        assert.deepEqual(mine, [
            { discord_id: USER.listA, map_name: "de_bravo" },
            { discord_id: USER.listA, map_name: "de_yankee" },
            { discord_id: USER.listB, map_name: "de_alpha" },
            { discord_id: USER.listB, map_name: "de_zulu" }
        ]);
    });
});

describe("input validation", () => {
    it("rejects a discord id that is not a snowflake", () => {
        assert.throws(() => followMap("nope", "de_dust2"), /followMap\/discord_id: Discord ID/);
        assert.throws(() => getUserFollows("12"), /getUserFollows\/discord_id: Discord ID/);
        assert.throws(() => unfollowAll(""), /unfollowAll\/discord_id: Discord ID/);
    });

    it("rejects a map name with characters a map name cannot have", () => {
        assert.throws(() => followMap(USER.simple, "de dust2"), /followMap\/map_name: Map name contains invalid characters/);
        assert.throws(() => followMap(USER.simple, "de/dust2"), /followMap\/map_name: Map name contains invalid characters/);
    });

    it("rejects an empty or over-long map name", () => {
        assert.throws(() => followMap(USER.simple, ""), /Map name cannot be empty/);
        assert.throws(() => followMap(USER.simple, "d".repeat(65)), /Map name cannot exceed 64 characters/);
    });

    it("accepts a map name of exactly the maximum length", () => {
        const longest = "d".repeat(64);
        followMap(USER.count, longest);

        assert.equal(isFollowingMap(USER.count, longest), true);
        unfollowAll(USER.count);
    });

    it("rejects a non-string before it reaches a statement", () => {
        for (const value of [null, undefined, 42, {}]) {
            assert.throws(() => followMap(USER.simple, value), /followMap\/map_name/);
            assert.throws(() => getUsersFollowingMap(value), /getUsersFollowingMap\/map_name/);
        }
    });
});
