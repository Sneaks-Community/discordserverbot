/** Raised by validateConfig instead of exiting, so index.js stays the single exit point. */
export class ConfigError extends Error {
    /**
     * @param {string} message
     * @param {string[]} [errors] - Every individual failure, in declaration order
     */
    constructor(message, errors = []) {
        super(message);
        this.name = "ConfigError";
        this.errors = errors;
    }
}
