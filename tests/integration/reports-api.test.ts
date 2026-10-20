/**
 * -------------------------------------------------------------------------
 * @file   reports-api.test.ts
 * @brief  Verifies the Reports HTTP API for previews, jobs, history, and downloads.
 *
 * @description
 *  Drives the Reports handler with real Better Auth sessions against a
 *  migrated database. Checks that every route requires an authenticated
 *  Active user, that a Client Viewer cannot preview or request a report
 *  for an ungranted Workspace, that malformed requests answer stable
 *  error codes, that a duplicate request returns the existing job, that a
 *  request without Trigger.dev configured is refused before any job is
 *  recorded, that history shows only the requester's own jobs, that a
 *  download streams the artifact only to its requester while it is
 *  unexpired and every Workspace in its scope is still readable, and that
 *  Regenerate reproduces the stored report window.
 *
 * @remarks
 *  R2 and Trigger.dev are the only fakes. Workspaces, Calls, and
 *  Recordings are seeded directly; the Client Viewer is provisioned
 *  through the Users API so the Access Grants are real.
 *
 * @see
 *  data/reports-handler.ts
 *  data/report-jobs.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bootstrapInitialOperator } from "@/data/bootstrap-initial-operator";
import { migrateDatabase } from "@/data/migrate";
import { createOperatorAdministrationHandler } from "@/data/operator-administration-handler";
import type { Actor } from "@/data/authorization";
import { completeReportJob, createReportJob, failReportJob, type ReportGeneration } from "@/data/report-jobs";
import { createReportsHandler } from "@/data/reports-handler";
import { schema } from "@/data/schema";
import { createTracerAuth } from "@/data/tracer-auth";
import { createReadableWorkspaces } from "@/data/workspace-authorization";

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool | undefined;
let organizationId = "";
const messages: { to: string; subject: string; text: string; html: string }[] = [];
const backgroundTasks: Promise<unknown>[] = [];
const recipients = new Set(["operator@example.com", "client@example.com"]);
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

const storedObjects = new Map<string, Uint8Array<ArrayBuffer>>();
const reportBucket = {
  async get(key: string) {
    const bytes = storedObjects.get(key);
    return bytes ? { body: new Blob([bytes]).stream(), size: bytes.byteLength } : null;
  },
};

const generationRequests: string[] = [];
const reportGeneration: ReportGeneration = {
  async request(job) {
    generationRequests.push(job.id);
  },
};

const reportsHandler = (options: { reportGeneration?: ReportGeneration | null } = {}) => createReportsHandler({
  auth: auth(),
  database: database(),
  pool: pool!,
  reportBucket,
  reportGeneration: options.reportGeneration === null ? undefined : options.reportGeneration ?? reportGeneration,
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

async function reports(path: string, cookie: string | null, init: { method?: string; body?: unknown; reportGeneration?: ReportGeneration | null } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cookie) headers.cookie = cookie;
  const response = await reportsHandler({ reportGeneration: init.reportGeneration })(new Request(`http://localhost:3000/api/reports${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : typeof init.body === "string" ? init.body : JSON.stringify(init.body),
  }));
  return response;
}

async function completeWithArtifacts(jobId: string, files: Array<"pdf" | "csv">): Promise<void> {
  const artifacts = files.map((file) => {
    const bytes = new TextEncoder().encode(file === "pdf" ? `%PDF-1.7 report ${jobId}` : `Call ID,Workspace\ncall-1,North Plumbing\n`);
    storedObjects.set(`reports/${jobId}/report.${file}`, bytes);
    return { file, r2Key: `reports/${jobId}/report.${file}`, byteSize: bytes.byteLength, contentType: file === "pdf" ? "application/pdf" : "text/csv; charset=utf-8" };
  });
  await completeReportJob(pool!, jobId, artifacts, new Date());
}

async function clientActor(): Promise<Actor> {
  const user = (await pool!.query<{ id: string; name: string; email: string; timezone: string }>(`select id, name, email, timezone from "user" where email = 'client@example.com'`)).rows[0];
  return { userId: user.id, organizationId, name: user.name, email: user.email, timezone: user.timezone, state: "Active", role: "Client Viewer" };
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

async function seedWorkspace(id: string, name: string, timezone: string): Promise<void> {
  await pool!.query(
    `insert into workspace (id, organization_id, name, reporting_timezone, state, created_at, updated_at) values ($1, $2, $3, $4, 'Active', now(), now())`,
    [id, organizationId, name, timezone],
  );
}

async function seedCalls(): Promise<void> {
  for (const workspaceId of ["north", "south", "west"]) {
    await pool!.query(
      `insert into twilio_number (id, organization_id, twilio_sid, phone_number, friendly_name, voice_capable, first_seen_at, last_seen_at, created_at, updated_at)
       values ($1, $2, $3, $4, 'Call Number', true, now(), now(), now(), now())`,
      [`${workspaceId}-number`, organizationId, `PN${workspaceId.padEnd(32, "0")}`, { north: "+14155550113", south: "+14155550127", west: "+14155550139" }[workspaceId]],
    );
    await pool!.query(
      "insert into number_assignment (id, organization_id, workspace_id, twilio_number_id, phone_number, started_at, created_at) select $1, $2, $3, $4, phone_number, now(), now() from twilio_number where id = $4",
      [`${workspaceId}-assignment`, organizationId, workspaceId, `${workspaceId}-number`],
    );
    await pool!.query("insert into flow_version (id, organization_id, workspace_id, version, graph, published_at) values ($1, $2, $3, 1, '{}'::jsonb, now())", [`${workspaceId}-flow`, organizationId, workspaceId]);
  }
  const calls: Array<[string, string, string, string]> = [
    ["call-1", "north", "2026-10-06T15:47:31.204Z", "Answered"],
    ["call-2", "north", "2026-09-04T13:22:48.517Z", "Voicemail"],
    ["call-3", "south", "2026-10-08T05:19:26.942Z", "Answered"],
    ["call-4", "west", "2026-10-07T11:02:13.448Z", "Answered"],
  ];
  for (const [index, [id, workspaceId, startedAt, outcome]] of calls.entries()) {
    await pool!.query(
      `insert into call (id, organization_id, workspace_id, number_assignment_id, flow_version_id, twilio_call_sid, tracking_number, caller_number, state, outcome, outcome_reason, started_at, created_at, updated_at)
       select $1, $2, $3, $3 || '-assignment', $3 || '-flow', $4, phone_number, '+12125550164', 'Completed', $5, 'flow_outcome', $6, now(), now() from number_assignment where id = $3 || '-assignment'`,
      [id, organizationId, workspaceId, `CA${String(index + 1).padStart(32, "0")}`, outcome, startedAt],
    );
    await pool!.query(
      `insert into recording (id, organization_id, workspace_id, call_id, twilio_recording_sid, source, channels, transfer_state, r2_object_key, size_bytes, sha256, stored_at,
                              mp3_state, mp3_object_key, mp3_size_bytes, mp3_generated_at, created_at, updated_at)
       values ($1 || '-recording', $2, $3, $1, $4, 'connected', 2, 'Stored', $1 || '.wav', 41_873, 'checksum', now(), 'Stored', $1 || '.mp3', 6_917, now(), now(), now())`,
      [id, organizationId, workspaceId, `RE${String(index + 1).padStart(32, "0")}`],
    );
  }
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await migrateDatabase(container.getConnectionUri());
  organizationId = (await bootstrapInitialOperator(pool, { email: "operator@example.com", name: "Example Operator", timezone: "UTC" })).organizationId;
  await seedWorkspace("north", "North Plumbing", "America/New_York");
  await seedWorkspace("south", "South Roofing", "Asia/Tokyo");
  await seedWorkspace("west", "West Electric", "America/Los_Angeles");
  await seedCalls();
  const operatorCookie = await signIn("operator@example.com");
  const provisioned = await usersHandler()(new Request("http://localhost:3000/api/users", {
    method: "POST",
    headers: { cookie: operatorCookie, "content-type": "application/json" },
    body: JSON.stringify({ email: "client@example.com", role: "Client Viewer", workspaceIds: ["north", "south"], sendEmail: false }),
  }));
  expect(provisioned.status).toBe(201);
}, 120_000);

afterAll(async () => { await pool?.end(); await container?.stop(); });

describe.sequential("Reports API", () => {
  let clientCookie = "";

  it("requires an authenticated user on every route", async () => {
    expect((await reports("", null)).status).toBe(401);
    expect((await reports("", null, { method: "POST", body: {} })).status).toBe(401);
    expect((await reports("/preview", null, { method: "POST", body: {} })).status).toBe(401);
    expect((await reports("/some-job/files/pdf", null)).status).toBe(401);
    expect((await reports("/some-job/regenerate", null, { method: "POST" })).status).toBe(401);
  });

  it("previews a granted report and answers an ungranted or unknown Workspace like a missing one", async () => {
    clientCookie = await signIn("client@example.com");
    const preview = await reports("/preview", clientCookie, {
      method: "POST",
      body: { kind: "report", scope: { kind: "global", workspaceIds: ["north", "south"], timeZone: "America/Chicago" }, period: { kind: "all" }, files: ["pdf"] },
    });
    expect(preview.status).toBe(200);
    expect(preview.headers.get("cache-control")).toBe("private, no-store");
    expect(await json(preview)).toEqual({
      preview: { matchedCalls: 3, retainedRecordings: 3, purgedMedia: 0, expiredMedia: 0, callsWithoutRecording: 0, processingRecordings: 0, failedRecordings: 0 },
      recordingExportLimit: 500,
    });
    for (const scope of [{ kind: "global", workspaceIds: ["north", "west"] }, { kind: "workspace", workspaceId: "west" }, { kind: "workspace", workspaceId: "missing" }]) {
      const refused = await reports("/preview", clientCookie, { method: "POST", body: { kind: "report", scope, period: { kind: "all" }, files: ["pdf"] } });
      expect(refused.status).toBe(404);
      expect(await json(refused)).toEqual({ error: "not_found" });
    }
  });

  it("previews a Calls export from the Calls filter query in global or Workspace scope, and one Call for Export Call", async () => {
    const matched = async (body: unknown) => {
      const preview = await reports("/preview", clientCookie, { method: "POST", body });
      expect(preview.status).toBe(200);
      return ((await json(preview)).preview as { matchedCalls: number }).matchedCalls;
    };
    expect(await matched({ kind: "call_export", scope: { kind: "global" }, query: "outcome=Answered", file: "csv" })).toBe(2);
    expect(await matched({ kind: "call_export", scope: { kind: "global" }, query: `?adv=${encodeURIComponent(JSON.stringify({ combinator: "or", rules: [{ field: "outcome", values: ["Voicemail"] }] }))}`, file: "zip" })).toBe(1);
    expect(await matched({ kind: "call_export", scope: { kind: "workspace", workspaceId: "north" }, query: "", file: "zip" })).toBe(2);
    expect(await matched({ kind: "call_export", scope: { kind: "workspace", workspaceId: "north" }, callId: "call-1", file: "zip" })).toBe(1);
    const ungranted = await reports("/preview", clientCookie, { method: "POST", body: { kind: "call_export", scope: { kind: "workspace", workspaceId: "west" }, callId: "call-4", file: "zip" } });
    expect(ungranted.status).toBe(404);
  });

  it("answers malformed requests with stable error codes", async () => {
    const report = { kind: "report", scope: { kind: "workspace", workspaceId: "north" }, period: { kind: "all" }, files: ["pdf"] };
    for (const [body, status, code] of [
      ["not json", 400, "invalid_input"],
      [{ ...report, kind: "invoice" }, 400, "invalid_input"],
      [{ ...report, files: ["docx"] }, 400, "invalid_input"],
      [{ ...report, period: { kind: "lastYear" } }, 400, "invalid_input"],
      [{ kind: "call_export", scope: { kind: "global" }, query: "outcome=Answered", file: "pdf" }, 400, "invalid_input"],
      [{ kind: "call_export", scope: { kind: "global" }, callId: "call-1", file: "zip" }, 400, "invalid_input"],
      [{ ...report, period: { kind: "custom", from: "2026-09-17", to: "2026-09-03" } }, 400, "invalid_period"],
      [{ ...report, scope: { kind: "global", workspaceIds: ["north", "south"], timeZone: "Mars/Olympus_Mons" } }, 400, "invalid_timezone"],
      [{ ...report, scope: { kind: "global", workspaceIds: [] } }, 400, "empty_scope"],
      [{ ...report, files: [] }, 400, "empty_files"],
    ] as const) {
      const refused = await reports("/preview", clientCookie, { method: "POST", body });
      expect([refused.status, await json(refused)]).toEqual([status, { error: code }]);
    }
  });

  it("creates a job and requests its generation once, returning the existing job for a duplicate request", async () => {
    const body = { kind: "report", scope: { kind: "workspace", workspaceId: "north" }, period: { kind: "custom", from: "2026-09-01", to: "2026-10-10" }, files: ["pdf", "csv"] };
    const created = await reports("", clientCookie, { method: "POST", body });
    expect(created.status).toBe(201);
    const job = (await json(created)).job as { id: string; status: string; kind: string };
    expect(job).toMatchObject({ kind: "report", status: "Queued" });
    const duplicate = await reports("", clientCookie, { method: "POST", body: { ...body, files: ["csv", "pdf"] } });
    expect(duplicate.status).toBe(200);
    expect(((await json(duplicate)).job as { id: string }).id).toBe(job.id);
    expect(generationRequests.filter((id) => id === job.id)).toHaveLength(1);
    const unmatched = await reports("", clientCookie, { method: "POST", body: { ...body, period: { kind: "custom", from: "2025-01-01", to: "2025-01-31" } } });
    expect([unmatched.status, await json(unmatched)]).toEqual([422, { error: "no_matching_calls" }]);
  });

  it("refuses a request while Trigger.dev is not configured and records no job", async () => {
    const before = (await pool!.query("select count(*)::int as count from report_job")).rows[0].count;
    const refused = await reports("", clientCookie, {
      method: "POST",
      body: { kind: "report", scope: { kind: "workspace", workspaceId: "south" }, period: { kind: "all" }, files: ["pdf"] },
      reportGeneration: null,
    });
    expect([refused.status, await json(refused)]).toEqual([503, { error: "generation_unavailable" }]);
    expect((await pool!.query("select count(*)::int as count from report_job")).rows[0].count).toBe(before);
  });

  it("lists only the requester's own jobs, shaped for Report history and View Parameters", async () => {
    const operatorCookie = await signIn("operator@example.com");
    const operatorJob = await reports("", operatorCookie, { method: "POST", body: { kind: "call_export", scope: { kind: "global" }, query: "outcome=Answered", file: "csv" } });
    expect(operatorJob.status).toBe(201);
    const operatorJobId = ((await json(operatorJob)).job as { id: string }).id;
    const clientName = (await pool!.query<{ name: string }>(`select name from "user" where email = 'client@example.com'`)).rows[0].name;

    const history = await reports("", clientCookie);
    expect(history.status).toBe(200);
    expect(history.headers.get("cache-control")).toBe("private, no-store");
    const jobs = (await json(history)).jobs as Array<Record<string, unknown>>;
    expect(jobs.map(({ id }) => id)).not.toContain(operatorJobId);
    expect(jobs.find(({ timeZone }) => timeZone === "America/New_York")).toEqual({
      id: expect.any(String),
      kind: "report",
      status: "Queued",
      failureReason: null,
      requestedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      requestedBy: clientName,
      scope: [{ id: "north", name: "North Plumbing" }],
      timeZone: "America/New_York",
      parameters: { period: { kind: "custom", from: "2026-09-01", to: "2026-10-10" }, window: { from: "2026-09-01", to: "2026-10-10" }, files: ["pdf", "csv"] },
      files: [{ file: "pdf", downloadable: false, href: null }, { file: "csv", downloadable: false, href: null }],
      expiresAt: null,
      canRegenerate: false,
    });
    const operatorHistory = (await json(await reports("", operatorCookie))).jobs as Array<{ id: string; scope: Array<{ id: string }> }>;
    expect(operatorHistory.map(({ id }) => id)).toEqual([operatorJobId]);
    expect(operatorHistory[0].scope.map(({ id }) => id)).toEqual(["north", "south", "west"]);
  });

  it("streams a Completed artifact only to its requester, and refuses it once the artifacts expire", async () => {
    const jobId = ((await json(await reports("", clientCookie))).jobs as Array<{ id: string; timeZone: string }>).find(({ timeZone }) => timeZone === "America/New_York")!.id;
    await completeWithArtifacts(jobId, ["pdf", "csv"]);

    const download = await reports(`/${jobId}/files/csv`, clientCookie);
    expect(download.status).toBe(200);
    expect(download.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(download.headers.get("content-length")).toBe(String(storedObjects.get(`reports/${jobId}/report.csv`)!.byteLength));
    expect(download.headers.get("content-disposition")).toMatch(/^attachment; filename="tracer-report-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(download.headers.get("cache-control")).toBe("private, no-store");
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(storedObjects.get(`reports/${jobId}/report.csv`));
    const history = (await json(await reports("", clientCookie))).jobs as Array<{ id: string; status: string; files: unknown; canRegenerate: boolean }>;
    expect(history.find(({ id }) => id === jobId)).toMatchObject({
      status: "Completed",
      files: [{ file: "pdf", downloadable: true, href: `/api/reports/${jobId}/files/pdf` }, { file: "csv", downloadable: true, href: `/api/reports/${jobId}/files/csv` }],
      canRegenerate: false,
    });

    const operatorCookie = await signIn("operator@example.com");
    for (const [path, cookie] of [[`/${jobId}/files/pdf`, operatorCookie], [`/${jobId}/files/zip`, clientCookie], [`/${jobId}/files/docx`, clientCookie], ["/missing-job/files/pdf", clientCookie]]) {
      const refused = await reports(path, cookie);
      expect([refused.status, await json(refused)]).toEqual([404, { error: "not_found" }]);
    }

    await pool!.query("update report_job set artifacts_expire_at = now() - interval '1 second' where id = $1", [jobId]);
    expect((await reports(`/${jobId}/files/pdf`, clientCookie)).status).toBe(404);
    const expired = (await json(await reports("", clientCookie))).jobs as Array<{ id: string }>;
    expect(expired.find(({ id }) => id === jobId)).toMatchObject({ files: [{ file: "pdf", downloadable: false, href: null }, { file: "csv", downloadable: false, href: null }], canRegenerate: true });
  });

  it("regenerates a Failed or expired job over its stored window rather than re-resolving the period now", async () => {
    const actor = await clientActor();
    const { job: failed } = await createReportJob(pool!, actor, createReadableWorkspaces(pool!, actor), { kind: "report", scope: { kind: "workspace", workspaceId: "north" }, period: { kind: "previousWeek" }, files: ["pdf"] }, new Date("2026-10-14T15:37:12.418Z"));
    expect(failed.parameters).toMatchObject({ window: { from: "2026-10-05", to: "2026-10-11" } });
    await failReportJob(pool!, failed.id, "Report generation failed");

    const regenerated = await reports(`/${failed.id}/regenerate`, clientCookie, { method: "POST" });
    expect(regenerated.status).toBe(201);
    const job = (await json(regenerated)).job as { id: string; status: string; scope: unknown; timeZone: string; parameters: unknown };
    expect(job).toMatchObject({
      status: "Queued",
      scope: [{ id: "north", name: "North Plumbing" }],
      timeZone: "America/New_York",
      parameters: { period: { kind: "custom", from: "2026-10-05", to: "2026-10-11" }, window: { from: "2026-10-05", to: "2026-10-11" }, files: ["pdf"] },
    });
    expect(job.id).not.toBe(failed.id);
    expect(generationRequests).toContain(job.id);

    const again = await reports(`/${failed.id}/regenerate`, clientCookie, { method: "POST" });
    expect(again.status).toBe(200);
    expect(((await json(again)).job as { id: string }).id).toBe(job.id);

    const queued = await reports(`/${job.id}/regenerate`, clientCookie, { method: "POST" });
    expect([queued.status, await json(queued)]).toEqual([409, { error: "not_regenerable" }]);
    const operatorCookie = await signIn("operator@example.com");
    for (const [path, cookie] of [[`/${failed.id}/regenerate`, operatorCookie], ["/missing-job/regenerate", clientCookie]]) {
      const refused = await reports(path, cookie, { method: "POST" });
      expect([refused.status, await json(refused)]).toEqual([404, { error: "not_found" }]);
    }
    const unconfigured = await reports(`/${failed.id}/regenerate`, clientCookie, { method: "POST", reportGeneration: null });
    expect([unconfigured.status, await json(unconfigured)]).toEqual([503, { error: "generation_unavailable" }]);
  });

  it("blocks the download and Regenerate of a job once its requester loses the Access Grant to a Workspace in its scope", async () => {
    const created = await reports("", clientCookie, { method: "POST", body: { kind: "report", scope: { kind: "global", workspaceIds: ["north", "south"], timeZone: "America/Chicago" }, period: { kind: "custom", from: "2026-10-01", to: "2026-10-10" }, files: ["pdf"] } });
    expect(created.status).toBe(201);
    const jobId = ((await json(created)).job as { id: string }).id;
    await completeWithArtifacts(jobId, ["pdf"]);
    expect((await reports(`/${jobId}/files/pdf`, clientCookie)).status).toBe(200);

    const operatorCookie = await signIn("operator@example.com");
    const clientId = (await clientActor()).userId;
    const revoked = await usersHandler()(new Request(`http://localhost:3000/api/users/${clientId}/access-grants/south`, { method: "DELETE", headers: { cookie: operatorCookie } }));
    expect(revoked.status).toBe(200);

    const refused = await reports(`/${jobId}/files/pdf`, clientCookie);
    expect([refused.status, await json(refused)]).toEqual([404, { error: "not_found" }]);
    const history = (await json(await reports("", clientCookie))).jobs as Array<{ id: string }>;
    expect(history.find(({ id }) => id === jobId)).toMatchObject({
      scope: [{ id: "north", name: "North Plumbing" }, { id: "south", name: null }],
      files: [{ file: "pdf", downloadable: false, href: null }],
      canRegenerate: false,
    });
    await pool!.query("update report_job set artifacts_expire_at = now() - interval '1 second' where id = $1", [jobId]);
    expect((await reports(`/${jobId}/regenerate`, clientCookie, { method: "POST" })).status).toBe(404);
  });

  it("scopes a global Calls export to the Workspaces of the Calls it matches, so only losing one of those blocks its download", async () => {
    const clientId = (await clientActor()).userId;
    const operatorCookie = await signIn("operator@example.com");
    for (const workspaceId of ["south", "west"]) {
      const granted = await usersHandler()(new Request(`http://localhost:3000/api/users/${clientId}/access-grants`, { method: "POST", headers: { cookie: operatorCookie, "content-type": "application/json" }, body: JSON.stringify({ workspaceId }) }));
      expect(granted.status).toBe(200);
    }
    const created = await reports("", clientCookie, { method: "POST", body: { kind: "call_export", scope: { kind: "global" }, query: "workspace=north", file: "csv" } });
    expect(created.status).toBe(201);
    const job = (await json(created)).job as { id: string; scope: unknown };
    expect(job.scope).toEqual([{ id: "north", name: "North Plumbing" }]);
    await completeWithArtifacts(job.id, ["csv"]);

    const revoke = async (workspaceId: string) => {
      const revoked = await usersHandler()(new Request(`http://localhost:3000/api/users/${clientId}/access-grants/${workspaceId}`, { method: "DELETE", headers: { cookie: operatorCookie } }));
      expect(revoked.status).toBe(200);
    };
    await revoke("south");
    expect((await reports(`/${job.id}/files/csv`, clientCookie)).status).toBe(200);
    await revoke("north");
    expect((await reports(`/${job.id}/files/csv`, clientCookie)).status).toBe(404);
  });
});
