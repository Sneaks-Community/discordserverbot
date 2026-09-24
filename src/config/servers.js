/**
 * The single place servers.json is read and validated, so a typo fails at
 * startup with a precise message rather than as a broken query or embed.
 */

import { readFileSync } from "node:fs";

import { serverEntrySchema, serversFileSchema } from "../schemas/validationSchemas.js";
import { formatZodPathSuffix } from "../utils/zodValidator.js";

/** Beside the sources rather than inside them; both Docker paths bind-mount it here. */
const SERVERS_PATH = new URL("../../servers.json", import.meta.url);

/**
 * A read or parse failure, held rather than thrown: this runs at module load,
 * before pino exists, so validateConfig reports it as a ConfigError instead.
 * @type {string | null}
 */
let loadError = null;

/** Empty when the load failed, which validateServersConfig turns into a fatal. */
export const serverObject = readServers();

/**
 * @returns {object} - The parsed file, or `{}` after recording why it could not be read
 */
function readServers() {
    try {
        return JSON.parse(readFileSync(SERVERS_PATH, "utf8"));
    } catch (err) {
        const hint = err.code === "ENOENT" ? " (copy servers.json.example to the project root; in Docker check the bind mount)" : "";
        loadError = `servers.json: ${err.message}${hint}`;
        return {};
    }
}

/**
 * Prefixes an issue with its location, e.g. `servers.json: "Beginner_Surf"...`.
 * File-level issues (empty path) already name the file, so they pass through.
 * @param {import('zod').core.$ZodIssue} issue
 * @returns {string}
 */
function formatIssue(issue) {
    if (issue.path.length === 0) return issue.message;

    const [name, ...rest] = issue.path;

    return `servers.json: "${String(name)}"${formatZodPathSuffix(rest)}: ${issue.message}`;
}

/**
 * Problems worth reporting that should not stop the bot.
 * @param {object} servers - The raw servers.json object
 * @returns {string[]}
 */
function collectWarnings(servers) {
    const warnings = [];
    const addressOwners = new Map();

    for (const [name, server] of Object.entries(servers)) {
        if (!server || typeof server !== "object") continue;

        const unknownFields = Object.keys(server).filter((field) => !Object.hasOwn(serverEntrySchema.shape, field));
        if (unknownFields.length > 0) {
            warnings.push(`servers.json: "${name}" has unrecognized field(s) ${unknownFields.map((field) => `"${field}"`).join(", ")} which are ignored`);
        }

        if (typeof server.ip === "string") {
            const owner = addressOwners.get(server.ip);
            if (owner === undefined) {
                addressOwners.set(server.ip, name);
            } else {
                warnings.push(`servers.json: "${name}" and "${owner}" share the address "${server.ip}"; it will be queried once per entry`);
            }
        }

        // getServerByKeyword also accepts a list index, so a numeric keyword is ambiguous.
        if (Array.isArray(server.keywords)) {
            for (const keyword of server.keywords) {
                if (typeof keyword === "string" && /^\d+$/.test(keyword)) {
                    warnings.push(`servers.json: "${name}" keyword "${keyword}" is numeric and collides with server index lookups`);
                }
            }
        }
    }

    return warnings;
}

/**
 * @param {object} [servers] - Defaults to the loaded servers.json
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function validateServersConfig(servers = serverObject) {
    // Only the file can fail to load; an explicit argument is the caller's own.
    if (loadError !== null && servers === serverObject) {
        return { errors: [loadError], warnings: [] };
    }

    const result = serversFileSchema.safeParse(servers);

    if (!result.success) {
        return {
            errors: result.error.issues.map(formatIssue),
            // collectWarnings assumes a parsed shape, and startup aborts on errors anyway.
            warnings: []
        };
    }

    return { errors: [], warnings: collectWarnings(servers) };
}
