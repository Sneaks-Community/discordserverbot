import { configLogger } from "../utils/logger.js";
import { config, CONFIG_VALUES, ENV_ERRORS, ENV_WARNINGS } from "./config.js";
import { ConfigError } from "./configError.js";
import { serverObject, validateServersConfig } from "./servers.js";

export { config, CONFIG_VALUES, ConfigError, serverObject };

/**
 * Reports the env findings envSchema made at import time, then checks servers.json.
 * Throws rather than exits, so the caller owns the exit and this stays testable.
 * @returns {{ warnings: string[] }} - The non-fatal findings, already logged
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
    const warnings = [...ENV_WARNINGS, ...servers.warnings];

    for (const warning of warnings) {
        configLogger.warn(warning);
    }

    if (servers.errors.length > 0) {
        throw new ConfigError(
            "Critical servers.json errors; fix the reported entries (see README Server Configuration)",
            servers.errors
        );
    }

    return { warnings };
}
