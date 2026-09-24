/**
 * joinWithinLimit's contract is a hard one: "never longer than `limit`", on every
 * branch. Discord rejects the whole request when an embed description passes 4096
 * characters, so a single off-by-one here is a listing that stops working once it
 * grows enough, and only then.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { clampText, EMBED_DESCRIPTION_LIMIT, EMBED_FIELD_NAME_LIMIT, EMBED_FIELD_VALUE_LIMIT, EMBED_TITLE_LIMIT, EMBED_TOTAL_LIMIT, joinWithinLimit, MESSAGE_CONTENT_LIMIT } from "../src/utils/truncate.js";

describe("joinWithinLimit", () => {
    it("joins with newlines when everything fits", () => {
        assert.equal(joinWithinLimit(["one", "two", "three"], 100), "one\ntwo\nthree");
    });

    it("returns the joined text untouched at exactly the limit", () => {
        const joined = joinWithinLimit(["abc", "def"], 7);

        assert.equal(joined, "abc\ndef");
        assert.equal(joined.length, 7);
    });

    it("drops non-strings and empty strings before joining", () => {
        assert.equal(joinWithinLimit(["a", "", undefined, 5, null, "b"], 100), "a\nb");
    });

    it("returns an empty string when nothing survives the filter", () => {
        assert.equal(joinWithinLimit([], 100), "");
        assert.equal(joinWithinLimit(["", undefined, 7], 100), "");
    });

    it("keeps a whole prefix of the lines and reports the rest", () => {
        const lines = Array.from({ length: 50 }, (_, index) => `line ${index}`);
        const result = joinWithinLimit(lines, 100);
        const [body, notice] = result.split("\n...and ");

        assert.ok(result.length <= 100);
        assert.match(notice, /^\d+ more$/);

        // The kept lines must be the first N, in order, and the count must add up.
        const kept = body.split("\n");
        assert.deepEqual(kept, lines.slice(0, kept.length));
        assert.equal(Number.parseInt(notice, 10), lines.length - kept.length);
    });

    it("hard-truncates a single line that cannot fit, marking the cut", () => {
        const result = joinWithinLimit(["x".repeat(500)], 100);

        assert.equal(result.length, 100);
        assert.ok(result.endsWith("…"));
    });

    it("never exceeds the limit, whatever the limit is", () => {
        const lines = ["short", "a considerably longer line than the others", "mid", "y".repeat(200)];

        for (let limit = 1; limit <= 120; limit++) {
            assert.ok(joinWithinLimit(lines, limit).length <= limit, `overflowed at limit ${limit}`);
        }
    });

    it("states Discord's limits as Discord defines them", () => {
        assert.equal(EMBED_DESCRIPTION_LIMIT, 4096);
        assert.equal(EMBED_FIELD_NAME_LIMIT, 256);
        assert.equal(EMBED_FIELD_VALUE_LIMIT, 1024);
        assert.equal(EMBED_TITLE_LIMIT, 256);
        assert.equal(EMBED_TOTAL_LIMIT, 6000);
        assert.equal(MESSAGE_CONTENT_LIMIT, 2000);
    });
});

describe("clampText", () => {
    it("leaves a value that already fits alone", () => {
        assert.equal(clampText("de_dust2", 64), "de_dust2");
        assert.equal(clampText("exactly-ten", 11), "exactly-ten");
    });

    it("marks the cut so a truncated value cannot pass as the real one", () => {
        const result = clampText("a".repeat(100), 10);

        assert.equal(result.length, 10);
        assert.equal(result, "aaaaaaaaa\u2026");
    });

    it("never exceeds the limit, whatever the limit is", () => {
        for (let limit = 0; limit <= 50; limit++) {
            assert.ok(clampText("z".repeat(200), limit).length <= limit, `overflowed at limit ${limit}`);
        }
    });

    it("returns an empty string for a limit of zero", () => {
        assert.equal(clampText("anything", 0), "");
    });

    it("coerces a non-string rather than throwing on .length", () => {
        assert.equal(clampText(undefined, 10), "");
        assert.equal(clampText(null, 10), "");
        assert.equal(clampText(42, 10), "42");
    });
});
