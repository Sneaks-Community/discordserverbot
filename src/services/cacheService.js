import { serviceLogger } from "../utils/logger.js";

// Timestamp arrays, keyed by user then action.
const userActionRateLimits = new Map();

// Recipients whose DM Discord refused, to when. A closed DM belongs to the
// recipient, not the attempt, so retrying every map change can never succeed.
const dmRefusals = new Map();

const DM_REFUSAL_COOLDOWN_MS = 3600000;

const MAX_RATE_LIMIT_MAP_SIZE = 5000;
const MAX_DM_REFUSAL_SIZE = 5000;

const CLEANUP_INTERVAL_MS = 300000;

/**
 * @param {string} userId
 * @param {string} action - One bucket per action
 * @param {number} limit - Maximum actions allowed per minute
 * @returns {{allowed: boolean, retryAfter: number}} - retryAfter is in seconds
 */
export function checkRateLimit(userId, action, limit) {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;

    if (!userActionRateLimits.has(userId)) {
        userActionRateLimits.set(userId, {});
    }

    const userActions = userActionRateLimits.get(userId);

    if (!userActions[action]) {
        userActions[action] = [];
    }

    userActions[action] = userActions[action].filter(timestamp => timestamp > oneMinuteAgo);

    if (userActions[action].length >= limit) {
        const oldestAction = userActions[action][0];
        const retryAfter = Math.ceil((oldestAction + 60000 - now) / 1000);
        return { allowed: false, retryAfter };
    }

    userActions[action].push(now);
    return { allowed: true, retryAfter: 0 };
}

function cleanupRateLimits() {
    if (userActionRateLimits.size === 0) return;

    const now = Date.now();
    let cleaned = 0;

    for (const [userId, actions] of userActionRateLimits.entries()) {
        let hasValidActions = false;
        for (const action of Object.keys(actions)) {
            actions[action] = actions[action].filter(ts => now - ts < 60000);
            if (actions[action].length === 0) {
                delete actions[action];
            } else {
                hasValidActions = true;
            }
        }
        if (!hasValidActions) {
            userActionRateLimits.delete(userId);
            cleaned++;
        }
    }

    // Still over the cap: evict the users whose oldest action is oldest. No
    // recency ordering here, unlike dmRefusals, so this has to sort.
    if (userActionRateLimits.size >= MAX_RATE_LIMIT_MAP_SIZE) {
        const userTimestamps = [];
        for (const [userId, actions] of userActionRateLimits.entries()) {
            let oldestTs = Infinity;
            for (const action of Object.keys(actions)) {
                if (actions[action].length > 0) {
                    oldestTs = Math.min(oldestTs, actions[action][0]);
                }
            }
            if (oldestTs !== Infinity) {
                userTimestamps.push({ oldestTs, userId });
            }
        }

        userTimestamps.sort((a, b) => a.oldestTs - b.oldestTs);
        const toDelete = userTimestamps.slice(0, userActionRateLimits.size - MAX_RATE_LIMIT_MAP_SIZE + 100);
        for (const { userId } of toDelete) {
            userActionRateLimits.delete(userId);
            cleaned++;
        }
    }

    if (cleaned > 0) {
        serviceLogger.info(`Rate limit cleanup: removed ${cleaned} users, current size: ${userActionRateLimits.size}`);
    }
}

/**
 * Prunes an expired entry as it reads it, so a user who reopens their DMs is
 * eligible again on the next map change rather than at the next sweep.
 * @param {string} userId
 * @returns {boolean}
 */
export function isDmRefused(userId) {
    const refusedAt = dmRefusals.get(userId);
    if (refusedAt === undefined) return false;

    if (Date.now() - refusedAt >= DM_REFUSAL_COOLDOWN_MS) {
        dmRefusals.delete(userId);
        return false;
    }

    return true;
}

/**
 * Records a refused DM and starts the user's cooldown.
 * @param {string} userId
 */
export function markDmRefused(userId) {
    // Delete-then-set keeps insertion order equal to recency order, so the first
    // key is the oldest refusal.
    dmRefusals.delete(userId);

    if (dmRefusals.size >= MAX_DM_REFUSAL_SIZE) {
        dmRefusals.delete(dmRefusals.keys().next().value);
    }

    dmRefusals.set(userId, Date.now());
}

/** Drops expired refusals for users who never come up in a fanout again. */
function cleanupDmRefusals() {
    if (dmRefusals.size === 0) return;

    const now = Date.now();
    let cleaned = 0;
    for (const [userId, refusedAt] of dmRefusals) {
        // Oldest first, so the first live entry means every later one is live too.
        if (now - refusedAt < DM_REFUSAL_COOLDOWN_MS) break;
        dmRefusals.delete(userId);
        cleaned++;
    }

    if (cleaned > 0) {
        serviceLogger.info(`DM refusal cleanup: removed ${cleaned} entries, current size: ${dmRefusals.size}`);
    }
}

/** @type {NodeJS.Timeout[]} */
let cleanupIntervalRefs = [];

export function startCleanupIntervals() {
    cleanupIntervalRefs.push(setInterval(cleanupRateLimits, CLEANUP_INTERVAL_MS));
    cleanupIntervalRefs.push(setInterval(cleanupDmRefusals, CLEANUP_INTERVAL_MS));
}

export function clearCleanupIntervals() {
    cleanupIntervalRefs.forEach(id => clearInterval(id));
    cleanupIntervalRefs = [];
}
