import "server-only";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/lib/db/schema";

/**
 * The single seam between this app and Postgres — the file that replaced
 * `lib/server/n8n.ts` when the backend moved in-process.
 *
 * The honesty rule it inherits is unchanged and load-bearing: **an unconfigured
 * backend is reported, never faked.** With `DATABASE_URL` unset the app runs
 * fully, every write route answers `persisted: false`, and no screen pretends a
 * parent's contribution was stored. That is what made the whole flow testable
 * before there was a database, and it is what keeps a misconfigured deploy
 * loudly useless instead of quietly lossy.
 */

export type Db = ReturnType<typeof drizzle<typeof schema>>;

/**
 * Next dev reloads this module on every edit; without a global the connection
 * count climbs until Postgres refuses new ones. In production it is created once
 * and reused for the lifetime of the server process.
 */
const globalForDb = globalThis as unknown as {
  __pandoSql?: ReturnType<typeof postgres>;
  __pandoDb?: Db;
};

function connectionString(): string | null {
  const url = process.env.DATABASE_URL;
  return url && url.trim().length > 0 ? url : null;
}

export function isDbConfigured(): boolean {
  return connectionString() !== null;
}

function create(url: string): Db {
  const client = postgres(url, {
    /**
     * Supabase's transaction-mode pooler (port 6543) multiplexes one server
     * connection across clients, so a prepared statement created on one request
     * is not there on the next — the failures are intermittent and read like
     * random SQL errors. Disabling prepares is the documented cost of using it,
     * and using it is what gets us off the direct host, which is IPv6-only
     * without the paid add-on that an IPv4 VPS cannot reach.
     */
    prepare: false,
    /**
     * The pooler is doing the real pooling; this app only needs enough sockets
     * to overlap requests. Too many here just holds pooler slots idle.
     *
     * **15, was 5 (24 Nov).** Five was shared by everything in this one
     * process — SMS replies, the jobs, the admin, Pando MCP and its log rows —
     * and a Claude session asks several tools at once: a call waited for a
     * socket while the app looked fine, and Claude gave up at 230 s. Fifteen
     * client sockets cost the transaction-mode pooler nothing it is not built
     * for (it multiplexes them onto its own server connections, and its client
     * limit is in the hundreds); an idle one closes after `idle_timeout`.
     */
    max: 15,
    /**
     * Measured, not guessed (10 Aug): against the Supabase pooler a query costs
     * ~195ms of round trip and ~5ms of actual work, while **opening** a
     * connection costs ~1300ms of TLS and auth. At the old 20 seconds, an admin
     * who read one page, thought for half a minute and opened another paid that
     * 1.3s again — which is most of what "the admin feels slow" was.
     *
     * Five minutes keeps the pool warm across a browsing session and still lets
     * it drain on a genuinely idle box. It is a client-side timer only: the
     * pooler is what multiplexes, so a handful of idle sockets is what it is
     * built for.
     */
    idle_timeout: 300,
    connect_timeout: 10,
    /**
     * Who holds a connection, in `pg_stat_activity` (28 Oct, architecture
     * review §6.4). The pool has run out once already, and every client read
     * "postgres.js" — the driver's default for this same startup parameter, so
     * naming it changes nothing a pooler sees.
     */
    connection: { application_name: "pando-web" },
    /**
     * Never let the driver print a query — the values in these statements are
     * phone numbers, names and free text about real families (invariant 7).
     */
    onnotice: () => {},
  });

  globalForDb.__pandoSql = client;
  return drizzle(client, { schema });
}

/**
 * The database handle, or null when `DATABASE_URL` is unset.
 *
 * Callers must handle null rather than assert — that branch is the difference
 * between "we told the parent it wasn't saved" and "we lost their contribution".
 */
export function getDb(): Db | null {
  const url = connectionString();
  if (!url) return null;
  if (!globalForDb.__pandoDb) globalForDb.__pandoDb = create(url);
  return globalForDb.__pandoDb;
}

/**
 * For routes that have already established the database is configured — throws
 * rather than returning null so a missed check is a 500 at the seam, not a
 * confusing null-dereference three layers down.
 */
export function requireDb(): Db {
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL is not set");
  return db;
}

/** What every write path returns, so a route never has to invent the shape. */
export type WriteResult<T = undefined> =
  | { persisted: true; data: T }
  | { persisted: false; reason: "unconfigured" | "error"; error?: string };

/**
 * Runs `fn` against the database and turns any failure into a `persisted:false`
 * rather than an exception, so a route answers honestly instead of 500-ing.
 *
 * The error message is logged with no arguments attached — but "the error
 * message" means the driver's own `PostgresError.message` (e.g. `new row for
 * relation "people" violates check constraint "…"`), never Drizzle's wrapper.
 * `DrizzleQueryError.message` bakes in the full rendered SQL *and every bind
 * parameter* (see `drizzle-orm/errors.js`) — logging it directly would put a
 * parent's phone number, name and free-text answers on stdout on every failed
 * write, which is exactly what invariant 7 forbids. The safe message lives one
 * level down, at `err.cause`.
 */
