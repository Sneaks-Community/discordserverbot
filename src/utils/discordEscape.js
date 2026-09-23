import { escapeMarkdown } from "discord.js";

/**
 * The defaults cover code, bold, italic, spoilers and backslashes (backslashes
 * first, so an attacker cannot escape our escape character). These four are off
 * by default and all matter, because names render at the start of a line:
 * maskedLink stops `[Free skins](https://evil.example)` hiding its destination,
 * and the other three stop a name restyling the list it appears in.
 */
const ESCAPE_OPTIONS = {
    bulletedList: true,
    heading: true,
    maskedLink: true,
    numberedList: true
};

/**
 * For player names, map names and anything else a game server supplies.
 * Delegates to discord.js so the pattern list tracks Discord's renderer. Masked
 * links match by pattern, so plain parentheses ("Bob (AFK)") survive.
 * @param {string} text
 * @returns {string}
 */
export function escapeForDiscord(text) {
    return typeof text === "string" ? escapeMarkdown(text, ESCAPE_OPTIONS) : String(text ?? "");
}

/**
 * Filters before escaping, not after: filtering the strings "undefined" and
 * "null" afterwards would also drop a player legitimately named "null".
 * Escaping only adds characters, so a survivor can never come back empty.
 * @param {string[]} items
 * @returns {string[]} - Escaped, non-empty items
 */
export function escapeLines(items) {
    return items
        .filter((item) => typeof item === "string" && item !== "")
        .map((item) => escapeForDiscord(item));
}
