/**
 * -------------------------------------------------------------------------
 * @file   database.ts
 * @brief  The one way application code reaches PostgreSQL.
 *
 * @description
 *  openDatabase opens a pool for one request, one Trigger.dev task run, or
 *  one test and hands back a Database: query runs one statement on the
 *  pool, transaction runs a callback inside begin and commit on a client
 *  that can only query, taking the named advisory lock first when asked,
 *  stats counts the queries, waves, slowest statement, failures, and
 *  timeouts the owner paid, and close ends the pool in the background
 *  with a deadline. A connect or query that hits the pool's timeout fails
 *  as DatabaseUnavailableError, the error the failure page names.
 *
 * @remarks
 *  Inside a Worker the pool drives RequestSocket so the 10-second connect
 *  and 30-second query timeouts are real; elsewhere pg's Node socket is
 *  used. The pool and the Drizzle instance are exposed for the move from
 *  raw pools: `pool` goes to repositories that have not yet taken a
 *  Database, and `drizzle` exists only for the Better Auth adapter. The
 *  pool tolerates PostgreSQL closing an idle or checked-out client
 *  (57P01, the server shutting down or a terminated backend) because the
 *  integration suite stops its container while clients are open, and
 *  Neon can drop an idle connection. Stats are gathered by wrapping the
 *  pool and every client it hands out until repositories query through
 *  this module alone; a wave starts each time the pool goes from idle to
 *  busy, so queries issued together count once and queries awaited one
 *  after another count each time.
 *
 * @see
 *  data/request-socket.ts
 *  data/database-unavailable.ts
 *  docs/adr/0008-one-database-module.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient, type PoolConfig, type QueryResult, type QueryResultRow } from "pg";

import { DatabaseUnavailableError } from "@/data/database-unavailable";
import { isCloudflareWorker, loadCloudflareSockets, RequestSocket, type SocketLoader } from "@/data/request-socket";
import { schema } from "@/data/schema";

export interface DatabaseStats {
  /** Milliseconds from open to the first connected client, or null if none connected. */
  connectMs: number | null;
  queries: number;
  slowestQueryMs: number;
  failedQueries: number;
  /** True once any connection or query hit the pool's timeout. */
  timedOut: boolean;
  /** Times the pool went from idle to busy: the sequential depth the owner paid. */
  waves: number;
}

/** What a transaction callback can do: query on the transaction's own client, nothing else. */
export interface Transaction {
  query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
}

/** What a read helper may take: the Database itself or a transaction's handle. */
export type Queryable = Pick<Transaction, "query">;

export interface Database {
  query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
  /** Runs the operation inside begin and commit, holding the named advisory lock for the transaction when given. */
  transaction<T>(operation: (transaction: Transaction) => Promise<T>, options?: { lock?: string }): Promise<T>;
  readonly stats: DatabaseStats;
  /** Ends the pool in the background, giving up after the deadline so a dead connection never holds the owner. */
  close(): Promise<"closed" | "abandoned">;
  /** The pool, for repositories that have not yet taken a Database. */
  pool: Pool;
  /** The Drizzle instance the Better Auth adapter needs; nothing else uses it. */
  drizzle: NodePgDatabase<typeof schema>;
}

export interface DatabaseOptions {
  max: number;
  /** Overrides how Cloudflare sockets are obtained; tests hand in sockets that never answer. */
  sockets?: SocketLoader;
}

export const closeDeadlineMs = 2_000;
const connectTimeoutMs = 10_000;
const queryTimeoutMs = 30_000;
const serverShutdown = "57P01";

function isPoolTimeout(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /connection timeout|timeout exceeded when trying to connect|timeout expired|query read timeout/i.test(message);
}

type Instrumented = { query: (...args: unknown[]) => unknown };

