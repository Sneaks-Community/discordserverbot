/**
 * Call convention: object first, message second.
 *     logger.error({ err }, "Failed to refresh server data");
 * Pino reads a leading string as the message and later arguments as printf
 * values, so `logger.error("Failed:", err)` discards the error and its stack.
 * The `no-restricted-syntax` rules in eslint.config.js enforce this.
 *
 * Log through one of the child loggers below so every line carries its `module`
 * binding, which is what makes per-subsystem filtering possible.
 */

import pino from "pino";

import { DEFAULT_LOG_LEVEL, LOG_LEVELS, logLevelSchema } from "../schemas/envSchema.js";

/**
 * Applied here rather than in the fatal validation path: pino throws on an
 * unrecognized level at import time, before a logger exists to report why, so
 * an unusable value degrades to the default instead of stopping the process.
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
 * Drains the logger before the process exits. Matters in development, where the
 * pino `transport` writes through a worker thread and a process.exit() in the
 * same tick discards whatever it still holds. Production JSON to stdout is
 * synchronous, so this is a no-op there.
 * @returns {Promise<void>} Resolves once drained, or on timeout
 */
export function flushLogs() {
    return new Promise((resolve) => {
        // Not unref'd: thread-stream waits on the worker with Atomics.waitAsync,
        // which does not hold the loop open, so an unref'd timer would let Node
        // exit before the flush settles. Cleared below, so it costs nothing.
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
