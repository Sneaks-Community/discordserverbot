/**
 * Splits Discord failures into retryable and terminal, so setup mistakes and recipient
 * conditions are logged with their remediation instead of retried on backoff forever.
 */

import { RESTJSONErrorCodes } from "discord.js";

/**
 * Codes that cannot succeed on a retry, mapped to what to do about them.
 * @type {Map<number, string>}
 */
const TERMINAL_API_CODES = new Map([
    [RESTJSONErrorCodes.UnknownChannel, "Unknown Channel: the configured channel ID does not exist, or the bot is not in that guild"],
    [RESTJSONErrorCodes.UnknownMessage, "Unknown Message: that message no longer exists in the channel"],
    [RESTJSONErrorCodes.MissingAccess, "Missing Access: the bot cannot see that channel, grant it View Channel"],
    [RESTJSONErrorCodes.CannotSendMessagesToThisUser, "Cannot send messages to this user: their DMs are closed to the bot, or they have blocked it"],
    [RESTJSONErrorCodes.MissingPermissions, "Missing Permissions: the bot lacks a required permission in that channel"],
    [RESTJSONErrorCodes.CannotSendMessagesToThisUserDueToHavingNoMutualGuilds, "Cannot send messages to this user: the bot no longer shares a guild with them"]
]);

/** A non-retryable failure raised by our own pre-checks rather than by Discord. */
export class TerminalError extends Error {
    /**
     * @param {string} message - What failed
     * @param {string} [hint] - How to fix it; defaults to the message
     */
    constructor(message, hint) {
        super(message);
        this.name = "TerminalError";
        this.hint = hint ?? message;
    }
}

/**
 * @param {any} error - From a Discord call or one of our own pre-checks
 * @returns {string|null} - Remediation hint, or null when retryable
 */
export function getTerminalReason(error) {
    if (error instanceof TerminalError) {
        return error.hint;
    }

    // DiscordAPIError codes are numbers and node's own are strings, so a plain
    // lookup cannot confuse the two.
    return TERMINAL_API_CODES.get(error?.code) ?? null;
}

/**
 * Terminal codes about the recipient, not the request: the only ones worth remembering,
 * since nothing helps until the user reopens their DMs or rejoins.
 * @type {Set<number>}
 */
const RECIPIENT_REFUSAL_CODES = new Set([
    RESTJSONErrorCodes.CannotSendMessagesToThisUser,
    RESTJSONErrorCodes.CannotSendMessagesToThisUserDueToHavingNoMutualGuilds
]);

/**
 * Whether this recipient will refuse the next DM too.
 * @param {any} error
 * @returns {boolean}
 */
export function isRecipientRefusal(error) {
    return RECIPIENT_REFUSAL_CODES.has(error?.code);
}

/**
 * Retry predicate for withRetry at any Discord call site.
 * @param {any} error
 * @returns {boolean}
 */
export function isRetryableDiscordError(error) {
    return getTerminalReason(error) === null;
}