export function openDatabase(connectionString: string, options: DatabaseOptions): Database {
  const sockets = options.sockets ?? (isCloudflareWorker() ? loadCloudflareSockets : undefined);
  const stream = sockets ? (config: { ssl?: unknown }) => new RequestSocket(Boolean(config.ssl), sockets) : undefined;
  const pool = new Pool({ connectionString, max: options.max, connectionTimeoutMillis: connectTimeoutMs, query_timeout: queryTimeoutMs, stream: stream as PoolConfig["stream"] });
  const opened = Date.now();
  const stats: DatabaseStats = { connectMs: null, queries: 0, slowestQueryMs: 0, failedQueries: 0, timedOut: false, waves: 0 };
  let ending = false;
  let inFlight = 0;

  pool.on("error", (error: Error & { code?: string }) => {
    if (!ending && error.code !== serverShutdown) console.error("database connection failed", error);
  });
  pool.on("connect", (client: PoolClient) => {
    if (stats.connectMs === null) stats.connectMs = Date.now() - opened;
    client.on("error", () => undefined);
  });

  function begin(): number {
    if (inFlight === 0) stats.waves += 1;
    inFlight += 1;
    return Date.now();
  }

  function record(started: number, error?: unknown): unknown {
    inFlight -= 1;
    stats.queries += 1;
    stats.slowestQueryMs = Math.max(stats.slowestQueryMs, Date.now() - started);
    if (error === undefined) return undefined;
    stats.failedQueries += 1;
    if (!isPoolTimeout(error)) return error;
    stats.timedOut = true;
    return new DatabaseUnavailableError(error);
  }

  function counted(run: () => unknown): unknown {
    const started = begin();
    let result: unknown;
    try {
      result = run();
    } catch (error) {
      throw record(started, error);
    }
    if (result && typeof (result as Promise<unknown>).then === "function") {
      return (result as Promise<unknown>).then(
        (value) => {
          record(started);
          return value;
        },
        (error: unknown) => {
          throw record(started, error);
        },
      );
    }
    record(started);
    return result;
  }

  const wrapped = new WeakSet<object>();
  const servingPoolQuery = new WeakSet<object>();

  function instrument(target: Instrumented) {
    if (wrapped.has(target)) return;
    wrapped.add(target);
    const original = target.query.bind(target);
    target.query = (...args: unknown[]) => (servingPoolQuery.has(target) ? original(...args) : counted(() => original(...args)));
  }

  function query(text: string, params?: unknown[]): Promise<QueryResult<QueryResultRow>> {
    servingPoolQuery.add(pool);
    try {
      return counted(() => pool.query(text, params)) as Promise<QueryResult<QueryResultRow>>;
    } finally {
      servingPoolQuery.delete(pool);
    }
  }

  pool.on("acquire", (client: PoolClient) => instrument(client as unknown as Instrumented));
  instrument(pool as unknown as Instrumented);
  const originalConnect = pool.connect.bind(pool) as (...inner: unknown[]) => unknown;
  (pool as { connect: unknown }).connect = ((...args: unknown[]) => {
    const callback = typeof args[0] === "function" ? (args[0] as (error: unknown, ...rest: unknown[]) => void) : undefined;
    if (callback) {
      return originalConnect((error: unknown, client: unknown, ...rest: unknown[]) => {
        const served = client !== null && typeof client === "object";
        if (served) servingPoolQuery.add(client);
        try {
          callback(error, client, ...rest);
        } finally {
          if (served) servingPoolQuery.delete(client);
        }
      });
    }
    const result = originalConnect(...args);
    if (result && typeof (result as Promise<unknown>).then === "function") {
      return (result as Promise<PoolClient>).catch((error: unknown) => {
        if (!isPoolTimeout(error)) throw error;
        stats.timedOut = true;
        throw new DatabaseUnavailableError(error);
      });
    }
    return result;
  }) as typeof pool.connect;

  return {
    pool,
    drizzle: drizzle(pool, { schema }),
    stats,
    query: query as Database["query"],
    async transaction(operation, transactionOptions) {
      const client = await pool.connect();
      let failed = false;
      try {
        await client.query("begin");
        if (transactionOptions?.lock) await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [transactionOptions.lock]);
        const result = await operation({ query: (text, params) => client.query(text, params) });
        await client.query("commit");
        return result;
      } catch (error) {
        failed = true;
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release(failed ? true : undefined);
      }
    },
    async close() {
      ending = true;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<"abandoned">((resolve) => {
        timer = setTimeout(() => resolve("abandoned"), closeDeadlineMs);
      });
      try {
        return await Promise.race([pool.end().then(() => "closed" as const, () => "closed" as const), deadline]);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
