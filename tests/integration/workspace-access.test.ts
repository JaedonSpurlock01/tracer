/**
 * -------------------------------------------------------------------------
 * @file   workspace-access.test.ts
 * @brief  Verifies Client Viewer Workspace access through Access Grants.
 *
 * @description
 *  Signs in a real Client Viewer and exercises the Workspaces server
 *  interface to prove granted reads, ungranted denials, Operator-only
 *  mutations, Workspace State rules, and immediate revocation, including
 *  for streamed Recording audio and waveform peaks, and Recording media
 *  expiry 12 months after the Call started.
 *
 * @remarks
 *  Revocation is checked with a session created before the grant is removed,
 *  because Access Grant checks must not wait for a new sign-in. The R2
 *  bucket is faked at its binding boundary; tests/workers/recording-audio
 *  covers real R2 range reads.
 *
 * @see
 *  data/workspace-authorization.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bootstrapInitialOperator } from "@/data/bootstrap-initial-operator";
import { createIntegrations } from "@/data/integrations";
import { migrateDatabase } from "@/data/migrate";
import { createOperatorAdministrationHandler } from "@/data/operator-administration-handler";
import { schema } from "@/data/schema";
import type { RecordingMediaBucket } from "@/data/recording-media";
import { recordingObjectKey } from "@/data/recording-transfer";
import { waveformObjectKey } from "@/data/recording-waveform";
import { createTracerAuth } from "@/data/tracer-auth";
import { type TwilioClient } from "@/data/twilio-client";
import { createWorkspacesHandler } from "@/data/workspaces-handler";

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool | undefined;
let organizationId = "";
const messages: { to: string; subject: string; text: string; html: string }[] = [];
const backgroundTasks: Promise<unknown>[] = [];
const recipients = new Set(["operator@example.com", "client@example.com"]);
const fakeTwilio: TwilioClient = {
  async fetchAccount() { throw new Error("not implemented"); },
  async listIncomingPhoneNumbers() { throw new Error("not implemented"); },
  async fetchIncomingPhoneNumber() { throw new Error("not implemented"); },
  async updateIncomingPhoneNumberVoice() { throw new Error("not implemented"); },
};
const email = { async send(message: (typeof messages)[number]) { messages.push(message); return { messageId: `email-${messages.length}` }; } };

const database = () => drizzle(pool!, { schema });
const auth = () => createTracerAuth({
  database: database(),
  email,
  emailFrom: "auth@example.com",
  allowedRecipients: recipients,
  backgroundTask: (promise) => backgroundTasks.push(promise),
  secret: "integration-only-secret",
  baseURL: "http://localhost:3000",
});

const storedObjects = new Map<string, Uint8Array>();
const recordingBucket: RecordingMediaBucket = {
  async get(key, options) {
    const bytes = storedObjects.get(key);
    if (!bytes) return null;
    const offset = options?.range?.offset ?? 0;
    const length = options?.range?.length ?? bytes.byteLength - offset;
    return { body: new Blob([bytes.slice(offset, offset + length)]).stream() };
  },
};

const workspacesHandler = () => createWorkspacesHandler({
  auth: auth(),
  database: database(),
  pool: pool!,
  twilio: fakeTwilio,
  integrations: (id) => createIntegrations({ pool: pool!, organizationId: id, twilio: fakeTwilio, masterKey: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=", activeWorkspaceCount: async () => 0 }),
  baseURL: "http://localhost:3000",
  recordingBucket,
});

const usersHandler = () => createOperatorAdministrationHandler({
  auth: auth(),
  database: database(),
  pool: pool!,
  email,
  emailFrom: "auth@example.com",
  allowedRecipients: recipients,
  signInUrl: "http://localhost:3000/sign-in",
});

async function signIn(address: string): Promise<string> {
  const before = messages.length;
  const taskCount = backgroundTasks.length;
  const instance = auth();
  const send = await instance.handler(new Request("http://localhost:3000/api/auth/email-otp/send-verification-otp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: address, type: "sign-in" }) }));
  expect(send.status).toBe(200);
  await Promise.all(backgroundTasks.splice(taskCount));
  const code = messages.slice(before).at(-1)?.text.match(/\d{6}/)?.[0];
  const verify = await instance.handler(new Request("http://localhost:3000/api/auth/sign-in/email-otp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: address, otp: code }) }));
  expect(verify.status).toBe(200);
  return (verify.headers.get("set-cookie") ?? "").split(";", 1)[0];
}

async function workspaces(path: string, cookie: string, init: RequestInit = {}) {
  const response = await workspacesHandler()(new Request(`http://localhost:3000/api/workspaces${path}`, { ...init, headers: { cookie, "content-type": "application/json" } }));
  return { response, body: await response.json() as Record<string, unknown> };
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await migrateDatabase(container.getConnectionUri());
  organizationId = (await bootstrapInitialOperator(pool, { email: "operator@example.com", name: "Example Operator", timezone: "UTC" })).organizationId;
  await pool.query(`insert into organization (id, name, slug, created_at) values ('other-organization-id', 'Other', 'other', now())`);
  await pool.query(
    `insert into workspace (id, organization_id, name, reporting_timezone, state, created_at, updated_at)
     values ('granted-active', $1, 'Acme Plumbing', 'UTC', 'Active', now(), now()),
            ('granted-archived', $1, 'Delta Electric', 'UTC', 'Active', now(), now()),
            ('granted-restored', $1, 'Echo Dental', 'UTC', 'Active', now(), now()),
            ('ungranted-active', $1, 'Gamma HVAC', 'UTC', 'Active', now(), now()),
            ('other-organization-workspace', 'other-organization-id', 'Other Org Workspace', 'UTC', 'Active', now(), now())`,
    [organizationId],
  );
  const operatorCookie = await signIn("operator@example.com");
  const provisioned = await usersHandler()(new Request("http://localhost:3000/api/users", {
    method: "POST",
    headers: { cookie: operatorCookie, "content-type": "application/json" },
    body: JSON.stringify({ email: "client@example.com", role: "Client Viewer", workspaceIds: ["granted-active", "granted-archived", "granted-restored"], sendEmail: false }),
  }));
  expect(provisioned.status).toBe(201);
  const clientId = ((await provisioned.json()) as { user: { id: string } }).user.id;
  await pool.query(
    `insert into access_grant (id, organization_id, workspace_id, user_id, created_at)
     values ('cross-organization-grant', 'other-organization-id', 'other-organization-workspace', $1, now())`,
    [clientId],
  );
  await pool.query(`update workspace set state = 'Archived', archived_at = now() where id = 'granted-archived'`);
  await pool.query(`update workspace set state = 'Setup Required' where id = 'granted-restored'`);
}, 120_000);

afterAll(async () => { await pool?.end(); await container?.stop(); });

describe.sequential("Workspace access", () => {
  let clientCookie = "";

  it("lists only directly granted Active and Archived Workspaces in the Client Viewer Organization", async () => {
    clientCookie = await signIn("client@example.com");
    const list = await workspaces("", clientCookie);
    expect(list.response.status).toBe(200);
    expect((list.body.workspaces as { id: string }[]).map((workspace) => workspace.id)).toEqual(["granted-active", "granted-archived"]);
    expect(list.body).toMatchObject({ total: 2, counts: { setupRequired: 0, active: 1, archived: 1 } });
    expect((list.body.workspaces as { createdBy: unknown }[]).every((workspace) => workspace.createdBy === null)).toBe(true);
  });

  it("reads a granted Workspace and denies ungranted, dormant, and cross-Organization Workspaces", async () => {
    expect((await workspaces("/granted-active", clientCookie)).response.status).toBe(200);
    expect((await workspaces("/granted-archived", clientCookie)).response.status).toBe(200);
    expect((await workspaces("/ungranted-active", clientCookie)).response.status).toBe(404);
    expect((await workspaces("/granted-restored", clientCookie)).response.status).toBe(404);
    expect((await workspaces("/other-organization-workspace", clientCookie)).response.status).toBe(404);
  });

  it("keeps every Workspace mutation and Operator-only read behind Operator authorization", async () => {
    expect((await workspaces("/granted-active", clientCookie, { method: "PATCH", body: JSON.stringify({ name: "Renamed" }) })).response.status).toBe(403);
    expect((await workspaces("/granted-active/flow", clientCookie)).response.status).toBe(403);
    expect((await workspaces("/granted-active/archive", clientCookie, { method: "POST", body: "{}" })).response.status).toBe(403);
    expect((await workspaces("/numbers", clientCookie)).response.status).toBe(403);
    expect((await workspaces("", clientCookie, { method: "POST", body: JSON.stringify({ name: "New", reportingTimezone: "UTC" }) })).response.status).toBe(403);
  });

  it("blocks the next read from an existing session after an Access Grant is removed", async () => {
    const operatorCookie = await signIn("operator@example.com");
    const clientId = (await pool!.query<{ id: string }>(`select id from "user" where email = 'client@example.com'`)).rows[0].id;
    const removed = await usersHandler()(new Request(`http://localhost:3000/api/users/${clientId}/access-grants/granted-archived`, {
      method: "DELETE",
      headers: { cookie: operatorCookie },
    }));
    expect(removed.status).toBe(200);
    expect((await workspaces("/granted-archived", clientCookie)).response.status).toBe(404);
    const list = await workspaces("", clientCookie);
    expect((list.body.workspaces as { id: string }[]).map((workspace) => workspace.id)).toEqual(["granted-active"]);
  });
});

let seededCalls = 0;

async function seedRecording(
  workspaceId: string,
  recordingId: string,
  transferState: "Stored" | "Pending" = "Stored",
  options: { callStartedAt?: Date; waveform?: boolean } = {},
): Promise<{ key: string; bytes: Uint8Array; peaksKey: string; peaks: string }> {
  seededCalls += 1;
  const sequence = String(seededCalls).padStart(32, "0");
  const workspace = (await pool!.query<{ organization_id: string }>("select organization_id from workspace where id = $1", [workspaceId])).rows[0];
  const callId = `${recordingId}-call`;
  await pool!.query(
    `insert into twilio_number (id, organization_id, twilio_sid, phone_number, friendly_name, voice_capable, first_seen_at, last_seen_at, created_at, updated_at)
     values ($1, $2, $3, $4, 'Recording Number', true, now(), now(), now(), now())`,
    [`${callId}-number`, workspace.organization_id, `PN${sequence}`, `+1415555${String(seededCalls).padStart(4, "0")}`],
  );
  await pool!.query(
    `insert into number_assignment (id, organization_id, workspace_id, twilio_number_id, phone_number, started_at, ended_at, ended_reason, created_at)
     values ($1, $2, $3, $4, $5, now(), now(), 'replaced', now())`,
    [`${callId}-assignment`, workspace.organization_id, workspaceId, `${callId}-number`, `+1415555${String(seededCalls).padStart(4, "0")}`],
  );
  await pool!.query(
    `insert into flow_version (id, organization_id, workspace_id, version, graph, published_at)
     values ($1, $2, $3, $4, '{}', now())`,
    [`${callId}-flow`, workspace.organization_id, workspaceId, seededCalls],
  );
  await pool!.query(
    `insert into call (id, organization_id, workspace_id, number_assignment_id, flow_version_id, twilio_call_sid, tracking_number, started_at, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, now(), now())`,
    [callId, workspace.organization_id, workspaceId, `${callId}-assignment`, `${callId}-flow`, `CA${sequence}`, `+1415555${String(seededCalls).padStart(4, "0")}`, options.callStartedAt ?? new Date()],
  );
  const key = recordingObjectKey({ id: recordingId, organizationId: workspace.organization_id, workspaceId, callId });
  const bytes = new TextEncoder().encode(`RIFF synthetic recording ${recordingId}`);
  await pool!.query(
    `insert into recording (id, organization_id, workspace_id, call_id, twilio_recording_sid, source, channels, transfer_state, r2_object_key, size_bytes, sha256, stored_at, created_at, updated_at)
     values ($1, $2, $3, $4, $5, 'connected', 2, $6, $7, $8, 'checksum', $9, now(), now())`,
    [recordingId, workspace.organization_id, workspaceId, callId, `RE${sequence}`, transferState, transferState === "Stored" ? key : null, transferState === "Stored" ? bytes.byteLength : null, transferState === "Stored" ? new Date() : null],
  );
  if (transferState === "Stored") storedObjects.set(key, bytes);
  const peaksKey = waveformObjectKey({ id: recordingId, organizationId: workspace.organization_id, workspaceId, callId });
  const peaks = JSON.stringify({ version: 1, sampleRate: 8000, samplesPerPixel: 160, pixelsPerSecond: 50, durationSeconds: 0.04, lanes: ["Caller", "Business"], peaks: [[0.1, 0.5], [0.25, 1]] });
  if (transferState === "Stored" && options.waveform !== false) {
    await pool!.query("update recording set waveform_state = 'Stored', waveform_object_key = $2, waveform_generated_at = now() where id = $1", [recordingId, peaksKey]);
    storedObjects.set(peaksKey, new TextEncoder().encode(peaks));
  }
  return { key, bytes, peaksKey, peaks };
}

async function recordingAudio(workspaceId: string, recordingId: string, cookie: string, headers: Record<string, string> = {}) {
  return workspacesHandler()(new Request(`http://localhost:3000/api/workspaces/${workspaceId}/recordings/${recordingId}/audio`, { headers: { cookie, ...headers } }));
}

async function recordingPeaks(workspaceId: string, recordingId: string, cookie: string) {
  return workspacesHandler()(new Request(`http://localhost:3000/api/workspaces/${workspaceId}/recordings/${recordingId}/peaks`, { headers: { cookie } }));
}

describe.sequential("Recording stream", () => {
  let operatorCookie = "";
  let activeRecording: { key: string; bytes: Uint8Array } = { key: "", bytes: new Uint8Array() };

  let clientCookie = "";

  beforeAll(async () => {
    operatorCookie = await signIn("operator@example.com");
    clientCookie = await signIn("client@example.com");
    activeRecording = await seedRecording("granted-active", "active-recording");
    await seedRecording("ungranted-active", "ungranted-recording");
    await seedRecording("other-organization-workspace", "other-organization-recording");
  });

  it("streams a Stored Recording to an Operator as private uncached WAV audio without revealing its object key", async () => {
    const response = await recordingAudio("granted-active", "active-recording", operatorCookie);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("audio/wav");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("content-length")).toBe(String(activeRecording.bytes.byteLength));
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(activeRecording.bytes);
    expect(JSON.stringify([...response.headers])).not.toContain(activeRecording.key);
  });

  it("streams a Stored Recording to a Client Viewer with a current Access Grant", async () => {
    const response = await recordingAudio("granted-active", "active-recording", clientCookie);
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(activeRecording.bytes);
  });

  it("answers Not Found for a Recording in an ungranted Workspace, through another Workspace's path, or in another Organization", async () => {
    for (const [workspaceId, recordingId, cookie] of [
      ["ungranted-active", "ungranted-recording", clientCookie],
      ["granted-active", "ungranted-recording", clientCookie],
      ["other-organization-workspace", "other-organization-recording", clientCookie],
      ["granted-active", "other-organization-recording", clientCookie],
      ["other-organization-workspace", "other-organization-recording", operatorCookie],
      ["granted-active", "other-organization-recording", operatorCookie],
    ]) {
      const response = await recordingAudio(workspaceId, recordingId, cookie);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "not_found" });
    }
  });

  it.each([
    ["bytes=0-3", 0, 3],
    ["bytes=5-", 5, -1],
    ["bytes=-6", -6, -1],
  ])("answers a single %s Range request with the partial audio so playback can seek", async (range, start, end) => {
    const size = activeRecording.bytes.byteLength;
    const first = start < 0 ? size + start : start;
    const last = end < 0 ? size - 1 : end;
    const response = await recordingAudio("granted-active", "active-recording", operatorCookie, { range });
    expect(response.status).toBe(206);
    expect(response.headers.get("content-type")).toBe("audio/wav");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-range")).toBe(`bytes ${first}-${last}/${size}`);
    expect(response.headers.get("content-length")).toBe(String(last - first + 1));
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(activeRecording.bytes.slice(first, last + 1));
  });

  it.each(["bytes=1000-", "bytes=1000-2000"])("answers an unsatisfiable %s Range request with 416 and the Recording size", async (range) => {
    const response = await recordingAudio("granted-active", "active-recording", operatorCookie, { range });
    expect(response.status).toBe(416);
    expect(response.headers.get("content-range")).toBe(`bytes */${activeRecording.bytes.byteLength}`);
    expect(await response.text()).toBe("");
  });

  it("answers Not Found for a Recording whose transfer to R2 is not Stored", async () => {
    await seedRecording("granted-active", "pending-recording", "Pending");
    const response = await recordingAudio("granted-active", "pending-recording", operatorCookie);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
  });

  it("answers Not Found when a Stored Recording's object is missing from R2", async () => {
    const missing = await seedRecording("granted-active", "missing-object-recording");
    storedObjects.delete(missing.key);
    const response = await recordingAudio("granted-active", "missing-object-recording", operatorCookie);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
  });

  it("rejects an unauthenticated Recording stream request", async () => {
    const response = await recordingAudio("granted-active", "active-recording", "");
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthenticated" });
  });

  it("answers Not Found to an existing Client Viewer session after its Access Grant is removed", async () => {
    const clientId = (await pool!.query<{ id: string }>(`select id from "user" where email = 'client@example.com'`)).rows[0].id;
    const removed = await usersHandler()(new Request(`http://localhost:3000/api/users/${clientId}/access-grants/granted-active`, {
      method: "DELETE",
      headers: { cookie: operatorCookie },
    }));
    expect(removed.status).toBe(200);
    const response = await recordingAudio("granted-active", "active-recording", clientCookie);
    expect(response.status).toBe(404);
    expect((await recordingAudio("granted-active", "active-recording", operatorCookie)).status).toBe(200);
  });
});

