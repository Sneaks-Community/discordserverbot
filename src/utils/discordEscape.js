import { escapeMarkdown } from "discord.js";

/**
 * Off by default but needed, as names render at line start: maskedLink stops
 * `[Free skins](https://evil.example)` hiding its target; the rest stop list restyling.
 */
const ESCAPE_OPTIONS = {
    bulletedList: true,
    heading: true,
    maskedLink: true,
    numberedList: true
};

/**
 * Delegates to discord.js so the pattern list tracks Discord's renderer.
 * Masked links match by pattern, so plain parentheses ("Bob (AFK)") survive.
 * @param {string} text
 * @returns {string}
 */
export function escapeForDiscord(text) {
    return typeof text === "string" ? escapeMarkdown(text, ESCAPE_OPTIONS) : String(text ?? "");
}

/**
 * Filters before escaping: dropping the string "null" afterwards would drop a player named "null".
 * Escaping only adds characters, so a survivor can never come back empty.
 * @param {string[]} items
 * @returns {string[]} - Escaped, non-empty items
 */
export function escapeLines(items) {
    return items
        .filter((item) => typeof item === "string" && item !== "")
        .map((item) => escapeForDiscord(item));
}
