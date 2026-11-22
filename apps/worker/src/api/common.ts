// Shared by the management API (index.ts) and the endpoints for password
// managers (compat.ts): errors, callers and their rights, creating aliases.

import { count, eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { validator } from "hono/validator";
import { z } from "zod";

import {
    ALIAS_LOCAL_PART_PATTERN,
    normalizeAddress,
    RESERVED_LOCAL_PARTS,
    splitAddress,
} from "../addresses";
import { type Db, schema } from "../db";
import { getSettings } from "../settings";
import type * as Api from "./types";

export class ApiException extends HTTPException {
    constructor(
        status: ContentfulStatusCode,
        readonly code: string,
        message: string,
    ) {
        super(status, { message });
    }
}

export const notFound = (what: string) => new ApiException(404, "not_found", `${what} not found`);

/** Validates a JSON body with a zod schema, answering 400 with the first issue. */
export function json<T extends z.ZodType>(bodySchema: T) {
    return validator("json", (value) => {
        const result = bodySchema.safeParse(value);
        if (!result.success) {
            const issue = result.error.issues[0];
            const field = issue?.path.join(".");
            throw new ApiException(
                400,
                "invalid_request",
                field ? `${field}: ${issue?.message}` : (issue?.message ?? "Invalid request"),
            );
        }
        return result.data as z.output<T>;
    });
}

export const seconds = (date: Date) => Math.floor(date.getTime() / 1000);

/** Whose rights a request has: the deployment's admin token, or an account. */
export type Caller =
    | { kind: "token" }
    | { kind: "user"; user: { id: string; role?: string | null } };

export const isAdmin = (p: Caller) => p.kind === "token" || p.user.role === "admin";

/** The user_id of rows the caller owns (null: the token's own rows). */
export const ownerOf = (p: Caller) => (p.kind === "user" ? p.user.id : null);

/** Relational-query filter for rows owned by the caller. */
export const owned = (p: Caller) => {
    const owner = ownerOf(p);
    return owner === null ? { userId: { isNull: true as const } } : { userId: owner };
};

export function requireAdmin(p: Caller) {
    if (!isAdmin(p)) throw new ApiException(403, "forbidden", "Only admins can do this");
}

export function limitsFor(env: Env, p: Caller): Api.Limits | null {
    return isAdmin(p) ? null : getSettings(env).limits;
}

/** Whether accounts may not create aliases with this local part. */
export function isReserved(env: Env, local: string) {
    const mailFrom = getSettings(env).mailFrom;
    const sender = mailFrom && /<([^<>]+)>|^\s*(\S+@\S+)\s*$/.exec(mailFrom);
    const senderLocal = sender ? splitAddress(sender[1] ?? sender[2] ?? "")?.local : undefined;
    return RESERVED_LOCAL_PARTS.has(local) || local === senderLocal?.toLowerCase();
}

/** Whether a database error is a UNIQUE constraint failing (D1 and Drizzle wrap it). */
export function isUniqueViolation(error: unknown): boolean {
    for (let e: unknown = error; e instanceof Error; e = e.cause) {
        if (e.message.includes("UNIQUE constraint failed")) return true;
    }
    return false;
}

/** Creates an alias for the caller, with every check the API makes. */
export async function createAlias(
    env: Env,
    db: Db,
    caller: Caller,
    input: {
        address: string;
        destination: typeof schema.destinations.$inferSelect;
        description?: string;
        enabled?: boolean;
    },
) {
    const address = normalizeAddress(input.address);
    const parts = splitAddress(address);
    if (!parts || !ALIAS_LOCAL_PART_PATTERN.test(parts.local)) {
        throw new ApiException(
            400,
            "invalid_address",
            "Alias names may use letters, digits, dots, underscores and hyphens",
        );
    }
    const domain = await db.query.domains.findFirst({ where: { name: parts.domain } });
    if (!domain || (!domain.shared && !isAdmin(caller))) {
        throw new ApiException(400, "unknown_domain", `Domain ${parts.domain} is not available`);
    }
    if (!isAdmin(caller) && isReserved(env, parts.local)) {
        throw new ApiException(400, "reserved", `${parts.local}@ is reserved for admins`);
    }
    if (await db.query.aliases.findFirst({ where: { address } })) {
        throw new ApiException(409, "already_exists", `Alias ${address} already exists`);
    }
    // Addresses of deleted aliases stay with their owner; admins may reuse them.
    const retired = await db.query.retiredAddresses.findFirst({ where: { address } });
    if (retired && retired.userId !== ownerOf(caller) && !isAdmin(caller)) {
        throw new ApiException(
            409,
            "already_exists",
            `Alias ${address} was used before and can't be created again`,
        );
    }
    const limits = limitsFor(env, caller);
    const limitReached = () =>
        new ApiException(
            403,
            "limit_reached",
            `Accounts can have up to ${limits?.aliases} aliases`,
        );
    const owner = ownerOf(caller);
    if (limits) {
        const [row] = await db
            .select({ total: count() })
            .from(schema.aliases)
            .where(eq(schema.aliases.userId, owner!));
        if ((row?.total ?? 0) >= limits.aliases) throw limitReached();
    }
    // One statement, so requests at the same time can't both get under the
    // limit: the row is only inserted while the account is below it.
    const id = crypto.randomUUID();
    const createdAt = Math.floor(Date.now() / 1000);
    let inserted: number;
    try {
        const result = await db.run(sql`
            INSERT INTO aliases (id, user_id, address, domain_id, destination_id, description, enabled, created_at)
            SELECT ${id}, ${owner}, ${address}, ${domain.id}, ${input.destination.id},
                ${input.description ?? ""}, ${(input.enabled ?? true) ? 1 : 0}, ${createdAt}
            ${limits ? sql`WHERE (SELECT count(*) FROM aliases WHERE user_id = ${owner}) < ${limits.aliases}` : sql``}
        `);
        inserted = result.meta.changes;
    } catch (error) {
        // Created by another request since the check above.
        if (isUniqueViolation(error)) {
            throw new ApiException(409, "already_exists", `Alias ${address} already exists`);
        }
        throw error;
    }
    if (inserted === 0) throw limitReached();
    if (retired) {
        await db
            .delete(schema.retiredAddresses)
            .where(eq(schema.retiredAddresses.address, address));
    }
    const alias = await db.query.aliases.findFirst({ where: { id } });
    return { ...alias!, destination: input.destination };
}
