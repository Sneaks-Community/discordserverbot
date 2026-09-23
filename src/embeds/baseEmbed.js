import { EmbedBuilder } from "discord.js";

import { config } from "../config/index.js";
import { clampText, EMBED_TITLE_LIMIT } from "../utils/truncate.js";

const LAST_UPDATED_FOOTER = { iconURL: config.fallbackAvatarUrl, text: "Last Updated" };

/**
 * Shared so call sites cannot drift. Each field falls back on its own because
 * /testnotify passes a server that has no counts.
 * @param {object} [server] - One entry from the serverService snapshot
 * @returns {string} - e.g. "12 (2) / 24"
 */
export function formatPlayerCounts(server) {
    return `${server?.numPlayers ?? "unknown"} (${server?.numBots ?? "unknown"}) / ${server?.maxPlayers ?? "unknown"}`;
}

/**
 * Applies the bot's colour, footer and timestamp. Pass `footer: null` for
 * embeds that are not a snapshot (/help) or that reuse the footer (pagination).
 * @param {string} title
 * @param {object} [options]
 * @param {?object} [options.footer] - Footer payload, or null for no footer
 * @returns {import('discord.js').EmbedBuilder}
 */
export function createBaseEmbed(title, { footer = LAST_UPDATED_FOOTER } = {}) {
    const embed = new EmbedBuilder()
        // playerListEmbed interpolates a server name and a map into its title,
        // both of which arrive from the game server.
        .setTitle(clampText(title, EMBED_TITLE_LIMIT))
        .setColor(config.embedColor)
        .setTimestamp(Date.now());

    if (footer) embed.setFooter(footer);

    return embed;
}
