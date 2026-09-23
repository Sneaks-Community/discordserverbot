import { dbLogger } from "../utils/logger.js";
import { validateWithZod } from "../utils/zodValidator.js";
import { getStatement } from "./connection.js";

/**
 * @param {import('zod').ZodType} schema
 * @param {any} value
 * @param {string} operationName - Label for the error message
 * @returns {any} The parsed value, with schema transforms applied
 */
export function validateOrThrow(schema, value, operationName) {
    const result = validateWithZod(schema, value, operationName);
    if (!result.valid) {
        throw new Error(result.error);
    }
    return result.data;
}

/**
 * @param {string} sql
 * @param {Array} params
 * @param {string} operationName - Label for the error log
 * @param {"all" | "get" | "run"} mode - better-sqlite3 method to invoke
 * @returns {any}
 */
export function runStatement(sql, params, operationName, mode) {
    const stmt = getStatement(sql);
    try {
        return stmt[mode](...params);
    } catch (err) {
        dbLogger.error({ err, operation: operationName }, "Database error");
        throw err;
    }
}
