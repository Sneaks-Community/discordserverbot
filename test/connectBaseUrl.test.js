/**
 * CONNECT_BASE_URL is read once at import, so the configured case needs its own
 * process. node --test gives every file one.
 */

import assert from "node:assert/strict";
import { it } from "node:test";

import { ButtonStyle } from "discord.js";

process.env.CONNECT_BASE_URL = "https://connect.test/join?ip=";
process.env.DISCORD_GUILD_ID = "123456789012345678";
process.env.DISCORD_TOKEN = "test-token";
process.env.LOG_LEVEL = "silent";

const { sendTestNotification } = await import("../src/services/notificationService.js");

it("puts a Connect link to the configured page before the unfollow buttons", async () => {
    const dms = [];
    await sendTestNotification({ send: (payload) => dms.push(payload) }, "de_dust2");

    const [connect, ...unfollow] = dms[0].components[0].components.map((button) => button.toJSON());
    assert.equal(connect.style, ButtonStyle.Link);
    assert.equal(connect.url, "https://connect.test/join?ip=0.0.0.0%3A27015");
    assert.deepEqual(unfollow.map((button) => button.label), ["Unfollow de_dust2", "Unfollow all"]);
});
