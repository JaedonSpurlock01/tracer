# Data platform operations

Tracer uses PostgreSQL 17, Drizzle migrations, Neon, and Cloudflare Hyperdrive. Migration connections are direct and exist only outside the Worker runtime. Application requests use the `tracer_app` role through Hyperdrive.

## Environment inventory

This inventory contains resource identifiers only. Credentials remain in GitHub Environment secrets, Neon, and Cloudflare.

| Path | Neon project | Neon branch | Hyperdrive | Worker | Object bindings |
| --- | --- | --- | --- | --- | --- |
| Local integration CI | Testcontainers PostgreSQL 17 | Ephemeral container | None | None | None |
| Preview | `shy-firefly-82384009` (`tracer-staging`) | `br-hidden-poetry-b7w8wc99` (`main`) | `36fd65b2679c4b739d224f1056b29070` (`tracer-preview`) | Pull-request Preview | None |
| Staging | `shy-firefly-82384009` (`tracer-staging`) | `br-hidden-poetry-b7w8wc99` (`main`) | `19a5d9e69d2a4a82b33c5d3f8cf2480f` (`tracer-staging`) | `tracer-staging` | None |
| Production | `cool-darkness-44273242` (`tracer-production`) | `br-winter-moon-b7xsmx9g` (`main`) | `c7bee152d6814904b4244700482815e2` (`tracer-production`) | `tracer`, not yet deployed to Production | `R2`: `tracer-recordings-production` |

Preview intentionally shares the Staging Neon project but uses a separate Hyperdrive configuration. Because Preview shares the Staging database, it also shares the Staging Recording bucket and Trigger.dev environment. Neither non-production configuration references the Production Neon project, Hyperdrive identifier, or Recording bucket.

## Roles and secrets

Each Neon project has two database roles:

- `tracer_migration` owns the `tracer` database and applies checked-in migrations through a direct connection.
- `tracer_app` can connect and use only the Better Auth, Organization, and `workspace` tables required by runtime authentication and Workspace management plus the `twilio_connection`, `twilio_number`, `number_assignment`, `call_flow_draft`, and `flow_version` integration tables and the `access_grant` table. Access Grants receive SELECT, INSERT, and DELETE but no UPDATE, because a grant is created or removed, never edited. The `call` table receives SELECT, INSERT, and UPDATE but no DELETE, because Calls advance through their lifecycle but are never removed by the application. The `provider_event` table receives only SELECT and INSERT, because accepted and rejected Twilio webhook events are an append-only diagnostic record. The `recording` table receives SELECT, INSERT, and UPDATE but no DELETE, because a Recording advances through its transfer, Twilio cleanup, and media cleanup states but is never removed by the application. The `transcript` and `lead_assessment_evidence` tables receive SELECT, INSERT, and DELETE but no UPDATE, because Transcript content and Transcript-derived evidence are written once and removed only by purge or expiry. The `lead_assessment` table receives SELECT and INSERT plus UPDATE on the `rationale` column alone, and a database trigger refuses any update except clearing the rationale, because a Lead Assessment is immutable apart from the media retention sweep removing its Transcript-derived rationale. The `lead_review` table receives SELECT, INSERT, and UPDATE but no DELETE, because a Call keeps one current Lead Review that an update overwrites. The `call_event` table receives only SELECT and INSERT, because the Call event log that Activity reads is append-only. The `report_job` table receives SELECT, INSERT, UPDATE, and DELETE, because a report or export job advances through its status and the lifecycle sweep deletes it after 90 days. The `report_artifact` table receives only SELECT and INSERT, because a generated file is recorded once and removed only by the cascade from its job, which runs with the table owner's privileges. It cannot create schema objects, delete users, or read the Drizzle migration journal. The migration role remains responsible for bootstrap and schema changes.

The `tracer` GitHub Environment stores non-production Cloudflare credentials, `DATABASE_MIGRATION_URL`, `DATABASE_RUNTIME_PASSWORD`, and `DATABASE_SMOKE_TOKEN`. The `Production` GitHub Environment stores separate Production values. Secret values must never be copied into repository files, logs, issues, or documentation.

## Authentication runtime bindings

