/**
 * -------------------------------------------------------------------------
 * @file   authentication.test.ts
 * @brief  Verifies provisioned identity persistence boundaries.
 *
 * @description
 *  Exercises bootstrap idempotency, conflict rollback, and transactional
 *  session revocation against the public application interfaces.
 *
 * @remarks
 *  The suite uses PostgreSQL Testcontainers and does not fake internal data.
 *
 * @see
 *  data/bootstrap-initial-operator.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestPool } from "./test-pool";

import { bootstrapInitialOperator, BootstrapConflictError } from "@/data/bootstrap-initial-operator";
import { createIdentityAdministration } from "@/data/identity-administration";
import { migrateDatabase } from "@/data/migrate";
import { schema } from "@/data/schema";
import { createTracerAuth } from "@/data/tracer-auth";

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool | undefined;

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  pool = createTestPool(container!.getConnectionUri());
  await migrateDatabase(container!.getConnectionUri());
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

describe.sequential("provisioned identity", () => {
  it("creates exactly one initial Operator and reports an exact rerun as existing", async () => {
    const input = { email: " Operator@Example.com ", name: "Example Operator", timezone: "America/Chicago" };
    const created = await bootstrapInitialOperator(pool!, input);
    const existing = await bootstrapInitialOperator(pool!, input);

    expect(created.status).toBe("created");
    expect(existing).toMatchObject({ status: "existing", organizationId: created.organizationId, userId: created.userId });
    await expect(pool!.query("select count(*) from organization")).resolves.toMatchObject({ rows: [{ count: "1" }] });
    await expect(pool!.query('select count(*) from "user"')).resolves.toMatchObject({ rows: [{ count: "1" }] });
    await expect(pool!.query("select count(*) from member where role = 'owner'")).resolves.toMatchObject({ rows: [{ count: "1" }] });
  });

  it("rejects a conflicting rerun without partial writes", async () => {
    await expect(
      bootstrapInitialOperator(pool!, {
        email: "operator@example.com",
        name: "Different Operator",
        timezone: "America/Chicago",
      }),
    ).rejects.toBeInstanceOf(BootstrapConflictError);
    await expect(pool!.query('select name from "user"')).resolves.toMatchObject({ rows: [{ name: "Example Operator" }] });
  });

  it("keeps OTP responses generic and protects Organization deletion through the public handler", async () => {
    let sentCode = "";
    const backgroundTasks: Promise<unknown>[] = [];
    const auth = createTracerAuth({
      database: drizzle(pool!, { schema }),
      email: {
        async send(message) {
          sentCode = message.text.match(/\d{6}/)?.[0] ?? "";
          return { messageId: "email-1" };
        },
      },
      emailFrom: "auth@example.com",
      allowedRecipients: new Set(["operator@example.com"]),
      backgroundTask: (promise) => {
        backgroundTasks.push(promise);
      },
      secret: "integration-only-secret",
      baseURL: "http://localhost:3000",
    });
    const request = (body: Record<string, string>) =>
      new Request("http://localhost:3000/api/auth/email-otp/send-verification-otp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

    const provisioned = await auth.handler(request({ email: "operator@example.com", type: "sign-in" }));
    const provisionedBody = await provisioned.json();
    const unprovisioned = await auth.handler(request({ email: "unknown@example.com", type: "sign-in" }));
    const unprovisionedBody = await unprovisioned.json();

    expect(provisioned.status).toBe(unprovisioned.status);
    expect(provisionedBody).toEqual({ success: true });
    expect(unprovisionedBody).toEqual({ success: true });
    expect(backgroundTasks).toHaveLength(1);
    await Promise.all(backgroundTasks.splice(0));
    expect(sentCode).toMatch(/^\d{6}$/);

    const disallowedTasks: Promise<unknown>[] = [];
    const disallowedAuth = createTracerAuth({
      database: drizzle(pool!, { schema }),
      email: {
        async send(message) {
          sentCode = message.text.match(/\d{6}/)?.[0] ?? "";
          return { messageId: "email-2" };
        },
      },
      emailFrom: "auth@example.com",
      allowedRecipients: new Set(),
      backgroundTask: (promise) => {
        disallowedTasks.push(promise);
      },
      secret: "integration-only-secret-2",
      baseURL: "http://localhost:3000",
    });
    const disallowed = await disallowedAuth.handler(request({ email: "operator@example.com", type: "sign-in" }));
    expect(disallowed.status).toBe(provisioned.status);
    expect(await disallowed.json()).toEqual({ success: true });
    expect(disallowedTasks).toHaveLength(0);
    expect(backgroundTasks).toHaveLength(0);

    const freshAllowed = await auth.handler(request({ email: "operator@example.com", type: "sign-in" }));
    expect(freshAllowed.status).toBe(provisioned.status);
    expect(backgroundTasks).toHaveLength(1);
    await Promise.all(backgroundTasks.splice(0));
    const signInCode = sentCode;
    expect(signInCode).toMatch(/^\d{6}$/);

    const unprovisionedVerification = await auth.handler(new Request("http://localhost:3000/api/auth/sign-in/email-otp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "unknown@example.com", otp: "123456" }),
    }));
    expect(unprovisionedVerification.status).not.toBe(200);
    await expect(pool!.query('select count(*) from "user"')).resolves.toMatchObject({ rows: [{ count: "1" }] });
    expect(backgroundTasks).toHaveLength(0);

    const deferredGoogle = await auth.handler(new Request("http://localhost:3000/api/auth/sign-in/social", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "google", callbackURL: "/account/settings" }),
    }));
    expect(deferredGoogle.status).not.toBe(200);
    await expect(pool!.query('select count(*) from "user"')).resolves.toMatchObject({ rows: [{ count: "1" }] });

    const signIn = await auth.handler(new Request("http://localhost:3000/api/auth/sign-in/email-otp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "operator@example.com", otp: signInCode }),
    }));
    expect(signIn.status).toBe(200);
    await expect(pool!.query('select state from "user"')).resolves.toMatchObject({ rows: [{ state: "Active" }] });
    await expect(pool!.query("select count(*) from session")).resolves.toMatchObject({ rows: [{ count: "1" }] });
    const sessionCookie = (signIn.headers.get("set-cookie") ?? "").split(";", 1)[0] ?? "";
    const profileUpdate = await auth.handler(new Request("http://localhost:3000/api/auth/update-user", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: sessionCookie },
      body: JSON.stringify({ name: "Updated Operator" }),
    }));
    expect(profileUpdate.status).toBe(200);
    await expect(pool!.query('select name, timezone from "user"')).resolves.toMatchObject({ rows: [{ name: "Updated Operator", timezone: "America/Chicago" }] });
    const preferencesUpdate = await auth.handler(new Request("http://localhost:3000/api/auth/update-user", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: sessionCookie },
      body: JSON.stringify({ timezone: "America/New_York" }),
    }));
    expect(preferencesUpdate.status).toBe(200);
    await expect(pool!.query('select name, timezone from "user"')).resolves.toMatchObject({ rows: [{ name: "Updated Operator", timezone: "America/New_York" }] });

    const [{ id: organizationId }] = (await pool!.query<{ id: string }>("select id from organization")).rows;
    const deletion = await auth.handler(new Request("http://localhost:3000/api/auth/organization/delete", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: sessionCookie,
      },
      body: JSON.stringify({ organizationId }),
    }));
    expect(deletion.status).not.toBe(200);
    await expect(pool!.query("select count(*) from organization")).resolves.toMatchObject({ rows: [{ count: "1" }] });

    const disabledCodeRequest = await auth.handler(request({ email: "operator@example.com", type: "sign-in" }));
    expect(disabledCodeRequest.status).toBe(provisioned.status);
    expect(backgroundTasks).toHaveLength(1);
    await Promise.all(backgroundTasks.splice(0));
    const disabledCode = sentCode;
    expect(disabledCode).toMatch(/^\d{6}$/);

    const [{ id: userId }] = (await pool!.query<{ id: string }>('select id from "user" limit 1')).rows;
    await createIdentityAdministration(pool!).disable(userId);
    const disabled = await auth.handler(request({ email: "operator@example.com", type: "sign-in" }));
    expect(disabled.status).toBe(provisioned.status);
    expect(await disabled.json()).toEqual({ success: true });
    expect(backgroundTasks).toHaveLength(0);
    const disabledSignIn = await auth.handler(new Request("http://localhost:3000/api/auth/sign-in/email-otp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "operator@example.com", otp: disabledCode }),
    }));
    expect(disabledSignIn.status).not.toBe(200);
    await expect(pool!.query("select count(*) from session")).resolves.toMatchObject({ rows: [{ count: "0" }] });
  });

  it("disables a user and revokes all sessions transactionally", async () => {
    const [{ id: userId }] = (await pool!.query<{ id: string }>('select id from "user" limit 1')).rows;
    await pool!.query(
      `insert into session (id, expires_at, token, created_at, updated_at, user_id)
       values ('session-1', now() + interval '1 day', 'token-1', now(), now(), $1),
              ('session-2', now() + interval '1 day', 'token-2', now(), now(), $1)`,
      [userId],
    );

    await createIdentityAdministration(pool!).disable(userId);

    await expect(pool!.query('select state from "user" where id = $1', [userId])).resolves.toMatchObject({ rows: [{ state: "Disabled" }] });
    await expect(pool!.query("select count(*) from session where user_id = $1", [userId])).resolves.toMatchObject({ rows: [{ count: "0" }] });
  });
});
