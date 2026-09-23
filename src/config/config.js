import { ACTIVITY_TYPE_BY_NAME, parseEnv } from "../schemas/envSchema.js";

const { errors, values: env, warnings } = parseEnv();

/**
 * Non-empty means every value below fell back to its default and must not be trusted.
 * @type {string[]}
 */
export const ENV_ERRORS = errors;

/**
 * Optional variables left empty, each naming the feature it disables.
 * @type {string[]}
 */
export const ENV_WARNINGS = warnings;

/**
 * @param {number} seconds
 * @returns {number}
 */
function toMs(seconds) {
    return seconds * 1000;
}

/**
 * Already range-checked by envSchema: whole in-range numbers, snowflake-or-empty
 * IDs and absolute http(s) URLs, so consumers need not re-validate.
 */
const baseConfig = {
    // `type` is already the discord.js ActivityType; empty `text` shows nothing.
    activity: {
        text: env.BOT_ACTIVITY_TEXT,
        type: ACTIVITY_TYPE_BY_NAME[env.BOT_ACTIVITY_TYPE]
    },
    cache: {
        userCacheTTLSeconds: env.USER_CACHE_TTL
    },
    database: {
        path: env.DATABASE_PATH
    },
    discord: {
        guildID: env.DISCORD_GUILD_ID,
        token: env.DISCORD_TOKEN
    },
    embedsConfig: {
        channelID: env.EMBED_CHANNEL_ID,
        color: env.EMBED_COLOR
    },
    fallback: {
        channelID: env.FALLBACK_CHANNEL_ID
    },
    follows: {
        maxPerUser: env.MAX_FOLLOWS_PER_USER
    },
    gamedig: {
        defaultMaxRetries: env.GAMEDIG_MAX_RETRIES
    },
    health: {
        host: env.HEALTH_HOST,
        port: env.HEALTH_PORT
    },
    images: {
        fallbackAvatar: env.FALLBACK_AVATAR_URL,
        offlineServer: env.OFFLINE_SERVER_IMAGE
    },
    mapImageBaseUrl: env.MAP_IMAGE_BASE_URL,
    notifications: {
        maxRecipientsPerEvent: env.MAX_NOTIFICATION_RECIPIENTS
    },
    rateLimit: {
        followPerMinute: env.RATE_LIMIT_FOLLOW_PER_MINUTE,
        notificationPerMinute: env.RATE_LIMIT_NOTIFICATION_PER_MINUTE,
        unfollowPerMinute: env.RATE_LIMIT_UNFOLLOW_PER_MINUTE
    },
    retry: {
        baseDelaySeconds: env.RETRY_BASE_DELAY,
        maxRetries: env.RETRY_MAX_RETRIES
    },
    security: {
        adminRoleId: env.ADMIN_ROLE_ID
    },
    serverUpdate: {
        intervalSeconds: env.SERVER_UPDATE_INTERVAL,
        maxConcurrentQueries: env.MAX_CONCURRENT_QUERIES
    }
};

/** The flat view consumers read, with every duration already in milliseconds. */
export const CONFIG_VALUES = {
    EMBED_COLOR: baseConfig.embedsConfig.color,
    EMBED_UPDATE_INTERVAL_MS: toMs(baseConfig.serverUpdate.intervalSeconds),
    FALLBACK_AVATAR: baseConfig.images.fallbackAvatar,
    FOLLOW_RATE_LIMIT_PER_MINUTE: baseConfig.rateLimit.followPerMinute,
    GAMEDIG_MAX_RETRIES: baseConfig.gamedig.defaultMaxRetries,
    HEALTH_HOST: baseConfig.health.host,
    HEALTH_PORT: baseConfig.health.port,
    MAX_CONCURRENT_SERVER_QUERIES: baseConfig.serverUpdate.maxConcurrentQueries,
    MAX_FOLLOWS_PER_USER: baseConfig.follows.maxPerUser,
    MAX_NOTIFICATION_RECIPIENTS: baseConfig.notifications.maxRecipientsPerEvent,
    NOTIFICATION_RATE_LIMIT_PER_MINUTE: baseConfig.rateLimit.notificationPerMinute,
    OFFLINE_SERVER_IMAGE: baseConfig.images.offlineServer,
    RETRY_BASE_DELAY_MS: toMs(baseConfig.retry.baseDelaySeconds),
    RETRY_MAX_RETRIES: baseConfig.retry.maxRetries,
    UNFOLLOW_RATE_LIMIT_PER_MINUTE: baseConfig.rateLimit.unfollowPerMinute,
    USER_CACHE_TTL: toMs(baseConfig.cache.userCacheTTLSeconds)
};

export const config = baseConfig;