describe.sequential("Recording waveform peaks", () => {
  let operatorCookie = "";
  let clientCookie = "";
  let activeRecording = { key: "", peaksKey: "", peaks: "" };

  beforeAll(async () => {
    operatorCookie = await signIn("operator@example.com");
    clientCookie = await signIn("client@example.com");
    const clientId = (await pool!.query<{ id: string }>(`select id from "user" where email = 'client@example.com'`)).rows[0].id;
    await pool!.query(
      `insert into access_grant (id, organization_id, workspace_id, user_id, created_at) values ('regranted-active', $1, 'granted-active', $2, now())`,
      [organizationId, clientId],
    );
    activeRecording = await seedRecording("granted-active", "active-peaks-recording");
    await seedRecording("ungranted-active", "ungranted-peaks-recording");
    await seedRecording("other-organization-workspace", "other-organization-peaks-recording");
  });

  it("serves a Stored waveform's peaks to an Operator as private uncached JSON without revealing its object keys", async () => {
    const response = await recordingPeaks("granted-active", "active-peaks-recording", operatorCookie);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.text();
    expect(JSON.parse(body)).toEqual(JSON.parse(activeRecording.peaks));
    expect(JSON.stringify([...response.headers]) + body).not.toContain(activeRecording.peaksKey);
    expect(JSON.stringify([...response.headers]) + body).not.toContain(activeRecording.key);
  });

  it("serves a Stored waveform's peaks to a Client Viewer with a current Access Grant", async () => {
    const response = await recordingPeaks("granted-active", "active-peaks-recording", clientCookie);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(JSON.parse(activeRecording.peaks));
  });

  it("answers Not Found for peaks in an ungranted Workspace, through another Workspace's path, or in another Organization", async () => {
    for (const [workspaceId, recordingId, cookie] of [
      ["ungranted-active", "ungranted-peaks-recording", clientCookie],
      ["granted-active", "ungranted-peaks-recording", clientCookie],
      ["other-organization-workspace", "other-organization-peaks-recording", clientCookie],
      ["granted-active", "other-organization-peaks-recording", clientCookie],
      ["other-organization-workspace", "other-organization-peaks-recording", operatorCookie],
      ["granted-active", "other-organization-peaks-recording", operatorCookie],
    ]) {
      const response = await recordingPeaks(workspaceId, recordingId, cookie);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "not_found" });
    }
  });

  it("answers Not Found for peaks whose waveform is not Stored or whose Recording is not Stored", async () => {
    await seedRecording("granted-active", "pending-waveform-recording", "Stored", { waveform: false });
    await seedRecording("granted-active", "failed-waveform-recording");
    await pool!.query("update recording set waveform_state = 'Failed', waveform_failure_reason = 'Waveform generation failed' where id = 'failed-waveform-recording'");
    await seedRecording("granted-active", "pending-transfer-peaks-recording", "Pending");
    for (const recordingId of ["pending-waveform-recording", "failed-waveform-recording", "pending-transfer-peaks-recording"]) {
      const response = await recordingPeaks("granted-active", recordingId, operatorCookie);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "not_found" });
    }
  });

  it("answers Not Found when a Stored waveform's peaks object is missing from R2", async () => {
    const missing = await seedRecording("granted-active", "missing-peaks-recording");
    storedObjects.delete(missing.peaksKey);
    const response = await recordingPeaks("granted-active", "missing-peaks-recording", operatorCookie);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
  });

  it("rejects an unauthenticated peaks request", async () => {
    const response = await recordingPeaks("granted-active", "active-peaks-recording", "");
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthenticated" });
  });

  it("answers Not Found for peaks to an existing Client Viewer session after its Access Grant is removed", async () => {
    const clientId = (await pool!.query<{ id: string }>(`select id from "user" where email = 'client@example.com'`)).rows[0].id;
    const removed = await usersHandler()(new Request(`http://localhost:3000/api/users/${clientId}/access-grants/granted-active`, {
      method: "DELETE",
      headers: { cookie: operatorCookie },
    }));
    expect(removed.status).toBe(200);
    const response = await recordingPeaks("granted-active", "active-peaks-recording", clientCookie);
    expect(response.status).toBe(404);
    expect((await recordingPeaks("granted-active", "active-peaks-recording", operatorCookie)).status).toBe(200);
  });
});

