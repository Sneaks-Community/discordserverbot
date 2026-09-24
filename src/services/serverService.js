import { GameDig } from "gamedig";
import pLimit from "p-limit";

import { config, serverObject } from "../config/index.js";
import { DEFAULT_SERVER_PORT, playerNameSchema } from "../schemas/validationSchemas.js";
import { serviceLogger } from "../utils/logger.js";
import { normalizeMapName } from "../utils/mapUtils.js";
import { validateWithZod } from "../utils/zodValidator.js";

let _serverData = {};
let _isRefreshing = false;
let _isNotifying = false;

/**
 * Bounds one gamedig attempt: its 10s default, multiplied by maxRetries over the
 * ports tried, lets one unreachable server occupy most of an update interval.
 */
const QUERY_ATTEMPT_TIMEOUT_MS = 3000;

/** How long one unanswered packet waits. Matches gamedig's own default. */
const QUERY_SOCKET_TIMEOUT_MS = 2000;

/**
 * Under 1 so a pass ends before the next tick, where the _isRefreshing guard
 * would drop it and the embed would republish a stale snapshot as current.
 */
const REFRESH_BUDGET_FRACTION = 0.8;

// Last seen map per server, for map change detection. "" means not yet seen.
const oldData = {};
const serverObjectKeys = Object.keys(serverObject);

for (const server of serverObjectKeys) {
    oldData[server] = "";
}

/** @returns {object} - Read-only; refresh swaps in a new object rather than mutating this one */
export function getServerData() {
    return _serverData;
}

/**
 * Empty until the first refresh lands, i.e. while the bot is still starting.
 * @returns {boolean}
 */
export function isServerDataEmpty() {
    return Object.keys(_serverData).length === 0;
}

/**
 * @param {string} keyword - A server keyword, or its index as a string
 * @returns {object | null}
 */
export function getServerByKeyword(keyword) {
    for (const server of Object.values(_serverData)) {
        if (server.keywords.includes(keyword) || String(server.index) === keyword) {
            return server;
        }
    }
    return null;
}

/**
 * Replaces an unusable name rather than dropping the row, which would hide the
 * player and understate the count.
 * @param {object} entry - A gamedig player or bot entry
 * @param {string} fallback
 * @param {string} label - Field label for the validation message
 * @returns {object}
 */
function sanitizeEntry(entry, fallback, label) {
    const result = validateWithZod(playerNameSchema, entry.name, label);

    if (!result.valid) {
        serviceLogger.debug({ reason: result.error }, `Unusable ${label.toLowerCase()}, substituting "${fallback}"`);
        return { ...entry, name: fallback };
    }

    return { ...entry, name: result.data };
}

/**
 * `res.numplayers` includes bots and `res.players` can be truncated, so take
 * the larger of reported and listed.
 * @param {object} res - A gamedig query result
 * @returns {{numBots: number, numPlayers: number}}
 */
function readCounts(res) {
    const reportedBots = Number(res.raw?.numbots);
    const numBots = Math.max(Number.isInteger(reportedBots) ? reportedBots : 0, res.bots.length);

    const reportedTotal = Number(res.numplayers);
    const reportedHumans = Number.isInteger(reportedTotal) ? reportedTotal - numBots : 0;

    return { numBots, numPlayers: Math.max(reportedHumans, res.players.length, 0) };
}

/**
 * Enough for the embed and /players to name the server, and nothing that reads
 * as live state. Every give-up path must return this same shape.
 * @param {object} server - The servers.json entry
 * @param {number} index - Its 1-based position in the list
 * @returns {object}
 */
function buildOfflineServerData(server, index) {
    return {
        index,
        keywords: server.keywords,
        name: server.nick,
        online: false
    };
}

/**
 * @param {object} server - The servers.json entry
 * @param {number} index - Its 1-based position in the list
 * @param {boolean} [wasOffline] - Offline in the previous snapshot, so a failure is not news
 * @returns {Promise<object>}
 */
export async function getInfo(server, index, wasOffline = false) {
    // validateServersConfig has already rejected anything but "host" or
    // "host:port" with an in-range port, so this only applies the default.
    const [host, rawPort] = server.ip.split(":");
    const port = rawPort === undefined ? DEFAULT_SERVER_PORT : Number(rawPort);

    let res;

    try {
        res = await GameDig.query({
            attemptTimeout: QUERY_ATTEMPT_TIMEOUT_MS,
            host: host,
            maxRetries: config.gamedigMaxRetries,
            port: port,
            socketTimeout: QUERY_SOCKET_TIMEOUT_MS,
            type: server.protocol || "csgo"
        });
    } catch (err) {
        // Once per outage: a server down for a day would otherwise log every tick.
        serviceLogger[wasOffline ? "debug" : "warn"]({ err, serverIp: server.ip }, "GameDig query failed");
        return buildOfflineServerData(server, index);
    }

    // Names are escaped at render time, so this only ensures a usable string
    const sanitizedPlayers = res.players.map((player) => sanitizeEntry(player, "Unknown", "Player name"));
    const sanitizedBots = res.bots.map((bot) => sanitizeEntry(bot, "Unknown Bot", "Bot name"));

    const { numBots, numPlayers } = readCounts(res);
    // Server-supplied for some protocols, so only a number reaches the embeds
    const maxPlayers = Number(res.maxplayers);

    return {
        bots: sanitizedBots,
        // Server-supplied for some protocols, and the DM inserts it raw after
        // steam://connect/, so anything but host:port gives way to the configured ip.
        fullIP: typeof res.connect === "string" && /^[A-Za-z0-9.-]{1,253}:\d{1,5}$/.test(res.connect) ? res.connect : server.ip,
        index: index,
        keywords: server.keywords,
        map: normalizeMapName(res.map),
        maxPlayers: Number.isFinite(maxPlayers) ? maxPlayers : undefined,
        name: server.nick,
        numBots: numBots,
        numPlayers: numPlayers, // Humans only; bots are counted separately
        online: true,
        players: sanitizedPlayers
    };
}

