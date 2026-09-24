/**
 * parseEnv is the whole configuration contract: each variable's default, the
 * values it accepts, and the message an operator sees for one it rejects.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatEnvIssue, parseEnv } from "../src/schemas/envSchema.js";

/** The two variables with no default; everything else may be absent. */
const REQUIRED = Object.freeze({ DISCORD_GUILD_ID: "123456789012345678", DISCORD_TOKEN: "a-token" });

/**
 * @param {object} [extra] - Variables to add to a valid baseline
 * @returns {object} - An environment that parses unless `extra` breaks it
 */
function env(extra = {}) {
    return { ...REQUIRED, ...extra };
}

describe("parseEnv, defaults", () => {
    it("accepts an environment with only the required variables", () => {
        const { errors, values } = parseEnv(env());

        assert.deepEqual(errors, []);
        assert.equal(values.SERVER_UPDATE_INTERVAL, 90);
        assert.equal(values.EMBED_COLOR, 7980240);
        assert.equal(values.DATABASE_PATH, "db.sqlite");
        assert.equal(values.BOT_ACTIVITY_TYPE, "custom");
        assert.equal(values.EMBED_CHANNEL_ID, "");
    });

    it("treats an empty value as unset", () => {
        const { errors, values } = parseEnv(env({ DATABASE_PATH: "", SERVER_UPDATE_INTERVAL: "  " }));

        assert.deepEqual(errors, []);
        assert.equal(values.SERVER_UPDATE_INTERVAL, 90);
        assert.equal(values.DATABASE_PATH, "db.sqlite");
    });

    it("warns about each optional feature left unset", () => {
        const { warnings } = parseEnv(env());

        assert.equal(warnings.length, 3);
        assert.ok(warnings.some((warning) => warning.startsWith("ADMIN_ROLE_ID is not set")));
        assert.ok(warnings.some((warning) => warning.startsWith("FALLBACK_CHANNEL_ID is not set")));
        assert.ok(warnings.some((warning) => warning.startsWith("EMBED_CHANNEL_ID is not set")));
    });

    it("does not warn about a feature that is configured", () => {
        const { warnings } = parseEnv(env({ ADMIN_ROLE_ID: "123456789012345678" }));

        assert.ok(!warnings.some((warning) => warning.startsWith("ADMIN_ROLE_ID")));
    });
});

describe("parseEnv, required variables", () => {
    it("reports both required variables at once", () => {
        const { errors } = parseEnv({});

        assert.deepEqual(errors, [
            "DISCORD_GUILD_ID: is required and must be a Discord ID (17-19 digits)",
            "DISCORD_TOKEN: is required and must not be empty"
        ]);
    });

    it("still returns usable values after a failure, so importing config cannot throw", () => {
        const { errors, values } = parseEnv({});

        assert.ok(errors.length > 0);
        assert.equal(values.SERVER_UPDATE_INTERVAL, 90);
    });

    it("trims a pasted token", () => {
        assert.equal(parseEnv(env({ DISCORD_TOKEN: "  tok\n" })).values.DISCORD_TOKEN, "tok");
    });

    it("rejects a guild id that is not a snowflake", () => {
        assert.deepEqual(parseEnv(env({ DISCORD_GUILD_ID: "not-an-id" })).errors, [
            "DISCORD_GUILD_ID: is required and must be a Discord ID (17-19 digits)"
        ]);
    });
});

describe("parseEnv, numbers", () => {
    it("rejects a value parseInt would have accepted", () => {
        assert.deepEqual(parseEnv(env({ SERVER_UPDATE_INTERVAL: "10s" })).errors, [
            "SERVER_UPDATE_INTERVAL: must be a whole number"
        ]);
    });

    it("rejects zero retry attempts, since a retried operation needs at least one", () => {
        assert.deepEqual(parseEnv(env({ RETRY_MAX_RETRIES: "0" })).errors, [
            "RETRY_MAX_RETRIES: must be between 1 and 10"
        ]);
    });

    it("rejects an interval that would hammer the game servers", () => {
        assert.deepEqual(parseEnv(env({ SERVER_UPDATE_INTERVAL: "29" })).errors, [
            "SERVER_UPDATE_INTERVAL: must be between 30 and 86400"
        ]);
    });

    it("collects every bad number rather than stopping at the first", () => {
        const { errors } = parseEnv(env({ GAMEDIG_MAX_RETRIES: "11", HEALTH_PORT: "x", MAX_FOLLOWS_PER_USER: "-1" }));

        assert.equal(errors.length, 3);
    });
});

