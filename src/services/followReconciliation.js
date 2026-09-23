/**
 * Startup-only prune of members who left while the bot was offline (no guildMemberRemove).
 * Every branch deletes real user data, so anything short of certain bails and logs.
 */

import { config } from "../config/index.js";
import { getFollowerIds, unfollowAll } from "../db/index.js";
import { serviceLogger } from "../utils/logger.js";

// Not a capacity limit: a pass this large means the member list was wrong.
const MAX_PRUNE_PER_PASS = 500;

/**
 * @param {Array<string>} followerIds - Users holding at least one follow
 * @param {Set<string>} memberIds - Users currently in the guild
 * @returns {Array<string>}
 */
export function selectDepartedFollowers(followerIds, memberIds) {
    return followerIds.filter((id) => !memberIds.has(id));
}

/**
 * @param {import('discord.js').Client} bot
 * @returns {Promise<void>}
 */
export async function reconcileFollows(bot) {
    const guildId = config.discordGuildId;
    const guild = bot.guilds.cache.get(guildId);

    if (!guild) {
        serviceLogger.warn({ guildId }, "Skipping follow reconciliation: the served guild is not cached");
        return;
    }

    let followerIds;

    try {
        followerIds = getFollowerIds();
    } catch (err) {
        serviceLogger.error({ err }, "Skipping follow reconciliation: could not read the follows");
        return;
    }

    // Before the member fetch, which is the expensive half.
    if (followerIds.length === 0) {
        return;
    }

    let members;

    try {
        members = await guild.members.fetch();
    } catch (err) {
        serviceLogger.warn({ err, guildId }, "Skipping follow reconciliation: could not fetch the guild members");
        return;
    }

    // A resolved fetch is not a complete one, and a short list read as the truth
    // wipes everyone.
    if (members.size === 0 || members.size < guild.memberCount) {
        serviceLogger.warn(
            { fetched: members.size, guildId, memberCount: guild.memberCount },
            "Skipping follow reconciliation: the member list is incomplete"
        );
        return;
    }

    const departed = selectDepartedFollowers(followerIds, new Set(members.keys()));

    if (departed.length === 0) {
        serviceLogger.debug({ followers: followerIds.length }, "Follow reconciliation found nothing to prune");
        return;
    }

    if (departed.length > MAX_PRUNE_PER_PASS) {
        serviceLogger.error(
            { departed: departed.length, followers: followerIds.length, limit: MAX_PRUNE_PER_PASS },
            "Skipping follow reconciliation: it would prune more members than the safety limit allows"
        );
        return;
    }

    let pruned = 0;

    // Per user, so one failed delete does not abandon the rest.
    for (const discordId of departed) {
        try {
            unfollowAll(discordId);
            pruned++;
        } catch (err) {
            serviceLogger.error({ err, userId: discordId }, "Failed to prune follows for a departed member");
        }
    }

    serviceLogger.info({ departed: departed.length, pruned }, "Removed follows for members who left while the bot was offline");
}
