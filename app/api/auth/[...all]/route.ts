/**
 * -------------------------------------------------------------------------
 * @file   route.ts
 * @brief  Mounts Better Auth's Tracer authentication endpoints.
 *
 * @description
 *  Creates a request-scoped Hyperdrive PostgreSQL pool, injects it into the
 *  Better Auth factory, and closes it after each completed response.
 *
 * @remarks
 *  Runtime credentials are read from Cloudflare bindings and never committed.
 *
 * @see
 *  data/tracer-auth.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { toNextJsHandler } from "better-auth/next-js";
import { drizzle } from "drizzle-orm/node-postgres";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { Pool } from "pg";

import { rememberE2eOtp } from "@/data/e2e-auth-fake";
import { createTracerAuth } from "@/data/tracer-auth";
import { schema } from "@/data/schema";
import {
  createCloudflareTransactionalEmail,
  type SendEmail,
  type TransactionalEmail,
} from "@/data/transactional-email";

interface AuthBindings {
  HYPERDRIVE?: { connectionString: string };
  EMAIL?: SendEmail;
  AUTH_EMAIL_FROM?: string;
  AUTH_EMAIL_ALLOWED_RECIPIENTS?: string;
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  E2E_AUTH_FAKE?: string;
  NODE_ENV?: string;
}

function requiredBinding(bindings: AuthBindings, name: keyof AuthBindings): string {
  const value = bindings[name] ?? process.env[String(name)];
  if (typeof value !== "string" || !value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function allowedRecipients(value: string | undefined): ReadonlySet<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((recipient) => recipient.trim().toLowerCase())
      .filter(Boolean),
  );
}

async function handle(request: Request): Promise<Response> {
  const { env, ctx } = await getCloudflareContext({ async: true });
  const bindings = env as AuthBindings;
  const fakeEnabled =
    (bindings.E2E_AUTH_FAKE ?? process.env.E2E_AUTH_FAKE) === "true" &&
    (bindings.NODE_ENV ?? process.env.NODE_ENV) !== "production";
  const connectionString = fakeEnabled
    ? process.env.DATABASE_MIGRATION_URL ?? bindings.HYPERDRIVE?.connectionString
    : bindings.HYPERDRIVE?.connectionString ?? process.env.DATABASE_MIGRATION_URL;
  if (!connectionString) {
    throw new Error("HYPERDRIVE is required");
  }
  const pool = new Pool({ connectionString, max: 1 });

  try {
    if (!bindings.EMAIL && !fakeEnabled) {
      throw new Error("EMAIL is required");
    }
    const database = drizzle(pool, { schema });
    const providerEmail: TransactionalEmail = bindings.EMAIL
      ? createCloudflareTransactionalEmail(bindings.EMAIL)
      : {
          async send() {
            return { messageId: "e2e-fake" };
          },
        };
    const email = fakeEnabled
      ? {
            async send(message: Parameters<typeof providerEmail.send>[0]) {
              rememberE2eOtp(message.text);
              return providerEmail.send(message);
            },
          }
        : providerEmail;
    const auth = createTracerAuth({
      database,
      email,
      emailFrom: requiredBinding(bindings, "AUTH_EMAIL_FROM"),
      allowedRecipients: allowedRecipients(
        (bindings.AUTH_EMAIL_ALLOWED_RECIPIENTS ?? process.env.AUTH_EMAIL_ALLOWED_RECIPIENTS),
      ),
      secret: requiredBinding(bindings, "BETTER_AUTH_SECRET"),
      baseURL: requiredBinding(bindings, "BETTER_AUTH_URL"),
      backgroundTask: (promise) => ctx.waitUntil(promise),
    });
    const handlers = toNextJsHandler(auth);
    switch (request.method) {
      case "GET":
        return await handlers.GET(request);
      case "POST":
        return await handlers.POST(request);
      case "PUT":
        return await handlers.PUT(request);
      case "PATCH":
        return await handlers.PATCH(request);
      case "DELETE":
        return await handlers.DELETE(request);
      default:
        return new Response("Method Not Allowed", { status: 405 });
    }
  } finally {
    await pool.end();
  }
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
