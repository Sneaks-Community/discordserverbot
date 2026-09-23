/**
 * Pruning deletes real user data, so a member list the guards distrust must
 * leave every follow in place.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";

// Before the imports: without the required variables DATABASE_PATH falls back to db.sqlite.
const workingDir = mkdtempSync(join(tmpdir(), "csgobot-reconcile-"));
process.env.DATABASE_PATH = join(workingDir, "reconcile.sqlite");
process.env.DISCORD_GUILD_ID = "123456789012345678";
process.env.DISCORD_TOKEN = "test-token";
process.env.LOG_LEVEL = "silent";

const { reconcileFollows, selectDepartedFollowers } = await import("../src/services/followReconciliation.js");
const { closeDB, followMap, getFollowerIds, initDB, unfollowAll } = await import("../src/db/index.js");

const PRESENT = "100000000000000001";
const ALSO_PRESENT = "100000000000000002";
const DEPARTED = "200000000000000001";
const ALSO_DEPARTED = "200000000000000002";

describe("selectDepartedFollowers", () => {
    it("returns only the followers missing from the member list", () => {
        const departed = selectDepartedFollowers(
            [PRESENT, DEPARTED, ALSO_PRESENT, ALSO_DEPARTED],
            new Set([PRESENT, ALSO_PRESENT])
        );

        assert.deepEqual(departed, [DEPARTED, ALSO_DEPARTED]);
    });

    it("returns nothing when every follower is still a member", () => {
        assert.deepEqual(selectDepartedFollowers([PRESENT, ALSO_PRESENT], new Set([PRESENT, ALSO_PRESENT])), []);
    });

    it("ignores members who follow nothing", () => {
        assert.deepEqual(selectDepartedFollowers([PRESENT], new Set([PRESENT, ALSO_PRESENT, DEPARTED])), []);
    });

    it("returns nothing for an empty follower list, whatever the guild holds", () => {
        assert.deepEqual(selectDepartedFollowers([], new Set([PRESENT])), []);
    });

    it("reports every follower when the member set is empty", () => {
        assert.deepEqual(selectDepartedFollowers([PRESENT, DEPARTED], new Set()), [PRESENT, DEPARTED]);
    });

    it("compares ids as strings, so a numeric snowflake is not treated as present", () => {
        assert.deepEqual(selectDepartedFollowers([PRESENT], new Set([Number(PRESENT)])), [PRESENT]);
    });

    it("preserves input order", () => {
        assert.deepEqual(selectDepartedFollowers([ALSO_DEPARTED, PRESENT, DEPARTED], new Set([PRESENT])), [ALSO_DEPARTED, DEPARTED]);
    });
});

/**
 * @param {string[]} memberIds - What the member fetch returns
 * @param {number} [memberCount] - What the guild reports, by default the fetched count
 * @returns {object} - Just enough of a Client for reconcileFollows
 */
function fakeBot(memberIds, memberCount = memberIds.length) {
    const members = new Map(memberIds.map((id) => [id, {}]));
    const guild = { memberCount, members: { fetch: () => Promise.resolve(members) } };
    return { guilds: { cache: new Map([[process.env.DISCORD_GUILD_ID, guild]]) } };
}

describe("reconcileFollows", () => {
    before(() => {
        initDB();
    });

    // reconcileFollows reads every follower, so no test may see another's rows.
    beforeEach(() => {
        for (const id of getFollowerIds()) unfollowAll(id);
    });

    after(() => {
        closeDB();
        rmSync(workingDir, { force: true, recursive: true });
    });

    it("prunes every follow of a departed member and keeps the members still here", async () => {
        followMap(PRESENT, "de_dust2");
        followMap(DEPARTED, "de_dust2");
        followMap(DEPARTED, "de_inferno");

        await reconcileFollows(fakeBot([PRESENT]));

        assert.deepEqual(getFollowerIds(), [PRESENT]);
    });

    it("prunes nothing from an empty or short member list", async () => {
        followMap(PRESENT, "de_dust2");
        followMap(DEPARTED, "de_dust2");

        await reconcileFollows(fakeBot([]));
        await reconcileFollows(fakeBot([PRESENT], 2));

        assert.deepEqual(getFollowerIds().sort(), [PRESENT, DEPARTED]);
    });

    it("prunes nothing when more members left than the safety limit allows", async () => {
        for (let i = 0; i < 501; i++) {
            followMap(`3${String(i).padStart(17, "0")}`, "de_dust2");
        }

        await reconcileFollows(fakeBot([PRESENT]));

        assert.equal(getFollowerIds().length, 501);
    });
});
