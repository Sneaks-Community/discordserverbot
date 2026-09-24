/**
 * The pre-check that turns a channel the bot cannot use into a terminal error
 * naming the fix, instead of a failed post on every tick.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PermissionFlagsBits, PermissionsBitField } from "discord.js";

import { findChannelProblem, SEND_PERMISSIONS, STATUS_PERMISSIONS } from "../src/utils/permissions.js";

/**
 * @param {bigint | bigint[]} granted - The bot's permissions in the channel
 * @param {object} [overrides]
 * @returns {object} - Just enough of a guild text channel
 */
function channel(granted, overrides = {}) {
    return {
        guild: { members: { me: {} } },
        isDMBased: () => false,
        isTextBased: () => true,
        permissionsFor: () => new PermissionsBitField(granted),
        ...overrides
    };
}

describe("findChannelProblem", () => {
    it("names each missing permission in Discord's wording", () => {
        const { SendMessages, ViewChannel } = PermissionFlagsBits;

        assert.equal(findChannelProblem(channel([ViewChannel, SendMessages]), STATUS_PERMISSIONS), "Missing permissions: EmbedLinks, ReadMessageHistory");
    });

    it("passes a channel with every required permission, or Administrator", () => {
        assert.equal(findChannelProblem(channel(SEND_PERMISSIONS), SEND_PERMISSIONS), null);
        assert.equal(findChannelProblem(channel(PermissionFlagsBits.Administrator), STATUS_PERMISSIONS), null);
    });

    it("rejects a channel it cannot check", () => {
        assert.equal(findChannelProblem(null, SEND_PERMISSIONS), "Not a text channel in a guild");
        assert.equal(findChannelProblem(channel(SEND_PERMISSIONS, { isTextBased: () => false }), SEND_PERMISSIONS), "Not a text channel in a guild");
        assert.equal(findChannelProblem(channel(SEND_PERMISSIONS, { permissionsFor: () => null }), SEND_PERMISSIONS), "Could not resolve the bot's permissions");
    });
});
