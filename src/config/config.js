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
 * Keyed by the camelCase variable name, with an Ms suffix where seconds become
 * milliseconds. envSchema has already range-checked every value.
 */
export const config = {
    adminRoleId: env.ADMIN_ROLE_ID,
    // Empty shows no activity.
    botActivityText: env.BOT_ACTIVITY_TEXT,
    botActivityType: ACTIVITY_TYPE_BY_NAME[env.BOT_ACTIVITY_TYPE],
    databasePath: env.DATABASE_PATH,
    discordGuildId: env.DISCORD_GUILD_ID,
    discordToken: env.DISCORD_TOKEN,
    embedChannelId: env.EMBED_CHANNEL_ID,
    embedColor: env.EMBED_COLOR,
    fallbackAvatarUrl: env.FALLBACK_AVATAR_URL,
    fallbackChannelId: env.FALLBACK_CHANNEL_ID,
    gamedigMaxRetries: env.GAMEDIG_MAX_RETRIES,
    healthHost: env.HEALTH_HOST,
    healthPort: env.HEALTH_PORT,
    mapImageBaseUrl: env.MAP_IMAGE_BASE_URL,
    maxFollowsPerUser: env.MAX_FOLLOWS_PER_USER,
    maxNotificationRecipients: env.MAX_NOTIFICATION_RECIPIENTS,
    offlineServerImage: env.OFFLINE_SERVER_IMAGE,
    rateLimitFollowPerMinute: env.RATE_LIMIT_FOLLOW_PER_MINUTE,
    rateLimitNotificationPerMinute: env.RATE_LIMIT_NOTIFICATION_PER_MINUTE,
    rateLimitUnfollowPerMinute: env.RATE_LIMIT_UNFOLLOW_PER_MINUTE,
    retryBaseDelayMs: env.RETRY_BASE_DELAY * 1000,
    retryMaxRetries: env.RETRY_MAX_RETRIES,
    serverUpdateIntervalMs: env.SERVER_UPDATE_INTERVAL * 1000
};