/**
 * The only bound on the whole pass; gamedig timeouts bound one attempt each and
 * the concurrency limit only batches. Giving up returns the offline shape.
 * @param {string} name - Server key in serverObject, for logging
 * @param {object} server - The servers.json entry
 * @param {number} index - Its 1-based position in the list
 * @param {number} deadline - Epoch ms the whole pass must be finished by
 * @returns {Promise<object>}
 */
async function getInfoWithinDeadline(name, server, index, deadline) {
    const remainingMs = deadline - Date.now();

    if (remainingMs <= 0) {
        serviceLogger.warn({ server: name }, "Refresh ran out of time before this server was queried; reporting it offline");
        return buildOfflineServerData(server, index);
    }

    let timer;
    const ranOut = new Promise((resolve) => {
        timer = setTimeout(() => {
            serviceLogger.warn({ remainingMs, server: name }, "Server query outlasted the refresh budget; reporting it offline");
            resolve(buildOfflineServerData(server, index));
        }, remainingMs);
    });

    try {
        // gamedig offers no cancellation, so a late answer is discarded rather
        // than waited for; its sockets end on their own timeouts.
        return await Promise.race([getInfo(server, index, _serverData[name]?.online === false), ranOut]);
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Queries every server, concurrency-limited, and swaps in the new snapshot.
 * @returns {Promise<boolean>} - False when a pass was already in flight, so the
 *   snapshot is untouched and there is nothing new to publish
 */
export async function refresh() {
    if (_isRefreshing) {
        serviceLogger.debug("Skipping refresh -- already in progress");
        return false;
    }

    _isRefreshing = true;
    const startedAt = Date.now();

    try {
        const serverEntries = Object.entries(serverObject);
        const deadline = startedAt + Math.round(config.serverUpdateIntervalMs * REFRESH_BUDGET_FRACTION);

        const limit = pLimit(config.maxConcurrentQueries);

        const results = await Promise.all(
            serverEntries.map(([name, server], index) =>
                limit(async () => {
                    try {
                        const data = await getInfoWithinDeadline(name, server, index + 1, deadline);
                        return [name, data];
                    } catch (err) {
                        serviceLogger.error({ err, server: name }, "Failed to query server");
                        return [name, buildOfflineServerData(server, index + 1)];
                    }
                })
            )
        );

        _serverData = Object.fromEntries(results);

        return true;
    } finally {
        _isRefreshing = false;

        // Against the interval, not the budget: hitting the budget is the deadline
        // working, passing the interval means it failed and the next tick is lost.
        const elapsedMs = Date.now() - startedAt;
        if (elapsedMs > config.serverUpdateIntervalMs) {
            serviceLogger.warn({ elapsedMs, intervalMs: config.serverUpdateIntervalMs }, "Refresh pass outlasted the update interval; the next tick will be skipped");
        } else {
            serviceLogger.debug({ elapsedMs }, "Refresh pass complete");
        }
    }
}

/**
 * An offline, missing or map-less entry keeps lastSeen, so a server that comes
 * back on another map still counts as a change.
 * @param {string} lastSeen - The server's last seen map, "" if not yet seen
 * @param {object} [live] - The server's entry in the latest snapshot
 * @returns {{ changed: boolean, lastSeen: string }}
 */
export function detectMapChange(lastSeen, live) {
    return live?.online && live.map
        ? { changed: lastSeen !== "" && live.map !== lastSeen, lastSeen: live.map }
        : { changed: false, lastSeen };
}

/**
 * Compares the latest snapshot against the last seen maps and notifies on change.
 * @param {Function} notifyCallback - Called as (newMap, serverInfo)
 * @returns {Promise<void>}
 */
export async function updateServerData(notifyCallback) {
    // The caller awaits this once per tick, but DM fanout can outlast a tick and
    // a second pass would re-read the same snapshot.
    if (_isNotifying) {
        serviceLogger.debug("Skipping map change check -- notifications still in progress");
        return;
    }

    _isNotifying = true;
    try {
        const serverData = getServerData();

        for (const currentServer of serverObjectKeys) {
            const live = serverData[currentServer];
            const { changed, lastSeen } = detectMapChange(oldData[currentServer], live);

            // Recorded before notifying, so a failed notification does not
            // re-detect the same change on every later tick.
            oldData[currentServer] = lastSeen;

            if (changed) {
                try {
                    // A fresh object: live counts written onto serverObject
                    // would pollute the servers.json /keywords and validation read.
                    await notifyCallback(live.map, {
                        ...serverObject[currentServer],
                        fullIP: live.fullIP,
                        maxPlayers: live.maxPlayers,
                        numBots: live.numBots,
                        numPlayers: live.numPlayers
                    });
                } catch (err) {
                    serviceLogger.error({ err, map: live.map, server: currentServer }, "Map change notification failed");
                }
            }
        }
    } finally {
        _isNotifying = false;
    }
}
