/**
 * The split that decides whether a failure is retried on a growing backoff or
 * reported once with its remedy. Both directions are expensive to get wrong: a
 * terminal code retried forever, or a transient one abandoned on first sight.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { RESTJSONErrorCodes } from "discord.js";

import { getTerminalReason, isRecipientRefusal, isRetryableDiscordError, TerminalError } from "../src/utils/discordErrors.js";

const TERMINAL_CODES = [
    RESTJSONErrorCodes.UnknownChannel,
    RESTJSONErrorCodes.UnknownMessage,
    RESTJSONErrorCodes.MissingAccess,
    RESTJSONErrorCodes.CannotSendMessagesToThisUser,
    RESTJSONErrorCodes.MissingPermissions,
    RESTJSONErrorCodes.CannotSendMessagesToThisUserDueToHavingNoMutualGuilds
];

describe("getTerminalReason", () => {
    it("gives every terminal code a non-empty remediation hint", () => {
        for (const code of TERMINAL_CODES) {
            const reason = getTerminalReason({ code });

            assert.equal(typeof reason, "string", `code ${code} should be terminal`);
            assert.ok(reason.length > 0, `code ${code} should carry a hint`);
        }
    });

    it("treats an unmapped API code as retryable", () => {
        assert.equal(getTerminalReason({ code: 500 }), null);
        assert.equal(getTerminalReason({ code: 0 }), null);
    });

    it("does not confuse a node string code with the numeric API code it spells", () => {
        // The lookup is a Map keyed by number, so "10003" must miss where 10003 hits.
        assert.equal(getTerminalReason({ code: String(RESTJSONErrorCodes.UnknownChannel) }), null);
        assert.equal(getTerminalReason({ code: "ECONNRESET" }), null);
        assert.equal(getTerminalReason({ code: "ETIMEDOUT" }), null);
    });

    it("survives an error with no code at all", () => {
        assert.equal(getTerminalReason(new Error("boom")), null);
        assert.equal(getTerminalReason(null), null);
        assert.equal(getTerminalReason(), null);
    });

    it("returns a TerminalError's hint ahead of any code lookup", () => {
        assert.equal(getTerminalReason(new TerminalError("failed", "do this instead")), "do this instead");
    });
});

describe("TerminalError", () => {
    it("falls back to its message when no hint is given", () => {
        const error = new TerminalError("channel is not a text channel");

        assert.equal(error.hint, "channel is not a text channel");
        assert.equal(error.name, "TerminalError");
        assert.ok(error instanceof Error);
    });
});

describe("isRecipientRefusal", () => {
    it("is true only for the two codes describing the recipient", () => {
        assert.equal(isRecipientRefusal({ code: RESTJSONErrorCodes.CannotSendMessagesToThisUser }), true);
        assert.equal(isRecipientRefusal({ code: RESTJSONErrorCodes.CannotSendMessagesToThisUserDueToHavingNoMutualGuilds }), true);
    });

    it("is false for terminal codes describing the request", () => {
        assert.equal(isRecipientRefusal({ code: RESTJSONErrorCodes.MissingAccess }), false);
        assert.equal(isRecipientRefusal({ code: RESTJSONErrorCodes.UnknownChannel }), false);
    });

    it("is false for anything without a matching code", () => {
        assert.equal(isRecipientRefusal(new TerminalError("no channel")), false);
        assert.equal(isRecipientRefusal(new Error("boom")), false);
        assert.equal(isRecipientRefusal(), false);
    });
});

describe("isRetryableDiscordError", () => {
    it("is the exact inverse of getTerminalReason", () => {
        for (const code of TERMINAL_CODES) {
            assert.equal(isRetryableDiscordError({ code }), false, `code ${code} should not be retried`);
        }

        assert.equal(isRetryableDiscordError({ code: 500 }), true);
        assert.equal(isRetryableDiscordError({ code: "ECONNRESET" }), true);
        assert.equal(isRetryableDiscordError(new Error("boom")), true);
        assert.equal(isRetryableDiscordError(new TerminalError("pre-check failed")), false);
    });
});