The Worker uses the `HYPERDRIVE` binding for request-scoped PostgreSQL pools and the `EMAIL` send binding for Cloudflare Email Service. Wrangler environments and Previews do not inherit top-level bindings or secrets, so `env.staging` and `previews` each declare their own `EMAIL` binding and every environment needs its own copy of the secrets below (Previews through the Previews Base configuration or `wrangler preview secret put --name <preview>`). The following values are deployment secrets or environment configuration and must not be committed: `AUTH_EMAIL_FROM`, `AUTH_EMAIL_ALLOWED_RECIPIENTS`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, and `TWILIO_CREDENTIAL_MASTER_KEY`. The master key is a base64-encoded 32-byte value generated per environment (for example `openssl rand -base64 32`) and set with `wrangler secret put TWILIO_CREDENTIAL_MASTER_KEY --env ""` for the `tracer` Worker, `--env staging` for `tracer-staging`, and `wrangler preview base-config secret put TWILIO_CREDENTIAL_MASTER_KEY` for new pull-request Previews, which do not inherit the top-level Worker's secrets. Behind a TLS-inspecting proxy, export `NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt` so Wrangler trusts the system root store instead of disabling verification. Rotating the master key makes stored Twilio ciphertext unreadable, so reconnect Twilio through the Integrations page afterwards. The Integrations page also reports whether the `R2` binding, `OPENAI_API_KEY`, and `TRIGGER_SECRET_KEY` are present; `OPENAI_API_KEY` is not consumed until its milestone, and the `R2` binding and `TRIGGER_SECRET_KEY` are described under Recording media access and Recording processing runtime. An empty or missing `AUTH_EMAIL_ALLOWED_RECIPIENTS` value disables OTP sends. Preview uses a non-production sender and an allowlisted recipient configured outside the repository.

Run the initial bootstrap only through the migration connection:

```text
pnpm auth:bootstrap --email operator@example.com --name "Example Operator" --timezone America/Chicago
```

The command requires `DATABASE_MIGRATION_URL` and prints only status and opaque identifiers. Run migrations before bootstrap. Local and Preview authentication requires the non-production secret and binding configuration above; live Preview Email Service sender and recipient validation remains an external gate. For the approved GitHub Actions database path, run the protected `Bootstrap Authentication` workflow from the approved branch, provide the initial Operator email, display name, and IANA timezone inputs, and approve the `tracer` Environment. The workflow verifies the code before applying idempotent migrations, runtime grants, and bootstrap.

## Recording media access

The Worker reads Recording audio only through the `R2` R2 bucket binding. Each environment declares its own binding and its own `R2_BUCKET` variable naming the bound bucket, which the Integrations page shows: the top-level `tracer` Worker binds `tracer-recordings-production`, and `env.staging` and `previews` bind `tracer-recordings-staging`. Both buckets are private, with no public or `r2.dev` access, and Tracer never issues presigned or public object URLs.

