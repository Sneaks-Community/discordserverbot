/**
 * The one server list message the bot keeps editing, stored so it survives a
 * restart instead of being re-posted and an operator only configures a channel.
 */

import { discordIdSchema } from "../schemas/validationSchemas.js";
import { getStatement } from "./connection.js";
import { validateOrThrow } from "./statements.js";

/**
 * The channel is stored alongside the message so a changed EMBED_CHANNEL_ID is
 * a plain comparison rather than a failed fetch.
 * @returns {{ channelId: string, messageId: string }|null} - Null before the first post
 */
export function getEmbedMessage() {
    const row = getStatement("SELECT channel_id, message_id FROM embed_message WHERE id = 1").get();

    return row ? { channelId: row.channel_id, messageId: row.message_id } : null;
}

/**
 * Replaces whatever was there: the CHECK constraint on the table allows one row,
 * so this cannot accumulate stale messages.
 * @param {string} channel_id
 * @param {string} message_id
 */
export function setEmbedMessage(channel_id, message_id) {
    const validatedChannelId = validateOrThrow(discordIdSchema, channel_id, "setEmbedMessage/channel_id");
    const validatedMessageId = validateOrThrow(discordIdSchema, message_id, "setEmbedMessage/message_id");
    getStatement(
        "INSERT INTO embed_message (id, channel_id, message_id) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET channel_id = excluded.channel_id, message_id = excluded.message_id"
    ).run(validatedChannelId, validatedMessageId);
}

/** Forgets the tracked message, so the next update posts a new one. */
export function clearEmbedMessage() {
    getStatement("DELETE FROM embed_message").run();
}
