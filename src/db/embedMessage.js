/**
 * Where the server list lives: the one message the bot posted and keeps editing.
 * Held here rather than in the environment so an operator only ever configures a
 * channel, and so the message survives a restart instead of being re-posted.
 */

import { discordIdSchema } from "../schemas/validationSchemas.js";
import { runStatement, validateOrThrow } from "./statements.js";

/**
 * The channel is stored alongside the message so a changed EMBED_CHANNEL_ID is
 * a plain comparison rather than a failed fetch.
 * @returns {{ channelID: string, messageID: string }|null} - Null when the bot
 *   has not posted yet
 */
export function getEmbedMessage() {
    const row = runStatement("SELECT channel_id, message_id FROM embed_message WHERE id = 1", [], "getEmbedMessage", "get");

    return row ? { channelID: row.channel_id, messageID: row.message_id } : null;
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
    runStatement(
        "INSERT INTO embed_message (id, channel_id, message_id) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET channel_id = excluded.channel_id, message_id = excluded.message_id",
        [validatedChannelId, validatedMessageId],
        "setEmbedMessage",
        "run"
    );
}

/** Forgets the tracked message, so the next update posts a new one. */
export function clearEmbedMessage() {
    runStatement("DELETE FROM embed_message", [], "clearEmbedMessage", "run");
}
