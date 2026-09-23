import { validateWithZod } from "../utils/zodValidator.js";

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