export async function withDb<T>(
  fn: (db: Db) => Promise<T>,
): Promise<WriteResult<T>> {
  const db = getDb();
  if (!db) return { persisted: false, reason: "unconfigured" };
  try {
    return { persisted: true, data: await fn(db) };
  } catch (err) {
    const { message, code } = driverError(err);
    console.error(`[pando:db] write failed: ${message}${code}`);
    return { persisted: false, reason: "error", error: message };
  }
}

/**
 * The driver's own message, pulled out of whatever wrapped it.
 *
 * Walks to the innermost error rather than reading `cause` once: a wrapper can
 * wrap a wrapper, and the previous version fell back to `err.message` whenever
 * the single hop did not land on an `Error`. That fallback printed the exact
 * thing this function exists to prevent — a failed profile write put a parent's
 * phone number, both names and their entire answer set on stdout, because
 * `DrizzleQueryError.message` is built from the rendered SQL *and every bind
 * parameter*.
 *
 * So there is deliberately no path back to a wrapper's message. An error we
 * cannot identify contributes its class name and nothing else: a lost diagnostic
 * is recoverable, a logged phone number is not.
 */
function driverError(err: unknown): { message: string; code: string } {
  let current: unknown = err;
  let depth = 0;

  while (current instanceof Error && current.cause !== undefined && depth < 8) {
    current = current.cause;
    depth += 1;
  }

  if (!(current instanceof Error) || isQueryWrapper(current)) {
    const name =
      err instanceof Error ? (err.constructor?.name ?? "Error") : typeof err;
    return { message: `unreportable database error (${name})`, code: "" };
  }

  const code =
    "code" in current && typeof current.code === "string"
      ? ` (${current.code})`
      : "";
  return { message: current.message, code };
}

/**
 * Identified by its own fields, not by its message: `DrizzleQueryError` carries
 * `query` and `params`, and postgres.js's `PostgresError` carries neither.
 */
function isQueryWrapper(err: Error): boolean {
  return "query" in err && "params" in err;
}

/**
 * Connection-level failures: the socket closed, never opened, or the server
 * sent the session away (a pooler restart, a deploy, an idle socket dropped on
 * the way). None of them is about the statement — the same read a moment later
 * on a fresh connection is expected to work.
 */
const TRANSIENT_CODES = new Set([
  // postgres.js
  "CONNECT_TIMEOUT",
  "CONNECTION_CLOSED",
  "CONNECTION_ENDED",
  "CONNECTION_DESTROYED",
  // the socket
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
  "EAI_AGAIN",
  // Postgres: admin shutdown, crash shutdown, cannot connect now, connection exceptions, too many connections
  "57P01",
  "57P02",
  "57P03",
  "08000",
  "08001",
  "08003",
  "08004",
  "08006",
  "53300",
]);

/** Said by the pooler in a message rather than a code. */
const TRANSIENT_MESSAGE = /max client connections|terminating connection|connection (?:terminated|closed|reset)/i;

/**
 * True when `err` — or anything it wraps — is a lost or refused connection
 * rather than an error of the statement itself (a syntax error, a constraint, a
 * statement timeout are not: trying them again gives the same answer).
 */
export function isTransientDbError(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; current instanceof Error && depth < 8; depth += 1) {
    const code = "code" in current && typeof current.code === "string" ? current.code : "";
    if (TRANSIENT_CODES.has(code)) return true;
    /* A wrapper's message carries the SQL; only an unwrapped driver error's is read. */
    if (!isQueryWrapper(current) && TRANSIENT_MESSAGE.test(current.message)) return true;
    current = current.cause;
  }
  return false;
}

/**
 * The driver's error code anywhere in `err`'s chain — a SQLSTATE (`57014`) or a postgres.js code
 * (`CONNECTION_CLOSED`) — or null. A code, never a message, so it can be logged (invariant 7).
 */
export function dbErrorCode(err: unknown): string | null {
  let current: unknown = err;
  for (let depth = 0; current instanceof Error && depth < 8; depth += 1) {
    if ("code" in current && typeof current.code === "string") return current.code;
    current = current.cause;
  }
  return null;
}

/**
 * Runs a **read** again once when its connection was lost (24 Nov): a Claude
 * call failed on a dropped socket while everything else in the app was fine.
 *
 * Reads only. A write whose connection dropped may have committed before the
 * answer was lost, and running it again could make a second row — a write
 * fails honestly instead. A statement's own error is never retried.
 */
export async function readWithRetry<T>(
  read: () => Promise<T>,
  { attempts = 2, delayMs = 250 }: { attempts?: number; delayMs?: number } = {},
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await read();
    } catch (err) {
      if (attempt >= attempts || !isTransientDbError(err)) throw err;
      console.warn(`[pando:db] read retried after a lost connection (${attempt}/${attempts - 1})`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

/** Liveness for /api/health. Cheap, and does not touch application tables. */
export async function pingDb(): Promise<
  { ok: true } | { ok: false; reason: "unconfigured" | "error" }
> {
  const db = getDb();
  if (!db) return { ok: false, reason: "unconfigured" };
  try {
    await db.execute("select 1");
    return { ok: true };
  } catch {
    return { ok: false, reason: "error" };
  }
}
