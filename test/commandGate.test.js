/**
 * The dispatcher's admin gate. Hiding a command in Discord's picker is not a
 * gate, this is: setDefaultMemberPermissions is advisory and a crafted
 * interaction reaches the handler regardless.
 *
 * Handlers are injected into COMMANDS_BY_NAME rather than exercising the real
 * ones, so these assert routing and refusal alone, with no database in play.
 */

import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { MessageFlags } from "discord.js";

const GUILD = "123456789012345678";
const ADMIN_ROLE = "222222222222222222";
const OWNER = "300000000000000001";
const STRANGER = "400000000000000001";

process.env.ADMIN_ROLE_ID = ADMIN_ROLE;
process.env.DISCORD_GUILD_ID = GUILD;
process.env.DISCORD_TOKEN = "test-token";
process.env.LOG_LEVEL = "silent";

const { COMMANDS_BY_NAME } = await import("../src/commands/definitions.js");
const { handleInteraction } = await import("../src/commands/index.js");

const injected = [];

/**
 * Registers a stand-in command in the map the dispatcher routes through.
 * @param {string} name
 * @param {boolean} admin
 * @param {Function} [handler] - Defaults to one that records the call
 * @returns {{ calls: () => number }}
 */
function inject(name, admin, handler) {
    let calls = 0;

    injected.push(name);
    COMMANDS_BY_NAME.set(name, {
        admin,
        description: "injected by commandGate.test.js",
        handler: interactionArg => {
            calls++;
            return handler?.(interactionArg);
        },
        name
    });

    return { calls: () => calls };
}

/**
 * Only the fields the dispatcher reads, plus a `replies` log of every payload
 * it sent back.
 * @param {object} fields
 * @param {boolean} [fields.admin] - Whether the member holds Administrator
 * @param {boolean} [fields.chatInput]
 * @param {string} fields.command
 * @param {boolean} [fields.inGuild]
 * @returns {object}
 */
function interaction(fields) {
    const { admin = false, chatInput = true, command, inGuild = true } = fields;
    const replies = [];

    return {
        commandName: command,
        deferred: false,
        editReply: payload => {
            replies.push(payload);
            return Promise.resolve(payload);
        },
        guild: { ownerId: OWNER },
        guildId: GUILD,
        inGuild: () => inGuild,
        isButton: () => false,
        isChatInputCommand: () => chatInput,
        member: { roles: [] },
        memberPermissions: { has: () => admin },
        replied: false,
        replies,
        reply: payload => {
            replies.push(payload);
            return Promise.resolve(payload);
        },
        user: { id: STRANGER, username: "tester" }
    };
}

after(() => {
    for (const name of injected) COMMANDS_BY_NAME.delete(name);
});

describe("handleInteraction admin gate", () => {
    it("refuses an admin command from a non-admin and never reaches the handler", async () => {
        const spy = inject("gate-admin-refused", true);
        const request = interaction({ command: "gate-admin-refused" });

        await handleInteraction(request);

        assert.equal(spy.calls(), 0, "the handler must not run for a non-admin");
        assert.equal(request.replies.length, 1);
        assert.match(request.replies[0].content, /do not have permission/i);
        assert.equal(request.replies[0].flags, MessageFlags.Ephemeral);
    });

    it("runs an admin command for an admin", async () => {
        const spy = inject("gate-admin-allowed", true);
        const request = interaction({ admin: true, command: "gate-admin-allowed" });

        await handleInteraction(request);

        assert.equal(spy.calls(), 1);
        assert.deepEqual(request.replies, []);
    });

    it("runs a non-admin command for anyone", async () => {
        const spy = inject("gate-open", false);
        const request = interaction({ command: "gate-open" });

        await handleInteraction(request);

        assert.equal(spy.calls(), 1);
        assert.deepEqual(request.replies, []);
    });

    it("keeps every shipped admin command marked admin", () => {
        // The gate reads this flag, so a definition that loses it silently opens
        // a database-wide command to everyone.
        for (const name of ["listallfollows", "removeuser", "testnotify"]) {
            assert.equal(COMMANDS_BY_NAME.get(name)?.admin, true, `${name} must stay admin-only`);
        }
    });
});

describe("handleInteraction routing", () => {
    it("ignores anything that is not a chat input command", async () => {
        const spy = inject("gate-not-chat-input", false);
        const request = interaction({ chatInput: false, command: "gate-not-chat-input" });

        await handleInteraction(request);

        assert.equal(spy.calls(), 0);
        assert.deepEqual(request.replies, []);
    });

    it("refuses an interaction from outside a guild", async () => {
        const spy = inject("gate-dm", false);
        const request = interaction({ command: "gate-dm", inGuild: false });

        await handleInteraction(request);

        assert.equal(spy.calls(), 0);
        assert.match(request.replies[0].content, /only available in servers/i);
        assert.equal(request.replies[0].flags, MessageFlags.Ephemeral);
    });

    it("reports an unregistered command name rather than throwing", async () => {
        const request = interaction({ command: "no-such-command" });

        await handleInteraction(request);

        assert.equal(request.replies.length, 1);
        assert.match(request.replies[0].content, /unknown command/i);
        assert.equal(request.replies[0].flags, MessageFlags.Ephemeral);
    });
});

describe("handleInteraction error containment", () => {
    it("turns a thrown handler into an ephemeral reply instead of an unhandled rejection", async () => {
        inject("gate-throws", false, () => {
            throw new Error("handler exploded");
        });
        const request = interaction({ command: "gate-throws" });

        await handleInteraction(request);

        assert.equal(request.replies.length, 1);
        assert.match(request.replies[0].content, /error occurred/i);
        assert.equal(request.replies[0].flags, MessageFlags.Ephemeral);
    });

    it("edits rather than replies when the interaction was already answered", async () => {
        inject("gate-throws-deferred", false, () => Promise.reject(new Error("async explosion")));
        const request = interaction({ command: "gate-throws-deferred" });
        request.deferred = true;

        await handleInteraction(request);

        assert.equal(request.replies.length, 1);
        assert.match(request.replies[0].content, /error occurred/i);
        // editReply keeps the ephemerality the deferral was created with, so
        // setting the flag again would be rejected by Discord.
        assert.equal(request.replies[0].flags, undefined);
    });

    it("swallows a failure to deliver the error reply", async () => {
        inject("gate-throws-twice", false, () => {
            throw new Error("handler exploded");
        });
        const request = interaction({ command: "gate-throws-twice" });
        request.reply = () => Promise.reject(new Error("interaction expired"));

        await assert.doesNotReject(handleInteraction(request));
    });
});
