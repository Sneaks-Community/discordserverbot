import { CONFIG_VALUES } from "../config/index.js";

/**
 * Retries with exponential backoff. The attempt count is clamped, not trusted:
 * a `maxRetries` of 0 would skip the loop and return undefined, making every
 * caller a silent no-op.
 * @param {Function} fn - The async operation to attempt
 * @param {object} [options]
 * @param {number} [options.baseDelay] - Base delay in milliseconds
 * @param {Function} [options.isRetryable] - Defaults to retrying everything
 * @param {number} [options.maxRetries] - Total attempts, clamped to at least 1
 * @returns {Promise<any>}
 * @throws {any} - The error from the final attempt, or the first terminal error
 */
export async function withRetry(fn, options = {}) {
    const {
        baseDelay = CONFIG_VALUES.RETRY_BASE_DELAY_MS,
        isRetryable = () => true,
        maxRetries = CONFIG_VALUES.RETRY_MAX_RETRIES
    } = options;

    const requested = Number(maxRetries);
    const attempts = Number.isFinite(requested) ? Math.max(1, Math.trunc(requested)) : 1;

    let lastError;

    for (let i = 0; i < attempts; i++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            // A permanent failure (deleted message, missing permission) is thrown
            // straight back rather than retried on a growing delay.
            if (i === attempts - 1 || !isRetryable(error)) break;
            // Equal jitter: half the backoff fixed, half random, so parallel retries
            // (one per configured embed) stop landing on the same tick.
            const backoff = baseDelay * 2 ** i;
            await new Promise(resolve => setTimeout(resolve, backoff / 2 + Math.random() * (backoff / 2)));
        }
    }

    // Only reached when every attempt threw, so lastError is set. Rethrowing here
    // rather than in the loop is what stops the failure path resolving undefined.
    throw lastError;
}
