/**
 * Discord 400s the whole request when a payload passes one of these limits and the user
 * sees only a generic error, so any listing that grows with usage must be bounded first.
 */

export const EMBED_DESCRIPTION_LIMIT = 4096;

export const EMBED_FIELD_NAME_LIMIT = 256;

export const EMBED_FIELD_VALUE_LIMIT = 1024;

export const EMBED_TITLE_LIMIT = 256;

/** Title, description, field names and field values of one embed, summed. */
export const EMBED_TOTAL_LIMIT = 6000;

export const MESSAGE_CONTENT_LIMIT = 2000;

/**
 * Hard-caps one value, marking the cut so a truncated name cannot be mistaken
 * for the real one. For a list of lines use joinWithinLimit instead.
 * @param {string} value
 * @param {number} limit
 * @returns {string} Never longer than `limit`
 */
export function clampText(value, limit) {
    const text = typeof value === "string" ? value : String(value ?? "");
    if (text.length <= limit) return text;

    // The marker counts toward the limit, so a limit below 1 has room for nothing.
    return limit < 1 ? "" : text.slice(0, limit - 1) + "\u2026";
}

/**
 * Default overflow notice appended when lines had to be dropped.
 * @param {number} remaining - Number of lines that did not fit
 * @returns {string} The notice, including its leading newline
 */
function defaultSuffix(remaining) {
    return `\n...and ${remaining} more`;
}

/**
 * Joins lines up to `limit`, noting how many were cut. Non-strings and empties are dropped.
 * The worst-case notice length is reserved up front so the notice can never push the result over.
 * @param {string[]} lines
 * @param {number} limit
 * @param {object} [options]
 * @param {string} [options.separator] - Separator between lines, default newline
 * @param {Function} [options.suffix] - Builds the overflow notice from a remaining count
 * @returns {string} Never longer than `limit`
 */
export function joinWithinLimit(lines, limit, { separator = "\n", suffix = defaultSuffix } = {}) {
    const items = lines.filter((line) => typeof line === "string" && line.length > 0);
    if (items.length === 0) {
        return "";
    }

    const joined = items.join(separator);
    if (joined.length <= limit) {
        return joined;
    }

    const budget = limit - suffix(items.length).length;

    const kept = [];
    let used = 0;
    for (const item of items) {
        const cost = kept.length === 0 ? item.length : item.length + separator.length;
        if (used + cost > budget) {
            break;
        }
        kept.push(item);
        used += cost;
    }

    // Not even the first line fits, so hard-truncate it rather than return empty. The final
    // slice keeps the result within the limit whatever the caller's suffix does.
    if (kept.length === 0) {
        const notice = items.length > 1 ? suffix(items.length - 1) : "";
        const head = items[0].slice(0, Math.max(0, limit - notice.length - 1));
        return (head + "…" + notice).slice(0, limit);
    }

    return (kept.join(separator) + suffix(items.length - kept.length)).slice(0, limit);
}
