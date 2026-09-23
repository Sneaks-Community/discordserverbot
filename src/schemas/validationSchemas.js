import * as z from "zod";

export const discordIdSchema = z
    .string()
    .min(17, "Discord ID must be 17-19 digits")
    .max(19, "Discord ID must be 17-19 digits")
    .regex(/^\d{17,19}$/, "Discord ID must contain only digits");

/** Lowercased, which is the casing follows are stored under. */
export const mapNameSchema = z
    .string()
    .min(1, "Map name cannot be empty")
    .max(64, "Map name cannot exceed 64 characters")
    .regex(/^[\w-]+$/, "Map name contains invalid characters (only alphanumeric, underscores, and hyphens allowed)")
    .transform((val) => val.toLowerCase());

/**
 * Unicode names are common on CS servers, so only control characters and line
 * separators are rejected; escapeForDiscord handles markdown at render time.
 */
export const playerNameSchema = z
    .string()
    .transform((val) => val.trim())
    .pipe(
        z
            .string()
            .min(1, "Player name cannot be empty")
            .max(64, "Player name cannot exceed 64 characters")
            .regex(/^[^\p{Cc}\p{Zl}\p{Zp}]+$/u, "Player name contains control characters")
    );

/**
 * makeEmbed adds one field per server and Discord caps an embed at 25 fields,
 * so a 26th server makes every embed update fail with an API 400.
 */
const MAX_SERVERS = 25;

export const DEFAULT_SERVER_PORT = 27015;

/** No IPv6: the colon is the port separator, matching the single-colon split in getInfo. */
const serverIpSchema = z
    .string({ error: "ip is required and must be a string" })
    .min(1, "ip cannot be empty")
    .superRefine((value, ctx) => {
        const fail = (message) => ctx.addIssue({ code: "custom", message });

        if (value.trim() !== value) {
            fail("ip cannot have leading or trailing whitespace");
            return;
        }

        const parts = value.split(":");
        if (parts.length > 2) {
            fail("ip must be \"host\" or \"host:port\" (IPv6 addresses are not supported)");
            return;
        }

        const [host, port] = parts;
        if (!host) {
            fail("ip is missing a host (expected \"host\" or \"host:port\")");
        } else if (!/^[A-Za-z0-9.-]+$/.test(host)) {
            fail(`ip host "${host}" contains invalid characters (expected an IPv4 address or hostname)`);
        }

        // An empty port ("host:") is a typo, not an omitted port
        if (port !== undefined) {
            if (!/^\d+$/.test(port)) {
                fail(`ip port "${port}" must be a number`);
            } else if (Number(port) < 1 || Number(port) > 65535) {
                fail(`ip port "${port}" must be between 1 and 65535`);
            }
        }
    });

const serverKeywordSchema = z
    .string({ error: "keyword must be a string" })
    .min(1, "keyword cannot be empty")
    .max(32, "keyword cannot exceed 32 characters")
    .refine((keyword) => keyword === keyword.toLowerCase(), "keyword must be lowercase; lookups lowercase the user's input, so an uppercase keyword can never match")
    .refine((keyword) => keyword === keyword.trim(), "keyword cannot have leading or trailing whitespace");

/**
 * Unknown fields are stripped rather than rejected; validateServersConfig
 * reports them as warnings, so a stale config still starts.
 */
const serverEntrySchema = z.object({
    ip: serverIpSchema,
    keywords: z
        .array(serverKeywordSchema, { error: "keywords is required and must be an array" })
        .min(1, "keywords must list at least one keyword"),
    // Bounded: nick appears in embed field names and the /players title, both
    // capped at 256 characters by Discord.
    nick: z
        .string({ error: "nick is required and must be a string" })
        .min(1, "nick cannot be empty")
        .max(100, "nick cannot exceed 100 characters"),
    protocol: z
        .string({ error: "protocol must be a string" })
        .min(1, "protocol cannot be empty (omit the field to use the default)")
        .optional()
});

export const serversFileSchema = z
    .record(z.string(), serverEntrySchema, { error: "servers.json must be a JSON object of server entries" })
    .refine((servers) => Object.keys(servers).length > 0, "servers.json must define at least one server")
    .refine(
        (servers) => Object.keys(servers).length <= MAX_SERVERS,
        `servers.json cannot define more than ${MAX_SERVERS} servers; Discord caps an embed at ${MAX_SERVERS} fields and the server list embed adds one field per server`
    )
    .superRefine((servers, ctx) => {
        const owners = new Map();

        for (const [name, server] of Object.entries(servers)) {
            for (const keyword of server.keywords) {
                const owner = owners.get(keyword);

                if (owner === undefined) {
                    owners.set(keyword, name);
                } else if (owner === name) {
                    ctx.addIssue({ code: "custom", message: `keyword "${keyword}" is listed twice`, path: [name, "keywords"] });
                } else {
                    ctx.addIssue({
                        code: "custom",
                        message: `keyword "${keyword}" is already used by "${owner}"; lookups return the first match, so one of the two servers would be unreachable`,
                        path: [name, "keywords"]
                    });
                }
            }
        }
    });
