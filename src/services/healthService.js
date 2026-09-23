/**
 * Container HEALTHCHECK liveness: is the tick loop turning. Discord state never gates it, since
 * discord.js reconnects on its own and bot.js's ShardDisconnect handler exits when it cannot.
 */

import http from "node:http";

import { Status } from "discord.js";

import { CONFIG_VALUES } from "../config/index.js";
import { serviceLogger } from "../utils/logger.js";
import { getServerData } from "./serverService.js";

const HEALTH_PATH = "/health";

// Missed ticks tolerated before the bot reads as stale. An overrunning tick is
// already handled by the refresh guard and must not fail the check on its own.
const STALE_TICK_MULTIPLIER = 3;

const STALE_AFTER_MS = CONFIG_VALUES.EMBED_UPDATE_INTERVAL_MS * STALE_TICK_MULTIPLIER;

/** Epoch ms of the last tick start, or null before the first one. */
let lastTickAt = null;

/** @type {import('node:http').Server | null} */
let server = null;

/**
 * Called at the top of the tick: the timer fired and the loop is turning, which
 * is what liveness means. The bottom would report a slow tick as a dead one.
 */
export function recordTick() {
    lastTickAt = Date.now();
}

/**
 * @param {import('discord.js').Client} bot
 * @returns {object} - The response body; `status` also decides the HTTP code
 */
function buildStatus(bot) {
    const ageMs = lastTickAt === null ? null : Date.now() - lastTickAt;
    const servers = Object.values(getServerData());

    return {
        // Reported, never gating. See the header.
        discord: {
            ready: bot?.ws?.status === Status.Ready,
            status: Status[bot?.ws?.status] ?? "Unknown"
        },
        lastTickAgeMs: ageMs,
        lastTickAt: lastTickAt === null ? null : new Date(lastTickAt).toISOString(),
        serversOnline: servers.filter((entry) => entry.online).length,
        serversTotal: servers.length,
        status: ageMs !== null && ageMs <= STALE_AFTER_MS ? "ok" : "stale",
        uptimeSeconds: Math.round(process.uptime())
    };
}

/**
 * @param {import('discord.js').Client} bot
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 */
function handleRequest(bot, req, res) {
    // Dropped, so a query string cannot defeat the path match.
    const path = (req.url ?? "").split("?")[0];

    if (path !== HEALTH_PATH) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end("{\"error\":\"not found\"}");
        return;
    }

    const body = buildStatus(bot);

    res.writeHead(body.status === "ok" ? 200 : 503, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
}

/**
 * No-op when HEALTH_PORT is 0, the explicit opt-out from opening a socket.
 * @param {import('discord.js').Client} bot
 * @returns {import('node:http').Server | null} - Null when disabled; returned for tests
 */
export function startHealthServer(bot) {
    const { HEALTH_HOST: host, HEALTH_PORT: port } = CONFIG_VALUES;

    if (port === 0) {
        serviceLogger.debug("Health endpoint disabled; set HEALTH_PORT to enable it");
        return null;
    }

    if (server) {
        return server;
    }

    server = http.createServer((req, res) => {
        // A monitoring endpoint must never reach the uncaughtException handler.
        try {
            handleRequest(bot, req, res);
        } catch (err) {
            serviceLogger.error({ err, url: req.url }, "Health request failed");
            if (!res.headersSent) {
                res.writeHead(500, { "content-type": "application/json" });
            }
            res.end();
        }
    });

    // EADDRINUSE above all. Logged, not thrown: no real work depends on this
    // socket, and an unanswerable healthcheck already reads as unhealthy.
    server.on("error", (err) => {
        serviceLogger.error({ err, host, port }, "Health server error");
    });

    server.listen(port, host, () => {
        serviceLogger.info({ host, port }, `Health endpoint listening on ${HEALTH_PATH}`);
    });

    return server;
}

/** Synchronous, so shutdown cannot be delayed by an open connection. */
export function stopHealthServer() {
    if (!server) {
        return;
    }

    const closing = server;
    server = null;

    // close() only stops new connections; an idle keep-alive socket would hold
    // the listener open past the shutdown timeout.
    closing.close();
    closing.closeAllConnections();
}