describe("parseEnv, EMBED_COLOR", () => {
    it("parses a hex color into the integer discord.js takes", () => {
        assert.equal(parseEnv(env({ EMBED_COLOR: "#79c4d0" })).values.EMBED_COLOR, 7980240);
        assert.equal(parseEnv(env({ EMBED_COLOR: "79C4D0" })).values.EMBED_COLOR, 7980240);
        assert.equal(parseEnv(env({ EMBED_COLOR: "#000000" })).values.EMBED_COLOR, 0);
        assert.equal(parseEnv(env({ EMBED_COLOR: "#ffffff" })).values.EMBED_COLOR, 16777215);
    });

    it("rejects anything that is not six hex digits", () => {
        for (const value of ["7980240", "#79c4", "#79c4d0d0", "#79c4dg"]) {
            assert.deepEqual(parseEnv(env({ EMBED_COLOR: value })).errors, [
                "EMBED_COLOR: must be a hex color, for example #79C4D0"
            ], value);
        }
    });
});

describe("parseEnv, EMBED_CHANNEL_ID", () => {
    it("accepts a channel ID", () => {
        const { errors, values } = parseEnv(env({ EMBED_CHANNEL_ID: "123456789012345678" }));

        assert.deepEqual(errors, []);
        assert.equal(values.EMBED_CHANNEL_ID, "123456789012345678");
    });

    it("treats empty as the feature being switched off, not an error", () => {
        const { errors, warnings } = parseEnv(env({ EMBED_CHANNEL_ID: "" }));

        assert.deepEqual(errors, []);
        assert.ok(warnings.some((warning) => warning.startsWith("EMBED_CHANNEL_ID is not set")));
    });

    it("rejects a mistyped ID rather than quietly disabling the server list", () => {
        const { errors } = parseEnv(env({ EMBED_CHANNEL_ID: "#server-status" }));

        assert.equal(errors.length, 1);
        assert.ok(errors[0].startsWith("EMBED_CHANNEL_ID: must be a Discord ID"), errors[0]);
    });
});

describe("parseEnv, URLs and presence", () => {
    it("requires the map image base to end in a slash", () => {
        const { errors } = parseEnv(env({ MAP_IMAGE_BASE_URL: "https://images.test/maps" }));

        assert.equal(errors.length, 1);
        assert.ok(errors[0].startsWith("MAP_IMAGE_BASE_URL: "));
    });

    it("accepts an empty map image base as \"no images\"", () => {
        const { errors, values } = parseEnv(env({ MAP_IMAGE_BASE_URL: "" }));

        assert.deepEqual(errors, []);
        assert.equal(values.MAP_IMAGE_BASE_URL, "");
    });

    it("defaults the map image base when it is absent", () => {
        assert.ok(parseEnv(env()).values.MAP_IMAGE_BASE_URL.endsWith("/"));
    });

    it("rejects a non-http fallback avatar", () => {
        assert.deepEqual(parseEnv(env({ FALLBACK_AVATAR_URL: "ftp://example.test/a.png" })).errors, [
            "FALLBACK_AVATAR_URL: must be an http(s) URL"
        ]);
    });

    it("lowercases the activity type and rejects an unknown one", () => {
        assert.equal(parseEnv(env({ BOT_ACTIVITY_TYPE: "PLAYING" })).values.BOT_ACTIVITY_TYPE, "playing");
        assert.deepEqual(parseEnv(env({ BOT_ACTIVITY_TYPE: "dancing" })).errors, [
            "BOT_ACTIVITY_TYPE: must be one of: competing, custom, listening, playing, watching"
        ]);
    });

    it("rejects activity text Discord would not display", () => {
        assert.equal(parseEnv(env({ BOT_ACTIVITY_TEXT: "x".repeat(129) })).errors.length, 1);
        assert.deepEqual(parseEnv(env({ BOT_ACTIVITY_TEXT: "x".repeat(128) })).errors, []);
    });
});

describe("formatEnvIssue", () => {
    it("renders a top-level issue as VARIABLE: message", () => {
        assert.equal(formatEnvIssue({ message: "is required", path: ["DISCORD_TOKEN"] }), "DISCORD_TOKEN: is required");
    });
});
