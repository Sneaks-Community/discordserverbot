import { configLogger } from "../utils/logger.js";
import { config, ENV_ERRORS, ENV_WARNINGS } from "./config.js";
import { serverObject, validateServersConfig } from "./servers.js";

export { config, serverObject };

/** Raised by validateConfig instead of exiting, so src/index.js stays the single exit point. */
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

/**
 * Reports the env findings envSchema made at import time, then checks servers.json.
 * @throws {ConfigError} If the environment or servers.json is unusable
 */
export function validateConfig() {
    // First: on any env error `config` holds only defaults, so later checks would mislead.
    if (ENV_ERRORS.length > 0) {
        throw new ConfigError(
            "Invalid environment variables; fix the values listed in errors (see .env.example for the accepted range of each)",
            ENV_ERRORS
        );
    }

    const servers = validateServersConfig();

    for (const warning of [...ENV_WARNINGS, ...servers.warnings]) {
        configLogger.warn(warning);
    }

    if (servers.errors.length > 0) {
        throw new ConfigError(
            "Critical servers.json errors; fix the reported entries (see README Server Configuration)",
            servers.errors
        );
    }
}