`GET /api/workspaces/{workspaceId}/recordings/{recordingId}/audio`, `GET /api/workspaces/{workspaceId}/recordings/{recordingId}/peaks`, and `GET /api/workspaces/{workspaceId}/recordings/{recordingId}/mp3` are the only read paths for Recording media. On every request they require an Active session, authorize the Workspace through `data/workspace-authorization.ts` (an Operator of the Workspace's Organization, or a Client Viewer holding a current Access Grant to an Active or Archived Workspace), and then load the Recording through `data/recording-media.ts`, scoped to that Organization and Workspace with `transfer_state` `Stored` and media that has not Expired. Recording media counts as Expired 12 months after the Call's `started_at`; `data/recording-media.ts` owns that rule for both routes and for waveform generation, and no row is changed or deleted when media expires. An unauthenticated request receives `401`. An ungranted, revoked, cross-Organization, not-yet-Stored, Expired, or missing-object request, and a peaks request whose `waveform_state` is not `Stored`, receives the same `404` `not_found` response as any other unreadable Workspace, so Recordings cannot be discovered; Call Detail reads availability from its own server-side data rather than from these status codes. The audio route streams `audio/wav` with `cache-control: private, no-store` and honors one HTTP `Range` per request with `206` and `Content-Range`, or `416` when the range is unsatisfiable. The peaks route returns the stored peaks object as `application/json` with `cache-control: private, no-store`. The MP3 route also requires `mp3_state` `Stored` and streams `audio/mpeg` as an attachment named `tracer-call-{callId}.mp3`, with `cache-control: private, no-store`. Object keys are never logged or returned.

## Recording processing runtime

Recording transfer runs in Trigger.dev Cloud project `proj_tdulgcojxncuxbsettnq`, configured by `trigger.config.ts` with tasks in `trigger/`. The Worker does not import the Trigger.dev SDK; it triggers the `recording-transfer` task through the Trigger.dev REST API with the `TRIGGER_SECRET_KEY` Worker secret, and the key selects the Trigger.dev environment. Without the secret the Worker still accepts Recording callbacks and leaves each Recording Pending. Each trigger request sets a 7-day queue TTL, matching the recovery sweep window, so a queued run waits instead of expiring after the Trigger.dev Dev environment's 10-minute default.

| Tracer environment | Trigger.dev environment | `TRIGGER_SECRET_KEY` | Task environment variables |
| --- | --- | --- | --- |
| Preview | Dev | The Dev environment's secret key | The local `.env.trigger` file |
| Staging | Dev | The Dev environment's secret key | The local `.env.trigger` file |
| Production | Production | A Production secret key | The Trigger.dev dashboard Environment Variables page, or `pnpm exec trigger env set --env prod --secret <name> <value>` |

Tracer Staging and Preview use the Trigger.dev Dev environment because additional Trigger.dev environments require a paid plan. Dev runs execute only while `pnpm trigger:dev` is running on a developer machine; it starts the pinned Trigger.dev CLI with `--env-file .env.trigger`. The `.env.trigger` file is ignored by Git and must point at the Staging database through the runtime role, the Staging Twilio master key, and the `tracer-recordings-staging` bucket token. While no dev session runs, Staging and Preview Recordings stay queued for up to 7 days, and the 12-hour recovery sweep, which also fires only while the dev session runs, re-requests any that remain Pending or Failed. Set the Worker secret with `wrangler secret put TRIGGER_SECRET_KEY --env ""` for the `tracer` Worker using a Production key, and with `--env staging` for `tracer-staging` and `wrangler preview base-config secret put TRIGGER_SECRET_KEY` for Previews using the Dev environment's secret key, each taken from the Trigger.dev API Keys page of the matching environment.

The tasks run outside the Worker bindings, so each Trigger.dev environment needs these environment variables, never committed:

- `DATABASE_URL`: a Neon connection string for the `tracer_app` runtime role in the environment's Neon project. The transfer task reads `recording`, `twilio_connection`, and, to decide analysis eligibility, `workspace`, `call`, `flow_version`, and `provider_event`, and updates `recording`, the `recording-waveform` task reads `recording` and `call` and updates `recording`, the `recording-transcription` task reads `recording` and `call`, inserts into `transcript`, and updates `recording`, and the `recording-lead-assessment` task reads `recording`, `call`, `workspace`, and `transcript`, inserts into `lead_assessment` and `lead_assessment_evidence`, and updates `recording`; the transfer, transcription, and Lead Assessment tasks also insert into `call_event`, all covered by the runtime grants.
- `TWILIO_CREDENTIAL_MASTER_KEY`: the same master key as the environment's Worker, used to decrypt the Organization Twilio API key secret.
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`: an R2 API token with Object Read and Write scoped to the environment's bucket only.
- `R2_BUCKET`: `tracer-recordings-staging` for the Dev environment that serves Staging and Preview, and `tracer-recordings-production` for Production.
- `OPENAI_API_KEY`: an OpenAI project API key used by the `recording-transcription` and `recording-lead-assessment` tasks. Without it the task throws before reading the Recording, so the Transcript or Lead Assessment keeps its Pending or Failed state for a later retry. The tasks never log the key, Transcript content, prompts, or model output.

The `recording-recovery-sweep` scheduled task runs every 12 hours and re-requests processing, waveform generation, transcription for a Stored Recording whose Transcript is Pending or Failed, and the Lead Assessment for a Completed Transcript whose Lead Assessment is Pending or Failed, through the same REST API with the same Recording-derived idempotency keys, so it also needs `TRIGGER_SECRET_KEY` in its run environment. It selects Recordings idle for over an hour and created within the last 7 days in one bounded query over partial indexes on each unfinished stage. The transfer task requests the `recording-waveform` task through the same REST API once a Recording is Stored; without `TRIGGER_SECRET_KEY` it skips that request and the waveform stays Pending for the sweep. It requests the `recording-transcription` task the same way for an analysis-eligible Recording, and a skipped or failed request leaves the Transcript Pending. The `recording-transcription` task splits the stored WAV into Caller and Business mono chunks of at most 20 minutes, transcribes only the first 3 hours with `whisper-1`, and commits the Transcript, its Completed state, the transcribed audio milliseconds and estimated cost on the `recording` row (`transcript_audio_ms`, `transcript_cost_usd`, `transcript_completed_at`, kept when purge deletes the Transcript), and a Pending Lead Assessment together; it then requests the `recording-lead-assessment` task with the idempotency key `recording-lead-assessment:<recordingId>`, ignoring a failed request. The Lead Assessment task asks `gpt-5-mini` for strict structured output with `store` disabled and commits the immutable assessment with its token counts and cost and its evidence together. Both tasks hold the Recording row lock only to commit, never during OpenAI calls, record failures as Failed with a secret-free reason, never touch transfer or waveform state, and run at most five at a time; transcription allows up to one hour per attempt and runs on the `small-2x` machine (1 GB) so a 3-hour dual-channel Recording's roughly 345 MB WAV and its mono chunks fit in memory. Transcription drops segments Whisper likely invented on silence, using its no-speech rule (no-speech probability above 0.6 and average log probability below -1). An OpenAI rejection a retry cannot fix (HTTP 400, 401, 403, 404, 413, or 422) aborts the run after the stage is recorded Failed instead of spending the remaining attempts; rate limits, server errors, and timeouts retry. An Operator can request a failed Transcript or Lead Assessment again with `POST /api/workspaces/{workspaceId}/calls/{callId}/analysis/retry`, which the Worker sends through the same REST API and idempotency keys; without the `TRIGGER_SECRET_KEY` Worker secret the Retry answers 502 rather than silently doing nothing.

The `recording-waveform` task runs the BBC `audiowaveform` CLI. The Audio Waveform build extension in `trigger.config.ts` installs it in deployed Production images only, so the developer machine running `pnpm trigger:dev` for Staging and Preview must have `audiowaveform` on its PATH; without it each waveform run is recorded as Failed and retried by the sweep. Deploy Production tasks with the Trigger.dev CLI only through an approved deployment step.

The `recording-mp3` task runs `ffmpeg`, which the ffmpeg build extension installs in deployed images only, so the machine running `pnpm trigger:dev` also needs `ffmpeg` on its PATH. The transfer task requests it once a Recording is Stored, with the idempotency key `recording-mp3:<recordingId>`, and it writes a 64 kbps MP3 beside the WAV under the same key with `.mp3`, verifying size and checksum before recording `mp3_state` `Stored`. The recovery sweep also requests it for any Stored, unexpired Recording whose MP3 is Pending at any age, which backfills Recordings Stored before M16, or Failed within 7 days.

The `media-retention-sweep` scheduled task runs daily at 08:29 UTC and, at most 100 per run, deletes the Transcript, Lead Assessment evidence quotes and rationale, and WAV, waveform peaks, and MP3 objects of Stored Recordings whose media expired 12 months after their Call started or was purged, recording `media_deleted_at` only after every delete succeeded so a failed delete is retried on the next run. It selects through the partial index `recording_media_undeleted_created_at_idx` and needs `DATABASE_URL` and the `R2_*` variables above.

## Report artifacts

The `report-generation` task builds PDF, CSV, and Recording ZIP files for `report_job` rows. The Worker requests it through the same REST API with the idempotency key `report-generation:<jobId>`; without the `TRIGGER_SECRET_KEY` Worker secret, `POST /api/reports` answers 503 `generation_unavailable` before inserting a job. The task reads `report_job`, `call`, `recording`, `workspace`, `transcript`, `lead_assessment`, and `lead_review`, updates `report_job`, and inserts into `report_artifact`. It writes to the environment's existing bucket under `reports/{jobId}/` (`report.pdf`, `calls.csv`, `recordings.zip`), uploading the ZIP in 8 MiB multipart parts with the same object token, and allows one hour per attempt on the `small-2x` machine. `@react-pdf/renderer` and `react` stay external to the task bundle because pdfkit loads its font metrics through package-internal imports, and the Geist font files are copied into the image from the `geist` package. Downloads stream through `GET /api/reports/{jobId}/files/{pdf|csv|zip}`, which rechecks on every request that the actor requested the job, that its files have not expired, and that the actor can still read every Workspace in its scope; every refusal is `404` `not_found`.

The `report-artifacts` R2 lifecycle rule deletes objects under `reports/` 7 days after upload and aborts their incomplete multipart uploads after 1 day, alongside Cloudflare's default multipart abort rule. It is applied to `tracer-recordings-staging`. `scripts/configure-report-lifecycle.ts <bucket>` prints the rule and, with `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` set, the planned change; `--apply` writes it, keeping every other rule and reporting an identical rule as already configured. It needs a token with R2 bucket settings edit permission, not the tasks' object token. The `report-lifecycle-sweep` scheduled task runs every 6 hours, marks jobs still Queued or Generating 6 hours after their request as Failed, and, at most 100 per run, deletes jobs past their 90-day metadata expiry after a best-effort delete of their R2 objects; it needs `DATABASE_URL` and the `R2_*` variables above.

## Migration path

1. Change `data/schema.ts`.
2. Run `pnpm db:generate` and review the generated SQL and metadata.
3. Run `pnpm test:integration` against a clean Testcontainers PostgreSQL 17 database in GitHub Actions.
4. Apply the migration to Staging with `pnpm db:migrate` through the `tracer` GitHub Environment.
5. Apply runtime grants with `pnpm db:grant-runtime` through the approved GitHub Environment before deploying to Staging. Rerun it whenever a migration adds tables the runtime role must reach, as the M5 integration tables, the M11 `recording` table, and the M14 `call_event` table did.
6. Run the `Verification` workflow manually. Its Staging gate reapplies migrations as a no-op, deploys `tracer-staging`, and performs the protected transactional read/write smoke check through Hyperdrive.
7. Before Production promotion, run `verify:full`, review the SQL, rehearse it in Staging, and apply it through the `Production` GitHub Environment.

The current Windows environment cannot run Docker, so Testcontainers integration suites run on GitHub Actions. Other Local environments may run `pnpm test:integration` when a Docker-compatible daemon is available.

## Forward recovery

Migrations are forward-only. Tracer does not maintain hand-written down migrations.

Migration `0016_volatile_micromax` adds the `call_event` table, backfills events for existing Calls from their persisted state, and adds the `call_organization_started_at_idx` index. Its backfill is idempotent through the same keys the writers use, and failures without a persisted timestamp use the Recording's `updated_at` and are marked `{"backfilled": true}`. Nothing else depends on `call_event`, so if it must be withdrawn, a corrective migration drops the table (and, if wanted, the index) and the writers' inserts are removed in the same change.

When a migration fails before commit:

1. Stop promotion and keep the affected milestone or deployment blocked.
2. Diagnose the failed SQL without editing an already-applied migration.
3. Generate a new corrective migration.
4. Prove the correction against a clean Testcontainers database and Staging.
5. Resume promotion only after the normal verification gate passes.

When an applied migration causes data corruption:

1. Stop writes and promotion for the affected environment.
2. Preserve the failed database for diagnosis.
3. Restore the Neon project to a point-in-time or recovery branch from before the migration.
4. Validate schema, Organization reads, and Organization writes through an isolated Hyperdrive configuration.
5. Switch the affected environment binding only after validation.
6. Record a Staging or Production promotion, rollback, or recovery in `docs/CHANGELOG.md`.

Production restore or binding changes are destructive operational actions and require explicit approval at execution time.
