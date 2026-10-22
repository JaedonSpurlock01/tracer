/**
 * -------------------------------------------------------------------------
 * @file   tracer-runtime.ts
 * @brief  Creates the request-scoped Tracer runtime.
 *
 * @description
 *  Resolves Cloudflare bindings, PostgreSQL, transactional email, Better
 *  Auth, the Recording processing port, and the private Recording bucket
 *  for server routes before closing the request-scoped pool.
 *
 * @remarks
 *  The runtime preserves the explicit non-production E2E email fake while
 *  keeping production provider requirements enforced. Recording processing
 *  triggers the Trigger.dev transfer task when TRIGGER_SECRET_KEY is set;
 *  without it accepted Recordings stay Pending for the recovery sweep. The
 *  transcription and Lead Assessment requests behind an Operator's Retry
 *  exist only with that key, so a Retry fails visibly instead of silently
 *  doing nothing. Report generation likewise exists only with that key, so
 *  a report or export request is refused before a job is recorded rather
 *  than left Queued with no run, except that the explicit non-production
 *  E2E Trigger.dev fake accepts the request so a browser journey can
 *  complete the job itself.
 *  The request pool gives up on a connection after 10 seconds and a
 *  query after 30, because neither node-postgres nor the Cloudflare socket
 *  adapter has a default timeout and a stalled Hyperdrive connection would
 *  otherwise hang the page indefinitely. Every request writes one
 *  tracer.request log line with its Cloudflare ray, duration, outcome,
 *  and database timing so a slow or failed page can be read back from
 *  Workers Logs instead of guessed at.
 *
 * @see
 *  data/tracer-auth.ts
 *  data/request-log.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { drizzle } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { headers } from "next/headers";
import { Pool } from "pg";

import { logRequest, observePool } from "@/data/request-log";

import { rememberE2eOtp } from "@/data/e2e-auth-fake";
import { schema } from "@/data/schema";
import { createTracerAuth, type TracerAuth } from "@/data/tracer-auth";
import { type ProviderConfiguration } from "@/data/provider-health";
import type { RecordingProcessing } from "@/data/recording";
import { createTriggerRecordingProcessing, recordingLeadAssessmentTaskId, recordingTranscriptionTaskId } from "@/data/recording-processing";
import { createRuntimeReportGeneration } from "@/data/report-generation-runtime";
import type { ReportGeneration } from "@/data/report-jobs";
import {
  createCloudflareTransactionalEmail,
  type SendEmail,
  type TransactionalEmail,
} from "@/data/transactional-email";

interface AuthBindings {
  HYPERDRIVE?: { connectionString: string };
  EMAIL?: SendEmail;
  TWILIO_CREDENTIAL_MASTER_KEY?: string;
  R2?: R2Bucket;
  R2_BUCKET?: string;
  OPENAI_API_KEY?: string;
  TRIGGER_SECRET_KEY?: string;
  AUTH_EMAIL_FROM?: string;
  AUTH_EMAIL_ALLOWED_RECIPIENTS?: string;
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  E2E_AUTH_FAKE?: string;
  NODE_ENV?: string;
}

export interface TracerRuntime {
  auth: TracerAuth;
  pool: Pool;
  database: NodePgDatabase<typeof schema>;
  email: TransactionalEmail;
  emailFrom: string;
  allowedRecipients: ReadonlySet<string>;
  masterKey: string | undefined;
  providerConfiguration: ProviderConfiguration;
  baseURL: string;
  backgroundTask: (promise: Promise<unknown>) => void;
  recordingProcessing: RecordingProcessing;
  recordingTranscription: RecordingProcessing | undefined;
  recordingLeadAssessment: RecordingProcessing | undefined;
  recordingBucket: R2Bucket | undefined;
  reportGeneration: ReportGeneration | undefined;
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

export function createRequestPool(connectionString: string): Pool {
  return new Pool({ connectionString, max: 1, connectionTimeoutMillis: 10_000, query_timeout: 30_000 });
}

/** The Cloudflare ray of the current request, or null outside one. */
async function currentRay(): Promise<string | null> {
  try {
    return (await headers()).get("cf-ray");
  } catch {
    return null;
  }
}

export async function withTracerRuntime<T>(run: (runtime: TracerRuntime) => Promise<T>): Promise<T> {
  const started = Date.now();
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
  const pool = createRequestPool(connectionString);
  const db = observePool(pool);
  let failure: unknown;

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
    const emailFrom = requiredBinding(bindings, "AUTH_EMAIL_FROM");
    const baseURL = requiredBinding(bindings, "BETTER_AUTH_URL");
    const allowed = allowedRecipients(bindings.AUTH_EMAIL_ALLOWED_RECIPIENTS ?? process.env.AUTH_EMAIL_ALLOWED_RECIPIENTS);
    const masterKey = bindings.TWILIO_CREDENTIAL_MASTER_KEY ?? process.env.TWILIO_CREDENTIAL_MASTER_KEY;
    const triggerSecretKey = bindings.TRIGGER_SECRET_KEY ?? process.env.TRIGGER_SECRET_KEY;
    const providerConfiguration: ProviderConfiguration = {
      twilioMasterKey: Boolean(masterKey),
      hyperdrive: Boolean(connectionString),
      email: Boolean(bindings.EMAIL) || fakeEnabled,
      emailFrom,
      emailAllowlistCount: allowed.size,
      r2: Boolean(bindings.R2),
      r2Bucket: bindings.R2_BUCKET ?? null,
      openai: Boolean(bindings.OPENAI_API_KEY ?? process.env.OPENAI_API_KEY),
      triggerdev: Boolean(triggerSecretKey),
    };
    const auth = createTracerAuth({
      database,
      email,
      emailFrom,
      allowedRecipients: allowed,
      secret: requiredBinding(bindings, "BETTER_AUTH_SECRET"),
      baseURL,
      backgroundTask: (promise) => ctx.waitUntil(promise),
    });
    return await run({
      auth,
      pool,
      database,
      email,
      emailFrom,
      allowedRecipients: allowed,
      masterKey,
      providerConfiguration,
      baseURL,
      backgroundTask: (promise) => ctx.waitUntil(promise),
      recordingProcessing: createTriggerRecordingProcessing({ secretKey: triggerSecretKey }),
      recordingTranscription: triggerSecretKey ? createTriggerRecordingProcessing({ secretKey: triggerSecretKey, taskId: recordingTranscriptionTaskId }) : undefined,
      recordingLeadAssessment: triggerSecretKey ? createTriggerRecordingProcessing({ secretKey: triggerSecretKey, taskId: recordingLeadAssessmentTaskId }) : undefined,
      recordingBucket: bindings.R2,
      reportGeneration: createRuntimeReportGeneration(triggerSecretKey),
    });
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    await pool.end().catch(() => undefined);
    logRequest({ ray: await currentRay(), durationMs: Date.now() - started, db, error: failure });
  }
}
