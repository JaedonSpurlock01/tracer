/**
 * -------------------------------------------------------------------------
 * @file   route.ts
 * @brief  Exposes the protected Staging database smoke endpoint.
 *
 * @description
 *  Authorizes a Staging-only smoke request and verifies Organization reads
 *  and writes through the deployment's Cloudflare Hyperdrive binding.
 *
 * @remarks
 *  Deployments without the smoke token return 404 before opening a database.
 *
 * @see
 *  data/database-smoke.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { getCloudflareContext } from "@opennextjs/cloudflare";

interface DatabaseSmokeBindings {
  HYPERDRIVE?: {
    connectionString: string;
  };
  STAGING_DATABASE_SMOKE_TOKEN?: string;
}

export interface DatabaseSmokeResponse {
  status: "ok";
}

export async function handleDatabaseSmoke(
  request: Request,
  bindings: DatabaseSmokeBindings,
): Promise<Response> {
  const token = bindings.STAGING_DATABASE_SMOKE_TOKEN;

  if (!token || request.headers.get("authorization") !== `Bearer ${token}` || !bindings.HYPERDRIVE) {
    return new Response(null, { status: 404 });
  }

  const [{ Pool }, { smokeDatabase }] = await Promise.all([
    import("pg"),
    import("@/data/database-smoke"),
  ]);
  const pool = new Pool({ connectionString: bindings.HYPERDRIVE.connectionString, max: 1 });

  try {
    await smokeDatabase(pool);
    return Response.json({ status: "ok" } satisfies DatabaseSmokeResponse);
  } finally {
    await pool.end();
  }
}

export async function POST(request: Request): Promise<Response> {
  const { env } = await getCloudflareContext({ async: true });
  return handleDatabaseSmoke(request, env as DatabaseSmokeBindings);
}
