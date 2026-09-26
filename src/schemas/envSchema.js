/**
 * The only process.env reader for configuration, bar LOG_LEVEL and NODE_ENV (utils/logger.js).
 * Unset or empty takes the default; an empty optional ID or URL disables its feature.
 */

import { ActivityType } from "discord.js";
import * as z from "zod";

import { discordIdSchema } from "./validationSchemas.js";

/**
 * Checked here because discord.js only rejects a bad image URL at embed build
 * time, which would make every embed throw instead of failing at startup.
 * @param {string} value
 * @returns {boolean}
 */
function isHttpUrl(value) {
    let parsed;

    try {
        parsed = new URL(value);
    } catch {
        return false;
    }

    return parsed.protocol === "http:" || parsed.protocol === "https:";
}

/**
 * @param {string} defaultValue - Used when the variable is unset or blank
 * @param {import('zod').ZodType} schema - Validates the trimmed value
 * @returns {import('zod').ZodType}
 */
function withDefault(defaultValue, schema) {
    return z.preprocess(
        (value) => (value === undefined || String(value).trim() === "" ? defaultValue : String(value).trim()),
        schema
    );
}

/**
 * A whole-number variable, inclusive of both bounds.
 * @param {number} defaultValue - Used when the variable is unset or empty
 * @param {number} min
 * @param {number} max
 * @returns {import('zod').ZodType}
 */
function intEnv(defaultValue, min, max) {
    return withDefault(
        String(defaultValue),
        z
            .string()
            .regex(/^-?\d+$/, "must be a whole number")
            .transform(Number)
            .refine((parsed) => parsed >= min && parsed <= max, `must be between ${min} and ${max}`)
    );
}

/**
 * Parsed to the 24-bit integer discord.js wants; "#" is optional since pasted colors often lack it.
 * @param {string} defaultValue - Used when the variable is unset or empty
 * @returns {import('zod').ZodType}
 */
