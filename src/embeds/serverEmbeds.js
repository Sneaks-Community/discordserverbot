import { CONFIG_VALUES } from "../config/index.js";
import { escapeForDiscord } from "../utils/discordEscape.js";
import { embedLogger } from "../utils/logger.js";
import { clampText, EMBED_FIELD_NAME_LIMIT, EMBED_FIELD_VALUE_LIMIT, EMBED_TOTAL_LIMIT } from "../utils/truncate.js";
import { createBaseEmbed, formatPlayerCounts } from "./baseEmbed.js";

// createBaseEmbed's "Last Updated" footer counts toward the same 6000, with room
// to spare so the reservation never has to track the footer text itself.
const FOOTER_ALLOWANCE = 64;

/**
 * Minutes keep one decimal so the default 90s does not read as "2 minutes".
 * @param {number} ms
 * @returns {string} - e.g. "45 seconds", "1 minute", "1.5 minutes"
 */
export function describeInterval(ms) {
    const seconds = Math.round(ms / 1000);
    if (seconds < 60) {
        return `${seconds} second${seconds === 1 ? "" : "s"}`;
    }

    const minutes = Math.round((seconds / 60) * 10) / 10;
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

/**
 * @param {object} serverData - The full serverService snapshot
 * @returns {import('discord.js').EmbedBuilder}
 */
export function makeEmbed(serverData) {
    const title = "Server List";
    const description = `This list is updated every ${describeInterval(CONFIG_VALUES.EMBED_UPDATE_INTERVAL_MS)}.`;
    const embed = createBaseEmbed(title).setDescription(description);

    // Fields come from game server replies, so both limits are enforced: passing
    // either 400s the edit and freezes the list until a tick that fits.
    let used = title.length + description.length + FOOTER_ALLOWANCE;
    let dropped = 0;

    for (const server of Object.values(serverData)) {
        const name = clampText(escapeForDiscord(server.name), EMBED_FIELD_NAME_LIMIT);
        const value = clampText(server.online
            ? `**__Players:__** ${formatPlayerCounts(server)}\n**__Map:__** ${escapeForDiscord(server.map)}\n**__IP:__** ${escapeForDiscord(server.fullIP)}`
            : "**Server is not available.**", EMBED_FIELD_VALUE_LIMIT);

        // Skip rather than break: a later, smaller server can still fit.
        if (used + name.length + value.length > EMBED_TOTAL_LIMIT) {
            dropped++;
            continue;
        }

        embed.addFields({ inline: true, name, value });
        used += name.length + value.length;
    }

    if (dropped > 0) {
        embedLogger.warn({ dropped, used }, "Server list embed reached Discord's 6000 character total; some servers were left out");
    }

    return embed;
}
