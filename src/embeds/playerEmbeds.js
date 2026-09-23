import { CONFIG_VALUES } from "../config/index.js";
import { escapeForDiscord, escapeLines } from "../utils/discordEscape.js";
import { EMBED_DESCRIPTION_LIMIT, joinWithinLimit } from "../utils/truncate.js";
import { createBaseEmbed, formatPlayerCounts } from "./baseEmbed.js";

/**
 * @param {object} server - One entry from the serverService snapshot
 * @returns {import('discord.js').EmbedBuilder}
 */
export function playerListEmbed(server) {
    let embed;

    if (server.online) {
        embed = createBaseEmbed(`${formatPlayerCounts(server)} players connected to ${escapeForDiscord(server.name)} on ${escapeForDiscord(server.map)}`);

        // A full 64-slot server with long names can pass the 4096 character
        // description limit, which would reject the whole reply.
        const allPlayerNames = [
            ...server.players.map((player) => player.name),
            ...server.bots.map((bot) => bot.name)
        ];
        const list = joinWithinLimit(escapeLines(allPlayerNames), EMBED_DESCRIPTION_LIMIT);

        // The embed builder rejects an empty description, and an online server
        // with nobody on it is normal.
        embed.setDescription(list || "No players connected.");
    } else {
        embed = createBaseEmbed(`${escapeForDiscord(server.name)} is currently unavailable.`)
            .setImage(CONFIG_VALUES.OFFLINE_SERVER_IMAGE);
    }

    return embed;
}

/**
 * @param {object} serverData - The full serverService snapshot
 * @returns {import('discord.js').EmbedBuilder}
 */
export function makeServerList(serverData) {
    const embed = createBaseEmbed("Please specify what server you want to check.");

    const lines = Object.values(serverData)
        .map((server) => {
            const escapedName = escapeForDiscord(server.name);
            return server.online ? `${server.index}: **__${escapedName}__**: ${formatPlayerCounts(server)} on ${escapeForDiscord(server.map)}` : `${server.index}: **__${escapedName}__**: is currently unavailable.`;
        });
    const list = joinWithinLimit(lines, EMBED_DESCRIPTION_LIMIT);

    embed.setDescription(list || "No servers configured.");

    return embed;
}
