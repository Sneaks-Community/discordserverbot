/**
 * Renders a Zod issue path as an accessor chain, e.g. `.keywords[0]`.
 * @param {ReadonlyArray<string|number|symbol>} path - Issue path after the first segment
 * @returns {string}
 */
export function formatZodPathSuffix(path) {
    return path.map((segment) => (typeof segment === "number" ? `[${segment}]` : `.${String(segment)}`)).join("");
}

/**
 * @param {import('zod').ZodType} schema
 * @param {unknown} input
 * @param {string} [fieldName] - Prefix for the error message
 * @returns {{ valid: true, data: any } | { valid: false, error: string }}
 */
export function validateWithZod(schema, input, fieldName = "Input") {
    const result = schema.safeParse(input);
    if (result.success) {
        return { data: result.data, valid: true };
    }

    const errorMessage = result.error.issues?.[0]?.message || "Validation failed";
    return { error: `${fieldName}: ${errorMessage}`, valid: false };
}