function hexColorEnv(defaultValue) {
    return withDefault(
        defaultValue,
        z
            .string()
            .regex(/^#?[0-9a-f]{6}$/i, "must be a hex color, for example #79C4D0")
            .transform((value) => Number.parseInt(value.replace("#", ""), 16))
    );
}

/**
 * Empty means "feature disabled", which OPTIONAL_FEATURES turns into a startup
 * warning; a non-empty value has to be a real ID.
 * @returns {import('zod').ZodType}
 */
function optionalIdEnv() {
    return withDefault(
        "",
        z
            .string()
            .refine(
                (value) => value === "" || discordIdSchema.safeParse(value).success,
                "must be a Discord ID (17-19 digits), or empty to disable the feature it controls"
            )
    );
}

/**
 * @param {string} defaultValue
 * @returns {import('zod').ZodType}
 */
function urlEnv(defaultValue) {
    return withDefault(defaultValue, z.string().refine(isHttpUrl, "must be an http(s) URL"));
}

const MAP_IMAGE_BASE_URL_DEFAULT = "https://bans.snksrv.com/images/maps/";

/**
 * Not urlEnv: unset takes the default but explicitly empty disables map images.
 * The trailing slash is required because getMapImage concatenates directly.
 */
const mapImageBaseUrlEnv = z.preprocess(
    (value) => (value === undefined ? MAP_IMAGE_BASE_URL_DEFAULT : String(value).trim()),
    z
        .string()
        .refine(
            (value) => value === "" || (isHttpUrl(value) && value.endsWith("/")),
            "must be an http(s) URL ending in \"/\" (images are requested as <base><mapname>.jpg), or empty to disable map images"
        )
);

/**
 * BOT_ACTIVITY_TYPE values derive from these keys, so this is the only list to extend.
 * Streaming is absent because it needs a Twitch or YouTube URL.
 */
export const ACTIVITY_TYPE_BY_NAME = Object.freeze({
    competing: ActivityType.Competing,
    custom: ActivityType.Custom,
    listening: ActivityType.Listening,
    playing: ActivityType.Playing,
    watching: ActivityType.Watching
});

/** @type {string[]} */
const ACTIVITY_TYPES = Object.keys(ACTIVITY_TYPE_BY_NAME);

// Discord's activity text limit, the same for a custom state and every name.
const ACTIVITY_TEXT_MAX_LENGTH = 128;

// Names no channel: where the commands are usable is the guild's decision.
const ACTIVITY_TEXT_DEFAULT = "/follow <map> for map change alerts";

/** Over-long text is rejected rather than truncated, so the status always displays as written. */
const activityTextEnv = z.preprocess(
    (value) => (value === undefined ? ACTIVITY_TEXT_DEFAULT : String(value).trim()),
    z.string().max(ACTIVITY_TEXT_MAX_LENGTH, `must be at most ${ACTIVITY_TEXT_MAX_LENGTH} characters (Discord's activity limit), or empty to show no activity`)
);

/** Levels pino accepts, least to most severe. */
export const LOG_LEVELS = Object.freeze(["trace", "debug", "info", "warn", "error", "fatal", "silent"]);

/** Used when LOG_LEVEL is unset, empty, or unrecognized. */
export const DEFAULT_LOG_LEVEL = "info";

/**
 * Kept out of envSchema: pino throws on a bad level at import, before a logger exists to say why.
 * utils/logger.js applies this and falls back to DEFAULT_LOG_LEVEL with a warning instead.
 */
export const logLevelSchema = withDefault(
    DEFAULT_LOG_LEVEL,
    z.string().toLowerCase().pipe(z.enum(LOG_LEVELS, { error: `must be one of: ${LOG_LEVELS.join(", ")}` }))
);

export const envSchema = z.object({
    ADMIN_ROLE_ID: optionalIdEnv(),
    BOT_ACTIVITY_TEXT: activityTextEnv,
    BOT_ACTIVITY_TYPE: withDefault(
        "custom",
        z.string().toLowerCase().pipe(z.enum(ACTIVITY_TYPES, { error: `must be one of: ${ACTIVITY_TYPES.join(", ")}` }))
    ),
    // Discord only links http(s), so this is a page that forwards to steam://connect/.
    CONNECT_BASE_URL: withDefault(
        "",
        z.string().refine((value) => value === "" || isHttpUrl(value), "must be an http(s) URL, or empty to disable the Connect button")
    ),
    DATABASE_PATH: withDefault("db.sqlite", z.string()),
    // Required: the bot leaves every other guild. Empty would open the admin
    // commands, which act on the whole database, to any guild's Administrator.
    DISCORD_GUILD_ID: withDefault(
        "",
        z.string().refine(
            (value) => discordIdSchema.safeParse(value).success,
            "is required and must be a Discord ID (17-19 digits)"
        )
    ),
    DISCORD_TOKEN: withDefault("", z.string().min(1, "is required and must not be empty")),
    // No message ID is configured: the bot owns its server list message (db/embedMessage.js).
    EMBED_CHANNEL_ID: optionalIdEnv(),
    // Exactly six digits: anything wider than 24-bit RGB makes EmbedBuilder throw
    EMBED_COLOR: hexColorEnv("#79C4D0"),
    FALLBACK_AVATAR_URL: urlEnv("https://i.imgur.com/cBiDnMi.png"),
    FALLBACK_CHANNEL_ID: optionalIdEnv(),
    // A multiplier over the ports gamedig tries, not a total attempt budget, so
    // raising this multiplies how long one unreachable server takes.
    GAMEDIG_MAX_RETRIES: intEnv(4, 0, 10),
    // Loopback by default: only reachable from the container's own HEALTHCHECK
    HEALTH_HOST: withDefault("127.0.0.1", z.string()),
    // 0 means disabled, not "pick a port". Defaults to the port the image's
    // HEALTHCHECK probes, so Docker works with nothing set anywhere.
    HEALTH_PORT: intEnv(3000, 0, 65535),
    MAP_IMAGE_BASE_URL: mapImageBaseUrlEnv,
    // Lifetime cap per user; the per-minute rate limit only paces accumulation.
    MAX_FOLLOWS_PER_USER: intEnv(50, 1, 10000),
    // Per map change: Discord quarantines bots for bulk DMs, even opt-in ones.
    MAX_NOTIFICATION_RECIPIENTS: intEnv(200, 1, 10000),
    OFFLINE_SERVER_IMAGE: urlEnv("https://i.imgur.com/WnS0Biz.png"),
    RATE_LIMIT_FOLLOW_PER_MINUTE: intEnv(5, 1, 1000),
    // Repeats of one map are collapsed separately, in notificationService.
    RATE_LIMIT_NOTIFICATION_PER_MINUTE: intEnv(10, 1, 1000),
    RATE_LIMIT_UNFOLLOW_PER_MINUTE: intEnv(5, 1, 1000),
    RETRY_BASE_DELAY: intEnv(1, 0, 60),
    // withRetry needs at least one attempt for its callback to ever run
    RETRY_MAX_RETRIES: intEnv(3, 1, 10),
    // A sub-30s interval would hammer every configured game server; 0 would busy-loop
    SERVER_UPDATE_INTERVAL: intEnv(90, 30, 86400)
});

/** Empty is legal for these, so they produce startup warnings rather than errors. */
const OPTIONAL_FEATURES = Object.freeze([
    { disables: "admin commands are limited to Administrators and the guild owner", variable: "ADMIN_ROLE_ID" },
    { disables: "fallback notifications will be disabled", variable: "FALLBACK_CHANNEL_ID" },
    { disables: "server list embeds will not be updated", variable: "EMBED_CHANNEL_ID" }
]);

/**
 * Parsed only after validation fails, to materialize defaults. Every required variable
 * needs a value here, or that parse throws instead of reporting the real mistakes.
 */
const PLACEHOLDER_ENV = Object.freeze({
    DISCORD_GUILD_ID: "0".repeat(18),
    DISCORD_TOKEN: "unvalidated"
});

/**
 * @param {object} values - Validated environment values
 * @returns {string[]}
 */
function collectOptionalFeatureWarnings(values) {
    return OPTIONAL_FEATURES
        .filter(({ variable }) => values[variable].length === 0)
        .map(({ disables, variable }) => `${variable} is not set - ${disables}`);
}

/**
 * Every variable is a flat string, so the first path segment names the variable.
 * @param {import('zod').core.$ZodIssue} issue
 * @returns {string} - e.g. `SERVER_UPDATE_INTERVAL: must be a whole number`
 */
export function formatEnvIssue(issue) {
    return `${String(issue.path[0])}: ${issue.message}`;
}

/**
 * Collects every failure rather than stopping at the first, so one restart
 * reports all of an operator's mistakes.
 * @param {Record<string, string|undefined>} [env]
 * @returns {{ errors: string[], values: object, warnings: string[] }}
 */
export function parseEnv(env = process.env) {
    const result = envSchema.safeParse(env);

    if (result.success) {
        return { errors: [], values: result.data, warnings: collectOptionalFeatureWarnings(result.data) };
    }

    // Never read (startup aborts on errors); they keep config import from throwing
    // before a logger exists. Warnings stay empty: they would describe defaults.
    return {
        errors: result.error.issues.map(formatEnvIssue),
        values: envSchema.parse(PLACEHOLDER_ENV),
        warnings: []
    };
}
