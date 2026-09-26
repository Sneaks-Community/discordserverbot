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

const { makeEmbed } = await import("../src/embeds/serverEmbeds.js");
const { sendTestNotification } = await import("../src/services/notificationService.js");

it("puts a Connect button to the connect page before the unfollow buttons", async () => {
    const dms = [];
    await sendTestNotification({ send: (payload) => dms.push(payload) }, "de_dust2");

    const [connect, ...unfollow] = dms[0].components[0].components.map((button) => button.toJSON());
    assert.equal(connect.style, ButtonStyle.Link);
    assert.equal(connect.url, "https://connect.test/join?ip=0.0.0.0%3A27015");
    assert.deepEqual(unfollow.map((button) => button.label), ["Unfollow de_dust2", "Unfollow all"]);
});

it("links each online server in the server list to the connect page, and no offline one", () => {
    const { fields } = makeEmbed({
        down: { name: "Down", online: false },
        surf: { fullIP: "1.2.3.4:27015", map: "surf_beginner", name: "Surf", online: true }
    }).toJSON();

    assert.ok(!fields[0].value.includes("Connect"), fields[0].value);
    assert.ok(fields[1].value.endsWith("\n[Connect](https://connect.test/join?ip=1.2.3.4%3A27015)"), fields[1].value);
});