describe.sequential("Recording media expiry", () => {
  let operatorCookie = "";

  function monthsAgo(months: number): Date {
    const date = new Date();
    date.setUTCMonth(date.getUTCMonth() - months);
    return date;
  }

  beforeAll(async () => {
    operatorCookie = await signIn("operator@example.com");
  });

  it("refuses audio and peaks with Not Found once 12 months have passed since the Call started, keeping the Call and Recording", async () => {
    await seedRecording("granted-active", "expired-recording", "Stored", { callStartedAt: monthsAgo(13) });
    const before = (await pool!.query("select * from recording where id = 'expired-recording'")).rows[0];
    for (const response of [await recordingAudio("granted-active", "expired-recording", operatorCookie), await recordingPeaks("granted-active", "expired-recording", operatorCookie)]) {
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "not_found" });
    }
    expect((await pool!.query("select * from recording where id = 'expired-recording'")).rows[0]).toEqual(before);
    expect((await pool!.query("select id from call where id = 'expired-recording-call'")).rowCount).toBe(1);
  });

  it("keeps serving audio and peaks before 12 months have passed since the Call started", async () => {
    await seedRecording("granted-active", "retained-recording", "Stored", { callStartedAt: monthsAgo(11) });
    expect((await recordingAudio("granted-active", "retained-recording", operatorCookie)).status).toBe(200);
    expect((await recordingPeaks("granted-active", "retained-recording", operatorCookie)).status).toBe(200);
  });
});
