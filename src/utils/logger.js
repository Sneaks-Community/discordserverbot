/**
 * Pass the object first: pino reads later arguments as printf values, so
 * `logger.error("Failed:", err)` drops the error. eslint's no-restricted-syntax enforces this.
 */

import pino from "pino";

import { DEFAULT_LOG_LEVEL, LOG_LEVELS, logLevelSchema } from "../schemas/envSchema.js";

/**
 * Degrades to the default: pino throws on a bad level before a logger exists to say why.
 * @returns {{ level: string, invalid?: string }} - `invalid` holds any rejected value
 */
function resolveLogLevel() {
    const raw = process.env.LOG_LEVEL;
    const result = logLevelSchema.safeParse(raw);

    return result.success ? { level: result.data } : { invalid: raw, level: DEFAULT_LOG_LEVEL };
}

const { invalid: invalidLogLevel, level: logLevel } = resolveLogLevel();

/**
 * pino-pretty on a TTY, JSON everywhere else.
 * @returns {import('pino').Logger}
 */
function createLogger() {
    const isDevelopment = process.stdout.isTTY;

    // Matches object keys only, not tokens interpolated into a message string.
    // fast-redact is case sensitive and `*` is exactly one level, no prefix globs.
    const redactPaths = [
        "token",
        "*.token",
        "*.*.token",
        "DISCORD_TOKEN",
        "*.DISCORD_TOKEN",
        "*.*.DISCORD_TOKEN",
        "authorization",
        "*.authorization",
        "*.*.authorization",
        "Authorization",
        "*.Authorization",
        "*.*.Authorization"
    ];

    const baseConfig = {
        level: logLevel,
        redact: {
            censor: "**REDACTED**",
            paths: redactPaths
        },
        timestamp: pino.stdTimeFunctions.isoTime
    };

    if (isDevelopment && process.env.NODE_ENV !== "production") {
        try {
            return pino({
                ...baseConfig,
                transport: {
                    options: {
                        colorize: true,
                        customColors: "fatal:red,error:red,warn:yellow,info:green,debug:gray,trace:gray",
                        ignore: "pid,hostname",
                        messageFormat: "({ts}) {level}: {msg}",
                        translateTime: "SYS:yyyy-mm-dd HH:MM:ss.l o"
                    },
                    target: "pino-pretty"
                }
            });
        } catch {
            // pino-pretty is not installed; fall through to JSON logging.
        }
    }

    return pino(baseConfig);
}

const logger = createLogger();

export const botLogger = logger.child({ module: "bot" });
export const commandLogger = logger.child({ module: "commands" });
export const dbLogger = logger.child({ module: "database" });
export const embedLogger = logger.child({ module: "embeds" });
export const serviceLogger = logger.child({ module: "services" });
export const configLogger = logger.child({ module: "config" });
export const mainLogger = logger.child({ module: "main" });

// A lost log line beats a process that will not die.
const FLUSH_TIMEOUT_MS = 1000;

/**
 * Needed in development, where the pino `transport` worker thread loses buffered lines on a
 * same-tick process.exit(). Production JSON to stdout is synchronous, so this is a no-op there.
 * @returns {Promise<void>} Resolves once drained, or on timeout
 */
export function flushLogs() {
    return new Promise((resolve) => {
        // Not unref'd: thread-stream's Atomics.waitAsync does not hold the loop open,
        // so an unref'd timer would let Node exit before the flush settles.
        const timer = setTimeout(resolve, FLUSH_TIMEOUT_MS);

        // A flush error is not actionable; the caller is already on its way out.
        logger.flush(() => {
            clearTimeout(timer);
            resolve();
        });
    });
}

// Surface a bad LOG_LEVEL now that there is a logger to report it with.
if (invalidLogLevel) {
    configLogger.warn(
        { configuredLevel: invalidLogLevel, effectiveLevel: logLevel, validLevels: LOG_LEVELS },
        "Invalid LOG_LEVEL; falling back to default"
    );
}
