import { config } from "../config/index.js";

/**
 * Exponential backoff. Attempts are clamped, since 0 would skip the loop and resolve undefined.
 * @param {Function} fn
 * @param {object} [options]
 * @param {number} [options.baseDelay] - Base delay in milliseconds
 * @param {Function} [options.isRetryable] - Defaults to retrying everything
 * @param {number} [options.maxRetries] - Total attempts, clamped to at least 1
 * @returns {Promise<any>}
 * @throws {any} - The error from the final attempt, or the first terminal error
 */
export async function withRetry(fn, options = {}) {
    const {
        baseDelay = config.retryBaseDelayMs,
        isRetryable = () => true,
        maxRetries = config.retryMaxRetries
    } = options;

    const requested = Number(maxRetries);
    const attempts = Number.isFinite(requested) ? Math.max(1, Math.trunc(requested)) : 1;

    let lastError;

    for (let i = 0; i < attempts; i++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            if (i === attempts - 1 || !isRetryable(error)) break;
            // Equal jitter: half the backoff fixed, half random, so parallel retries
            // stop landing on the same tick.
            const backoff = baseDelay * 2 ** i;
            await new Promise(resolve => setTimeout(resolve, backoff / 2 + Math.random() * (backoff / 2)));
        }
    }

    // Every attempt threw; rethrowing here keeps the failure path from resolving undefined.
    throw lastError;
}
