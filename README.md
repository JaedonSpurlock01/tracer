# Tracer

Tracer is Spurlock Labs' internal call-tracking platform for operating lead-generation phone numbers, measuring call performance, reviewing recordings and transcripts, estimating lead quality, and giving business clients read-only access to authorized Workspaces.

Tracer is designed to replace the core operational value of higher-cost call-tracking platforms while keeping per-number overhead low enough to scale horizontally.

## Documentation

- [Domain language and relationships](./CONTEXT.md)
- [Product, page, and brand design](./DESIGN.md)
- [Incremental implementation roadmap](./docs/IMPLEMENTATION_ROADMAP.md)
- [Data platform operations](./docs/DATA_PLATFORM.md)
- [Project-evolution Changelog](./docs/CHANGELOG.md)
- [Agent execution rules](./AGENTS.md)

## Product boundary

Tracer is not a public self-service SaaS in the first release.

- Spurlock Labs Operators create and configure Workspaces.
- Operators import numbers already owned by the Organization's Twilio account.
- Client Viewers are provisioned by Operators.
- Client Viewers receive read-only access through explicit Workspace Access Grants.
- Tracer does not sell, purchase, or release phone numbers.
- Tracer has no customer billing or subscription system.

## Organization model

The first release exposes one Organization: Spurlock Labs.

The Organization owns:

- Operators and Client Viewers
- Workspaces
- The Twilio connection
- Organization-scoped configuration

Better Auth's Organization plugin owns Organization membership and the two membership roles. Tracer owns Workspace Access Grants because Workspace authorization is a product-specific rule.

All tenant-owned database records carry an Organization identifier even though the first-release UI does not create or switch Organizations. A one-time bootstrap command creates the Spurlock Labs Organization and provisions the initial Operator. There is no public first-user or Organization registration flow.

## Roles

### Operator

An Operator has full Organization access and can:

- Provision and manage users
- Connect the Organization's Twilio account
- Create and configure Workspaces
- Attach and replace Tracking Numbers
- Build and publish Call Flows
- Review Calls and add Lead Reviews
- Generate reports and exports
- Purge retained call media
- Archive and restore Workspaces

### Client Viewer

A Client Viewer can:

- Open explicitly granted Workspaces
- View Calls, analytics, recordings, transcripts, and lead assessments
- See full caller phone numbers inside authorized Workspaces
- Generate reports
- Export retained recordings and CSV details

A Client Viewer cannot change routing, settings, users, integrations, Lead Reviews, or retention state.

## Core model

A Workspace is an Operator-defined operational container. It has:

- One Workspace State
- One reporting timezone
- One active Tracking Number assignment when Active
- One published Call Flow version when Active
- At most one editable Call Flow draft
- Calls, analytics, reports, and Access Grants

A Tracking Number may be replaced without replacing the Workspace. Every Call retains the exact Tracking Number and Flow Version used when it began.

See [CONTEXT.md](./CONTEXT.md) for canonical terms and relationships.

## First-release capabilities

The first release supports United States and Canadian Tracking and Destination Numbers. Phone numbers are stored canonically in E.164 format. Prompts, transcription, analysis, and interface copy are English only.

### Number and Workspace operations

- Import existing numbers from one Organization-level Twilio account
- Create Workspaces through a guided options wizard
- Configure one Destination Number through the Call Flow
- Preserve Twilio voice configuration before attachment
- Restore prior Twilio voice configuration on detach
- Replace a Tracking Number while preserving Workspace history
- Use Setup Required, Active, and Archived Workspace states

### Call Flow builder

Tracer uses React Flow for a constrained, versioned graph builder.

Supported nodes:

- Incoming Call
- Recording Disclosure
- Business Hours
- Keypad Gate
- Forward Call
- Whisper
- Voicemail
- Fixed Outcome nodes

Business Hours supports weekly windows and specific-date overrides in the Workspace timezone. Prompts use English text-to-speech. Voicemail is capped at 120 seconds, stops after 5 seconds of detectable silence, and allows `#` to finish. Recording disclosure uses the fixed sentence `This call may be recorded for quality purposes.`

Operators edit a draft and publish it atomically after validation. Existing Calls remain pinned to the Flow Version active at their start. The first release validates structure and configuration but does not simulate branches or place test calls.

### Call outcomes

Every completed Call has one final outcome:

- Answered
- Voicemail
- Missed
- Abandoned
- Blocked
- Failed

Twilio-specific statuses remain diagnostic metadata and map into this canonical taxonomy.

### Recording and media

- Recording of connected conversations is configurable per Workspace; voicemail capture does not depend on that setting because the caller chooses to leave a message.
- Disclosure is mandatory whenever recording is enabled.
- Connected calls use separate Caller and Business channels when Twilio provides them.
- Voicemail uses a caller-only channel.
- Cloudflare R2 is the durable private media authority.
- Twilio media is deleted only after a verified R2 copy exists.
- Call Detail provides an interactive, zoomable waveform with aligned speaker lanes.
- Trigger.dev generates waveform peak data with its Audio Waveform tooling.
- Both roles can play and export retained recordings within authorized Workspaces.

### Transcription and lead analysis

Automatic analysis has its own Workspace toggle and requires recording.

A Recording is eligible when:

- The Call passed any enabled spam gate, and
- It contains at least 15 seconds of connected talk time or captured voicemail speech

OpenAI is the initial provider for transcription and structured lead analysis.

Each Lead Assessment contains:

- Good Lead, Not Good Lead, or Uncertain
- Lead score from 0 to 100
- Concise summary
- Rationale
- Timestamp-linked evidence snippets

The AI result is immutable. An Operator may add a separate Lead Review with a classification and optional note. Lead Review takes reporting precedence while preserving the model output.

### Analytics and Activity

- Role-aware Home dashboard
- Total Calls, Answer Rate, Good Leads, and Average Connected Duration
- Total, Answered, and Good Lead trend lines
- Workspace performance comparison
- Recent Calls
- Expandable Activity timeline grouped by day
- 30-second Activity refresh while the browser tab is visible
- Global and Workspace-scoped Calls tables with server-side filters

### Reports and exports

Reports can cover one or more accessible Workspaces.

- Previous completed week, Monday through Sunday in the report timezone
- Previous completed month
- All Time
- Custom range
- Branded PDF summary
- Optional full-detail CSV
- Notable Good Leads in PDF
- Asynchronous MP3 ZIP exports with CSV manifest
- Seven-day generated-file retention
- Ninety-day job metadata retention

Exports use the current scope and filters rather than checkbox selection.

### Retention

- Call metadata and aggregate analytics remain indefinitely.
- Recording audio, waveform peaks, and Transcript content expire after 12 months.
- Operators may purge those media assets earlier.
- Early purge retains non-content Call metadata, Call Outcome, Lead Assessment fields that do not reproduce Transcript text, Lead Review, and aggregate analytics.
- Generated PDF, CSV, and ZIP files expire after 7 days.

## Page map

### Authentication

- Sign In
- Verify Email Code

### Global

- Home
- Activity at `/activity`: one expandable entry per Call in readable Workspaces, grouped by day in the user's timezone, covering the last 7 days with Load more, and read from `GET /api/activity`
- Calls
- Workspaces
- Reports
- Users, Operator only
- Account Settings
- Integrations, Operator only

### Workspace

- Overview
- Calls
- Flow, Operator only
- Reports
- Settings, Operator only

### Detail

- Call Detail

See [DESIGN.md](./DESIGN.md) for page composition, states, responsive behavior, ReUI patterns, and brand rules.

## Technology stack

### Application

- Next.js
- React
- TypeScript
- Tailwind CSS
- shadcn/ui
- ReUI
- React Flow
- Recharts through shadcn Chart

### Runtime and platform

- Cloudflare Workers through the supported Next.js adapter
- Cloudflare Workers Paid plan
- Cloudflare R2 for private object storage
- Cloudflare Email Service for transactional email
- Cloudflare Hyperdrive for PostgreSQL connection pooling

### Data and authentication

- Neon PostgreSQL
- Drizzle ORM
- `node-postgres` through Hyperdrive in the Worker runtime
- Better Auth
- Better Auth Organization plugin
- Better Auth Email OTP plugin with sign-up disabled
- Email verification code authentication for provisioned identities

Database migrations use a direct Neon connection outside the Worker runtime. Application queries use a dedicated least-privilege Hyperdrive role.

Staging and Production use separate Neon projects. Preview intentionally shares the Staging database while using its own Hyperdrive configuration; both non-production paths are unable to resolve Production data or bindings. Database changes use forward recovery, with Neon point-in-time or branch restore reserved for failed promotion recovery. The rationale is recorded in [ADR 0002](./docs/adr/0002-isolate-production-data-from-shared-non-production.md).

### Telephony, jobs, and AI

- Twilio Programmable Voice
- Trigger.dev Cloud
- Trigger.dev FFmpeg and Audio Waveform build extensions
- OpenAI transcription and structured analysis

### Testing

- Vitest for domain, application, contract, and component tests
- Cloudflare's Vitest plugin for code that depends on Worker bindings or `workerd` semantics
- React Testing Library for meaningful component behavior
- Testcontainers with PostgreSQL for persistence and migration integration tests
- Playwright for a small critical browser suite

## Local development

### Prerequisites

- Node.js 22
- pnpm 12.9.1 through Corepack
- A Docker-compatible daemon when running `test:integration` locally. With Podman, enable the user socket (`systemctl --user enable --now podman.socket`) and export `DOCKER_HOST=unix:///run/user/$(id -u)/podman/podman.sock` and `TESTCONTAINERS_RYUK_DISABLED=true`.
- A PostgreSQL instance at `127.0.0.1:5433/tracer_e2e` when running Playwright locally; Playwright applies migrations and bootstrap automatically. For example: `docker run -d --name tracer-postgres -p 5433:5432 -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=tracer_e2e docker.io/library/postgres:17-alpine`
- Chromium for Playwright through `pnpm exec playwright install chromium`

Enable the pinned package manager with `corepack enable`. If Windows prevents Corepack from writing its shim under the Node.js installation, use `npm install --global pnpm@12.9.1` instead.

### Setup

1. Run `pnpm install --frozen-lockfile`.
2. Run `pnpm dev`.
3. Apply migrations with `pnpm db:migrate` through `DATABASE_MIGRATION_URL`.
4. Bootstrap the initial Operator with `pnpm auth:bootstrap --email operator@example.com --name "Example Operator" --timezone America/Chicago`.
5. Configure non-production `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `AUTH_EMAIL_FROM`, and `AUTH_EMAIL_ALLOWED_RECIPIENTS` outside the repository. The Cloudflare bindings are named `HYPERDRIVE`, `EMAIL`, and `R2`.
6. Open `http://127.0.0.1:3000/sign-in` for passwordless email-code authentication. Without a Cloudflare `EMAIL` binding, run `pnpm dev:local` instead of `pnpm dev`; it applies pending migrations to the local `tracer` database on port 5433, then starts Next.js with `E2E_AUTH_FAKE=true`, so read the code from `http://127.0.0.1:3000/api/test/auth-otp`. This seam is disabled in production. Playwright also sets `E2E_TWILIO_FAKE=true` so Twilio number and voice-webhook operations stay in memory during the approved browser journeys; that seam is likewise disabled in production. After signing in, Operators manage other Operators at `http://127.0.0.1:3000/users` and connect the Organization Twilio account at `http://127.0.0.1:3000/integrations`. `dev:local` supplies a placeholder `TWILIO_CREDENTIAL_MASTER_KEY`; every deployed environment needs its own base64-encoded 32-byte value as a Cloudflare secret.
7. Request `http://127.0.0.1:3000/health` for the typed `{ "status": "ok" }` health response.

The Preview recipient allowlist is application-enforced. Empty or missing `AUTH_EMAIL_ALLOWED_RECIPIENTS` disables sends. Never commit values for authentication secrets or email configuration.

Local setup uses the commands above. The approved GitHub Actions database path uses the protected `Bootstrap Authentication` workflow, which verifies the branch before applying migrations, runtime grants, and idempotent bootstrap in the `tracer` Environment.

M1 requires no application runtime secrets. GitHub Actions secrets are authoritative for Preview deployment credentials. A local `.env` remains ignored and must never be committed; Worker tests and type generation exclude it, while Next.js development and builds may load it, so it must contain only non-production credentials.

### Cloudflare runtime

- `pnpm cf-typegen` regenerates ignored Worker runtime declarations from `wrangler.jsonc` without loading local environment variables.
- `pnpm preview` builds through OpenNext and starts a local `workerd` preview.
- OpenNext provides only best-effort Windows support. Use WSL, Linux, or the Linux GitHub Actions Preview job when Windows blocks adapter symlink creation.
- The architecture rationale is recorded in [ADR 0001](./docs/adr/0001-use-opennext-for-cloudflare-workers.md).

## Architecture

### Request path

1. A browser request reaches the Next.js application on Cloudflare Workers.
2. Better Auth verifies the session.
3. Server authorization verifies Organization membership, role, and Workspace Access Grant.
4. Drizzle queries Neon PostgreSQL through Hyperdrive.
5. Private R2 media is streamed only after current authorization succeeds.

### Inbound Call path

1. Twilio sends a signed voice webhook to Tracer.
2. The Cloudflare Worker validates the Twilio signature and active Number Assignment.
3. Tracer loads the published Flow Version pinned for the Call.
4. Tracer returns the constrained TwiML response for the current flow step.
5. Twilio status callbacks update the Call lifecycle idempotently.
6. Activity and analytics read from persisted Call state, not directly from Twilio.

Every lifecycle writer appends to the append-only `call_event` table in the same transaction as the state change it records: the voice and status webhooks append Call received, Spam gate passed or failed (only for a Flow Version with a Keypad Gate), Forwarding attempted, and Call completed with its canonical outcome; Recording transfer appends Recording transferred or Recording transfer failed with its stage, plus Transcript skipped with its reason; transcription and the Lead Assessment append their Completed and Failed events, the Lead Assessment with its classification and score; and each Lead Review add or update appends Lead Review added with its classification and reviewer, which keeps the review history the single `lead_review` row overwrites. Each event has an idempotency key unique per Organization that names a state transition, inserted with `on conflict do nothing`, so Twilio retries, task retries, Retry, and recovery sweeps never duplicate an event, a repeated failure of the same stage stays one Failed event, and a Failed stage that later succeeds keeps both events in order. A late Forward Call or voicemail result that corrects a Completed Call's outcome appends a second Call completed with the corrected outcome. Event detail holds only display-safe facts, never Transcript text, phone numbers, provider payloads, or failure messages. Transcript expiry is derived from the Call start time on read and is never written as an event. Migration `0016` backfills events for Calls that predate the table from their persisted state.

Webhook handlers persist accepted events before triggering follow-up work and respond quickly. They do not run transcription, media conversion, report generation, or other long work.

### Recording processing path

1. Twilio reports that a Recording is available.
2. Tracer verifies and persists the provider event.
3. Tracer triggers an idempotent Trigger.dev workflow.
4. Trigger.dev downloads the authorized Twilio Recording.
5. Trigger.dev uploads the Recording to private R2.
6. The workflow verifies the R2 object before deleting the Twilio copy.
7. Trigger.dev generates waveform peaks and stores them in R2.
8. If automatic analysis is enabled and eligibility passes, Trigger.dev requests an OpenAI Transcript.
9. Trigger.dev stores the normalized speaker and timestamp Transcript.
10. Trigger.dev requests and validates the structured Lead Assessment.
11. Each stage updates its own processing state in PostgreSQL.

A scheduled Trigger.dev sweep every 12 hours re-requests processing, with the same Recording-derived idempotency key, for Recordings created within the last 7 days whose transfer or Twilio cleanup has been idle for over an hour, and re-requests waveform generation, with its own Recording-derived idempotency key, for transferred Recordings in that window whose waveform has been Pending or Failed for over an hour.

Once a Recording is Stored, the transfer run requests the separate `recording-waveform` task; a failed request never affects the transfer or Twilio cleanup. The task reads the WAV from R2, runs `audiowaveform` at 50 pixels per second with 8-bit peaks, and stores one private JSON object beside the WAV at `<recording key without .wav>.peaks.json`, holding `version`, `sampleRate`, `samplesPerPixel`, `pixelsPerSecond`, `durationSeconds`, `lanes`, and `peaks` (one series of amplitudes from 0 to 1 per lane). A dual-channel Recording gets Caller and Business lanes, because Twilio records the caller's parent leg on the first channel and the dialed Business leg on the second; a single-channel Recording gets one Mixed lane. The Recording's waveform state moves from Pending to Stored or Failed. A rerun skips a Stored waveform whose object exists and otherwise overwrites the same key, and Recordings that are not Stored, or whose media expired 12 months after the Call started, are skipped without changing their Call or Recording metadata.

In the same transaction that records the Recording as Stored, Tracer decides analysis eligibility: the Workspace must have analysis enabled at that moment, the Call must have passed the pinned Keypad Gate when the Flow Version uses one, and the Recording needs at least 15 seconds of speech, measured by the forwarded leg's connected duration for a connected Recording and by the Recording duration for a voicemail, with a missing duration counting as too short. The Recording's Transcript state becomes Pending, or Skipped with the reason `analysis_disabled`, `spam_gate_not_passed`, or `too_short`; enabling analysis later never backfills an earlier Recording. After Stored is committed, a Pending Transcript sends one request to the `recording-transcription` task with its own Recording-derived idempotency key, and a failed request never affects the transfer or Twilio cleanup. The Transcript is stored in the `transcript` table as ordered Caller and Business turns with start and end milliseconds and text, deletable on purge or expiry without touching the Call. Each Recording has at most one Lead Assessment in `lead_assessment`, holding the classification, a score from 0 to 100, summary, rationale, model, token counts, cost, and processed time, which a database trigger refuses to update; its Transcript-derived evidence snippets live in `lead_assessment_evidence`, referencing Transcript turns by index and start time, so purge can delete them while the assessment remains. Each Call has at most one current Lead Review in `lead_review`, which an update overwrites with its reviewer and time. The Lead Assessment state becomes Pending only after the Transcript is Completed. Transcription drops segments Whisper likely invented on a silent channel, using Whisper's no-speech rule. An OpenAI rejection a retry cannot fix (HTTP 400, 401, 403, 404, 413, or 422) ends the Trigger.dev run after the stage is recorded Failed instead of spending its remaining attempts. The 12-hour recovery sweep also re-requests transcription for a Stored Recording whose Transcript is Pending or Failed and the Lead Assessment for a Completed Transcript whose Lead Assessment is Pending or Failed, with the same idempotency keys, idle window, and 7-day window. An Operator can request a failed stage again with `POST /api/workspaces/{workspaceId}/calls/{callId}/analysis/retry`: a Failed Transcript gets a transcription request, otherwise a Failed Lead Assessment gets a Lead Assessment request, answering 202 with the stage; anything else, including expired media, answers 409 `nothing_to_retry`, a failed Trigger.dev request answers 502 `provider_unavailable`, a Client Viewer gets 403, and an unreadable Workspace or Call gets the same Not Found as Call Detail.

Production processes Recordings in the Trigger.dev Production environment. Staging and Preview use the Trigger.dev Dev environment, whose runs execute only while `pnpm trigger:dev` runs the local CLI with the ignored `.env.trigger` file pointed at Staging resources; each trigger request sets a 7-day queue TTL so a Recording waits for the dev session. [docs/DATA_PLATFORM.md](./docs/DATA_PLATFORM.md) lists the per-environment secrets and variables.

Recording media is read only through `GET /api/workspaces/{workspaceId}/recordings/{recordingId}/audio`, which streams the Stored WAV from the `R2` binding with single-range support for seeking, and `GET /api/workspaces/{workspaceId}/recordings/{recordingId}/peaks`, which returns the Stored waveform peaks JSON. Both authorize the Workspace on every request, answer privately with `cache-control: private, no-store`, never reveal object keys, and answer the same Not Found for an unreadable Workspace, a Recording or waveform that is not Stored, a missing object, or Expired media. Recording media counts as Expired 12 months after the Call started; the Call, its facts, and the Recording metadata remain.

Call Detail lives at `/workspaces/{workspaceId}/calls/{callId}` and opens from global Calls at `/calls`, Workspace Calls at `/workspaces/{workspaceId}/calls`, and the five Recent Calls on Workspace Overview; `?play=1` starts the player once on open. Calls rows and row actions add the list's own URL as one `back` param (for example `?back=%2Fcalls%3Fsort%3DleadScore%26order%3Dasc`, with `play=1` kept beside it). The Call Detail page accepts `back` only when it normalizes to a same-origin `/calls` or `/workspaces/{thisWorkspaceId}/calls` path, rebuilds it from the parsed page, sort, search, flat filters, and `adv` tree so nothing else survives, and otherwise links back to Workspace Calls, so `back` is never an open redirect. Previous and Next Call in the header step through that same scoped, filtered, sorted list, computed on the server by the Calls query with `lag` and `lead` over its ordering and readable Workspace condition, so a neighbor is only an id and Workspace id the actor could already list; global neighbors link to their own Workspace route carrying the same `back`, a Call with no source walks its Workspace's Calls Started descending, and each step is disabled at the end of the list. Overview, Workspace Calls, Flow, and Workspace Settings render the Workspace tabs below their own header after their authorized Workspace read, and Call Detail renders none. Both Calls pages render the first page on the server and read `GET /api/calls`, optionally scoped by `workspaceId`, which returns 25 Calls per page in the actor's readable Workspaces with an allow-listed sort that defaults to Started descending, and answers Not Found for an unreadable Workspace. One filter query, kept in the URL and parsed strictly on the server (unknown or malformed values are dropped and every value is a bound SQL parameter), narrows the page and its matched count: `q` searches caller numbers by digits or Workspace names case-insensitively with LIKE wildcards escaped; `from` and `to` are calendar dates resolved in the user's timezone for global Calls and the Workspace reporting timezone for Workspace Calls, inclusive of the whole last day, and with neither the list covers all time; repeated `workspace` (global only), `outcome` (the six Call Outcomes or In Progress), `classification` (effective Lead classification with Lead Review precedence, or None), `recording` (Ready, Processing, Failed, Unavailable, or Expired, the same state each row shows), and `analysis` (Pending, Completed, Failed, Skipped, or Not applicable across the Transcript and Lead Assessment stages) select any of their values; and `scoreMin`, `scoreMax`, `durationMin`, and `durationMax` bound the Lead Score and connected seconds. These flat keys are joined by And; an advanced condition tree with And or Or groups travels in one `adv` param as JSON (`{"combinator":"or","rules":[{"field":"outcome","values":["Voicemail"]},{"combinator":"and","rules":[...]}]}`, with the same fields and value checks as the flat keys), is joined to them by And, and is rejected whole when malformed, deeper than three levels, larger than 20 conditions and groups, or over 4000 characters. Filters only add conditions beside the readable Workspace condition, and the tree compiles to one parenthesized expression joined by And outside it, so neither a Workspace filter outside the actor's grants nor an Or can reach an ungranted Workspace. The response's `hasCalls` says whether the unfiltered scope has any Calls, which separates the no-matches Empty state with `Clear Filters` from the No Calls state. The toolbar uses ReUI Filters: search, Started, Workspace, Call Outcome, and Effective Lead Classification in the chip row, and every filter in the advanced popover, whose Add group and And or Or combinators build the `adv` tree (a plain And of fields the chip row does not use still writes the flat keys); the chip row and popover are joined by And, Negate is refused, and any change returns to the first page. Its read model, also served as `GET /api/workspaces/{workspaceId}/calls/{callId}` and `GET /api/workspaces/{workspaceId}/calls` for Recent Calls, authorizes the Workspace through the same Workspace authorization as every other read, answers the same Not Found for anything unreadable, includes the Twilio call SID only for Operators, and never reads Recording SIDs or object keys. It derives the Destination Number from the pinned Flow Version's Forward Call step, connected duration from the forwarded leg's completed status, the spam-gate result from the pinned Keypad Gate and the persisted keypad input, Recording availability from the transfer and waveform states and the shared 12-month media expiry, and the processing timeline from accepted provider events, Recording, Transcript, and Lead Assessment states, and the Lead Review. For the selected Recording it returns `transcript` as Pending, Completed with speaker turns, Failed, Skipped with its reason, Expired, or Unavailable for a Call without a Recording or a Recording stored before analysis, and `leadAssessment` as Pending, Completed with its classification, score, summary, rationale, processing time, and evidence, Failed, or Unavailable; Transcript turns and evidence are withheld once media expires while the other Lead Assessment fields remain, and the secret-free failure reason of a Failed stage is sent only to Operators. The player streams the WAV through a media element so seeking uses Range requests, and wavesurfer.js draws the precomputed peaks: one instance renders Caller and Business as split channels so both lanes share one playhead, time scale, and zoom, and a single-channel Recording shows one `Mixed audio` lane. An accessible seek slider and shortcuts scoped to the player (Space or K, arrows for 5 seconds, J and L for 10 seconds, Home, End, M, plus, and minus) work without the waveform, so playback continues when peaks are missing.

Waveform generation and transcription may run concurrently after verified R2 storage. Lead Assessment depends on a completed Transcript. Each stage has its own retries and can be retried independently.

### Report and export path

1. Tracer authorizes and stores the requested scope and filters.
2. Trigger.dev creates the PDF, CSV, or MP3 ZIP asynchronously.
3. Output is written to private R2 with a seven-day expiry.
4. Tracer exposes completion in report history and the notification popover.
5. Every download rechecks current authorization before streaming the file.

## Reliability rules

- Verify every Twilio webhook signature.
- Treat callbacks and Trigger.dev runs as at-least-once delivery.
- Use provider-event and job-derived idempotency keys.
- Persist processing status per stage.
- Never delete the Twilio Recording before the R2 copy is verified.
- Never replace the active Flow Version when draft publication fails.
- Preserve failed jobs for Operator diagnosis and targeted retry.
- Apply concurrency limits to Twilio, OpenAI, R2, and report-generation queues.
- Keep user-facing failure states local to the affected page region.

## Testing strategy

Testing is part of implementation, not a cleanup phase. Agents and contributors follow red-green-refactor in vertical slices: one failing behavior test, the minimum implementation to pass it, then refactoring while green.

### Test principles

- Verify observable behavior through public interfaces.
- Name tests with the canonical language in [CONTEXT.md](./CONTEXT.md).
- Prefer integration-style domain tests that remain valid through internal refactors.
- Do not test private methods, implementation call order, or framework internals.
- Mock only external provider boundaries.
- Keep Trigger.dev task registration thin and test task behavior as ordinary functions.
- Use snapshots only as a supporting assertion, never as the primary proof of domain behavior.
- Every bug fix begins with a failing regression test.
- Documentation, copy, and pure visual-token changes do not require a new behavioral test, but still run applicable checks.
- Never weaken a valid test merely to make new code pass.

### Test layers

#### Domain behavior

Fast Vitest suites cover domain invariants without a database, network, browser, or provider credentials. These are the primary red-green-refactor loop.

#### Application integration

Vitest integration suites exercise public application services with real PostgreSQL through Testcontainers. They verify Drizzle queries, constraints, transactions, migrations, authorization boundaries, and idempotency. Reuse one PostgreSQL container per run and isolate tests with schemas or transaction rollback.

#### Provider contracts

Fixture-driven contract suites verify:

- Twilio webhook signature validation and payload mapping
- Twilio status and Recording callback idempotency
- OpenAI Transcript and Lead Assessment response validation
- Trigger.dev task payload and completion-event handling
- Cloudflare R2 and Email Service response mapping

Default tests use fakes at these provider boundaries. Separately tagged live smoke tests may call provider sandboxes or production-like test resources, but require explicit credentials and never run in the normal agent loop or required pull-request checks.

#### Worker and task integration

Cloudflare's Vitest Workers pool verifies code that requires Worker bindings or runtime semantics. Trigger.dev media, analysis, report, and retention workflows expose ordinary functions for tests, with task registration kept as a thin adapter.

#### Component behavior

React Testing Library covers components only when browser-independent interaction, accessibility, validation, or state behavior matters. It does not duplicate domain tests or assert implementation structure.

#### Browser journeys

The initial Playwright suite contains six critical journeys:

1. A provisioned user signs in with an email verification code.
2. An Operator creates and activates a Workspace through fake provider boundaries.
3. An Operator publishes a valid Call Flow and an invalid flow is rejected.
4. A simulated Twilio lifecycle produces Activity, Calls, and Call Detail data (`tests/e2e/simulated-call-lifecycle.spec.ts`, which also holds the responsive Calls, Activity, and Call Detail checks).
5. A Client Viewer opens a granted Workspace and is denied every ungranted Workspace.
6. An authorized user generates and downloads a report through a completed fake Trigger.dev job.

Add another browser test only when behavior truly crosses browser, route, and backend boundaries or when a browser-specific regression requires it.

### Domain behavior matrix

This matrix is the initial executable coverage contract. As tests are implemented, each row must link to or name its test suite. A domain is not complete while its documented invariants lack executable coverage.

| Domain | Required behavior coverage | Primary layer |
| --- | --- | --- |
| Organization and identity | Organization migration and repository persistence in `tests/integration/migrations.test.ts`; identity normalization and admission in `tests/domain/auth-policy.test.ts`; transactional email mapping in `tests/contracts/transactional-email.test.ts`; bootstrap uniqueness, generic provisioned-only sign-in, disabled sessions, first-sign-in activation, Organization deletion protection, and session revocation are covered in `tests/integration/authentication.test.ts`, with UI behavior in `tests/components/auth-pages.test.tsx` and the browser journey in `tests/e2e/provisioned-email-code-sign-in.spec.ts`; Operator role policy and last Active Operator protection in `tests/domain/auth-policy.test.ts`; Organization-scoped Operator administration, direct API authorization, provisioning, disablement with session revocation, and re-enablement in `tests/integration/operator-administration.test.ts` | Domain, contract, integration, component, and browser |
| Organization integrations | Credential encryption round trip and tamper rejection in `tests/domain/credential-encryption.test.ts`; E.164 normalization in `tests/domain/phone-number.test.ts`; disconnect dependency policy and Twilio SID validation in `tests/domain/integrations-policy.test.ts`; provider health states, including R2 by bucket name and R2 and Trigger.dev configured, healthy, and degraded from Recording transfer history, in `tests/domain/provider-health.test.ts`; Twilio REST authorization, payload mapping, pagination, and secret-free errors in `tests/contracts/twilio-client.test.ts`; Organization-scoped connect, verified rotation, verified and encrypted webhook Auth Token storage, failure recording, inventory sync and release, blocked disconnect, Hyperdrive and Email Service tests, and Organization-scoped Recording transfer health with no transfers yet, the last stored transfer, and the 5 most recent failures without object keys or Recording SIDs in `tests/integration/integrations.test.ts`; Integrations page states, secret-free rendering, the R2 bucket, and the R2 and Trigger.dev Recording transfer history and failure table in `tests/components/integrations-view.test.tsx` | Domain, contract, integration, and component |
| Workspace access | Grantable and readable Workspace States in `tests/domain/workspace-policy.test.ts`; role provisioning and safe role change decisions in `tests/domain/auth-policy.test.ts`; granted Workspace summaries in access instructions in `tests/contracts/transactional-email.test.ts`; atomic Client Viewer provisioning with its initial Access Grant, idempotent grants, Active-only new grants, last-grant protection, and safe role changes in `tests/integration/operator-administration.test.ts`; the `access_grant` table and runtime privileges in `tests/integration/migrations.test.ts`; Organization scope, granted Active and Archived reads, ungranted and dormant denials, Operator-only mutations, and revocation from an existing session, including for Recording audio streams, in `tests/integration/workspace-access.test.ts`; Users, Workspace Settings Access, and read-only Workspace views in `tests/components/app-shell.test.tsx`, `tests/components/workspace-settings-view.test.tsx`, `tests/components/workspaces-view.test.tsx`, and `tests/components/workspace-overview.test.tsx`; granted access, direct-route and API denial, and revocation in `tests/e2e/workspace-access-grants.spec.ts`; Call Detail and Recent Calls for an Operator and a Client Viewer with a current Access Grant, the Twilio call SID sent only to Operators and absent from the Client Viewer payload, no Recording SIDs or object keys in either payload, the same Not Found for an ungranted Workspace, another Workspace's path, another Organization, and a missing Call, a 401 for unauthenticated requests, and a revoked grant on an existing session in `tests/integration/call-detail.test.ts` | Domain, contract, integration, component, and browser |
| Workspace lifecycle | Name normalization, archive and restore transitions, and the setup checklist in `tests/domain/workspace-policy.test.ts`; Organization-scoped create, list, edit, archive without Twilio mutation, and restore in `tests/integration/workspaces.test.ts`; Active archive with Twilio restoration, restore-to-setup without reactivation, and Resume Setup after a detach writing a new Destination Number into the published Call Flow in `tests/integration/workspace-routing.test.ts`; Resume Setup keeping spam gate and whisper managed in the published Call Flow in `tests/components/workspaces-view.test.tsx`; Workspaces grid, wizard, Settings, and Overview states in `tests/components/workspaces-view.test.tsx`, `tests/components/workspace-settings-view.test.tsx`, and `tests/components/workspace-overview.test.tsx` | Domain, integration, and component |
| Number Assignment | Number fetch and voice-configuration update payloads in `tests/contracts/twilio-client.test.ts`; one active assignment per number and per Workspace, prior Twilio configuration snapshot before attachment, activation rollback on provider failure, activation refused without a webhook Auth Token, and archive restoration in `tests/integration/workspace-routing.test.ts`; Tracking Number replacement that ends the prior assignment as replaced, restores its Twilio configuration, and keeps historical Calls on the dialed number, replacement aborted with the current number kept on Twilio failure, refusal outside an Active Workspace, and Detach Number returning the Workspace to Setup Required, aborting on Twilio failure, and reactivating on another number in `tests/integration/workspace-routing.test.ts`; the Replace Number and Detach Number dialogs and one Workspace Settings page per section in `tests/components/workspace-settings-view.test.tsx`; browser activation journey and the Workspace Settings pages and Detach Number journey in `tests/e2e/workspace-activation-and-flow.spec.ts` | Domain, integration, contract, and browser |
| Call Flow | Graph validation, required disclosure, Business Hours branches, voicemail paths, and initial flow generation in `tests/domain/call-flow.test.ts`; React Flow adapter round trip in `tests/domain/flow-graph-adapter.test.ts`; saved invalid drafts, immutable published versions, publication failure preserving the active version, and the recording-disclosure guard in `tests/integration/workspace-routing.test.ts`; editor palette, inspector, branches, validation navigation, autosave, publish, discard, and version history in `tests/components/workspace-flow-editor.test.tsx`; valid publication and invalid rejection in `tests/e2e/workspace-activation-and-flow.spec.ts`; Business Hours evaluation at window boundaries, daylight saving transitions, 24:00 window ends, and date overrides, the Whisper-to-Forward Call rule, and the branch-labeled Flow summary in `tests/domain/call-flow.test.ts`; Business Hours timezone hint and 24:00 end selection, prompt character guidance, and browser Preview in `tests/components/workspace-flow-editor.test.tsx`; the Overview Flow summary in `tests/components/workspace-overview.test.tsx` | Domain, integration, component, and browser |
| Call lifecycle | Twilio webhook signature acceptance and rejection against Twilio's published example in `tests/contracts/twilio-signature.test.ts`; unsigned, forged, and tampered voice webhook rejection, one Call per CallSid pinned to the published Flow Version, duplicate voice delivery without a second Call or provider event, Answered, Missed, Failed, and Abandoned outcomes from the Forward Call status callback in either callback order, provisional Abandoned correction, pinned Flow Version after republication, replayed status callbacks leaving state unchanged, and the Staging call smoke report and signed replay in `tests/integration/twilio-webhooks.test.ts`; constrained TwiML for every first-release step, Business Hours Open and Closed paths in the Workspace timezone, Keypad Gate Pass, one replay, and Blocked without forwarding, Whisper on the business leg only, Voicemail limits, entry-path outcomes, and capture mapping, and Forward Call result mapping in `tests/domain/voice-response.test.ts`; Business Hours in the Workspace timezone, Keypad Gate hang-up, pass, and double failure, the Whisper request, Voicemail capture in any callback order, absent and failed captures, and replayed gate and recording callbacks leaving state unchanged in `tests/integration/twilio-webhooks.test.ts`; Gather, Dial, and recording status payload contracts in `tests/contracts/twilio-voice-callbacks.test.ts`; the `call` and `provider_event` tables, including the `recording_status` provider event kind, and runtime privileges in `tests/integration/migrations.test.ts`; signed callbacks, duplicate delivery, canonical Call Outcome mapping, lifecycle transitions | Domain, contract, and integration |
| Recording and media | Dual-channel Forward Call recording only when the Workspace records and the pinned Flow Version plays the Recording Disclosure first, including after a Keypad Gate, and never when recording is disabled in `tests/domain/voice-response.test.ts`; dual-channel Dial and caller-only voicemail recording status payloads mapped to a Recording, with absent and failed recordings producing none, in `tests/contracts/twilio-voice-callbacks.test.ts`; the recording-enabled Dial TwiML, signed connected Recording callback acceptance and unsigned or forged rejection, exactly one connected or voicemail Recording per completed callback regardless of the Workspace recording setting for voicemail, duplicate delivery without a second Recording or provider event, absent and failed recordings persisting only the provider event, no Recording or processing request for a completed voicemail shorter than 1 second, and one Recording processing request after commit with a Recording-derived idempotency key that cannot fail the callback or lose the Pending Recording in `tests/integration/twilio-webhooks.test.ts`; the `recording` table, its state and cleanup-after-storage constraints, its waveform columns and waveform state, Stored metadata, and requires-Stored constraints, the recovery sweep's partial indexes, and runtime privileges in `tests/integration/migrations.test.ts`; the Trigger.dev trigger request with its URL, Bearer authorization, Recording payload, idempotency key, and 7-day queue TTL, secret-free rejection on a non-success response or timeout, no request without a secret key, and the waveform task request with its own idempotency key in `tests/contracts/trigger-recording-processing.test.ts`; the Twilio Recording WAV download and DELETE requests, a Twilio 404 treated as already deleted, and secret-free errors in `tests/contracts/twilio-client.test.ts`; the signed R2 PUT with content type, payload hash, and SHA-256 checksum, the HEAD size and checksum read-back, the JSON waveform peaks PUT, the signed GET of stored bytes, missing objects, and secret-free errors in `tests/contracts/r2-objects.test.ts`; audiowaveform output normalized into Caller and Business lanes for dual-channel and one Mixed lane for single-channel Recordings, rejection of mismatched channels, and the audiowaveform CLI arguments and stable failure reason in `tests/contracts/audiowaveform.test.ts`; storage under the deterministic object key with verified size and checksum, Twilio deletion only after Stored is committed, download, upload, verification, and Stored-write failures persisting their stage and secret-free reason without ever deleting the Twilio copy, retry reusing a matching object or replacing a mismatched one at the same key and clearing the failure, a cleanup failure keeping the Recording Stored and retrying only cleanup, no-op runs for a deleted or missing Recording, a concurrent duplicate run refused while another run holds the Recording, and one waveform request with its Recording-derived idempotency key after Stored is committed, also when Twilio cleanup fails, never for a Recording that failed to store, and never failing the transfer or cleanup in `tests/integration/recording-transfer.test.ts`; waveform peaks stored beside the WAV with Caller and Business or Mixed lanes and the Stored waveform state, a no-op rerun when the Stored peaks object exists, regeneration when it is missing, generation, upload, and missing-WAV failures persisting Failed with a secret-free reason while leaving the transfer untouched, retry overwriting the same key and clearing the failure, and no-op runs for Recordings not Stored, missing, or with media expired 12 months after the Call started, keeping their Call and Recording metadata, in `tests/integration/recording-waveform.test.ts`; the recovery sweep re-requesting unfinished Recordings idle for over an hour with their Recording-derived idempotency key, re-requesting waveform generation for transferred Recordings with a Pending or Failed waveform, skipping fresh, older than 7 days, and fully processed Recordings, and continuing past a failed processing or waveform request in `tests/integration/recording-recovery.test.ts`; the Recording audio stream to an Operator and a Client Viewer with a current Access Grant as private uncached WAV without the object key, the same Not Found for ungranted, cross-Workspace-path, and cross-Organization requests, a revoked grant on an existing session, a Recording not yet Stored, and a missing object, a 401 for unauthenticated requests, single `Range` requests answered with 206, and unsatisfiable ranges with 416, the waveform peaks route serving private uncached JSON under the same authorization, Not Found answers, 401, and revocation, with Not Found for a Pending or Failed waveform and a missing peaks object, and both routes refusing Expired media 12 months after the Call started while keeping the Call and Recording and serving media before then in `tests/integration/workspace-access.test.ts`; full, ranged, unsatisfiable, and missing-object reads against a real R2 binding in `tests/workers/recording-audio.test.ts`; the `R2` binding to `tracer-recordings-production` for Production and `tracer-recordings-staging` for Staging and Preview in `tests/harness/environment-bindings.test.ts`; the Staging call smoke report of each Call's Recordings without object keys, Recording SIDs, or caller numbers and the signed connected Recording callback replay without a second Recording, provider event, or processing request in `tests/integration/twilio-webhooks.test.ts`; Call Detail Recording availability as Ready with Caller and Business or Mixed lanes, Ready without peaks when the waveform failed, Processing while the transfer or waveform is Pending, Failed without failure detail, Unavailable as disabled when the pinned Flow Version did not record or as not captured otherwise, and Expired 12 months after the Call started while the Call facts remain, the Destination Number from the pinned Forward Call step, connected duration from the forwarded leg, the spam-gate result from the pinned Keypad Gate and keypad input, and the processing timeline from accepted provider events and Recording transfer and waveform states in `tests/integration/call-detail.test.ts`; the waveform player over precomputed peaks and the streamed audio route with aligned Caller and Business lanes, the Mixed audio fallback, play and pause, elapsed and total time, the accessible seek slider, scoped keyboard shortcuts that leave typing alone, zoom, playback speed, volume and mute, reduced motion, playback without peaks, audio load Retry, and the processing, failed, unavailable, and expired states in `tests/components/recording-player.test.tsx`; opening Call Detail from Recent Calls after a simulated Twilio lifecycle and keyboard-driven playback, seek, and mute in `tests/e2e/call-detail-playback.spec.ts`; early purge | Domain, contract, task, integration, component, Worker, and browser |
| Transcript and assessment | Analysis eligibility from the Workspace analysis setting, the spam-gate result, and the 15-second threshold measured by connected talk time for connected Recordings and by Recording duration for voicemail in `tests/domain/analysis-eligibility.test.ts`; the transcription task request with its own idempotency key in `tests/contracts/trigger-recording-processing.test.ts`; the Transcript and Lead Assessment state columns, skip-reason, requires-Stored, and requires-Completed-Transcript constraints, Transcript turns as an array, the 0 to 100 score range, one Lead Assessment per Recording, the immutable Lead Assessment, deletable evidence and Transcript content that keep the Call and Lead Assessment, one overwritable Lead Review per Call, and runtime privileges in `tests/integration/migrations.test.ts`; eligibility decided once when the Recording is Stored, Skipped with its reason and no transcription request for disabled analysis, a failed Keypad Gate, and too-short connected or voicemail Recordings, exactly one request with the Recording-derived idempotency key after Pending is committed, the same key on a cleanup retry, no backfill when analysis is enabled later, and a failed request never failing the transfer or cleanup in `tests/integration/recording-transfer.test.ts`; reading the 16-bit PCM WAV, Caller from the first channel and Business from the second, a single-channel Recording as one Caller channel, the 3-hour cap, and chunks under the upload limit with their offsets in `tests/contracts/recording-wav.test.ts`; the whisper-1 English verbose_json segment request, segment parsing, the strict gpt-5-mini Responses request without storage, refusal and incomplete responses, and errors that never expose the API key, provider error body, Transcript text, or model output in `tests/contracts/openai-client.test.ts`; the Lead Assessment task request with its own idempotency key in `tests/contracts/trigger-recording-processing.test.ts`; normalized speaker turns ordered by start time with chunk offsets, empty text dropped, same-speaker segments merged across pauses under two seconds, turn validation, and whisper-1 cost in `tests/domain/transcript.test.ts`; the fixed prompt with the Workspace name and indexed timestamped turns, the strict schema, rejected classifications and scores, evidence that must quote its referenced turn and takes that turn's start time, and gpt-5-mini cost in `tests/domain/lead-assessment.test.ts`; Completed Transcript usage metadata that survives deleting the Transcript in `tests/integration/migrations.test.ts`; normalized turns from two channels, a voicemail's single Caller channel, the 3-hour cap in transcribed audio and billing, exactly one Lead Assessment request with its Recording-derived key after Completed, a failed request keeping the Transcript, Failed with a secret-free reason while transfer and waveform stay, retry from Failed, a missing, unsupported, or mismatched WAV, rerun after Completed as a no-op, and no OpenAI call for Skipped, not Stored, expired, or missing Recordings in `tests/integration/recording-transcription.test.ts`; the persisted assessment with usage, cost, and evidence linked to valid turns, an immutable assessment on rerun, invalid output and unlinked evidence as Failed without an assessment while the Transcript and playback stay, retry from Failed, secret-free reasons, and no OpenAI call without a Completed Transcript or for expired or missing Recordings in `tests/integration/recording-lead-assessment.test.ts`; segments Whisper likely invented on silence dropped by its no-speech rule while segments without no-speech scores stay in `tests/domain/transcript.test.ts`; no-speech scores parsed when present, and rate limits, server errors, unreachable OpenAI, and invalid responses retryable while HTTP 400, 401, 403, 404, 413, and 422 are not, in `tests/contracts/openai-client.test.ts`; the recovery sweep re-requesting transcription for Pending or Failed Transcripts and the Lead Assessment for Pending or Failed Lead Assessments with their Recording-derived keys, both a stalled waveform and Transcript for one Recording, skipping fresh and older than 7 days stages, and continuing past a failed request in `tests/integration/recording-recovery.test.ts`; the analysis recovery partial indexes in `tests/integration/migrations.test.ts`; Call Detail Transcript turns and the Lead Assessment with evidence for an Operator and a Client Viewer, Pending, Skipped with its reason, Failed with the failure reason for Operators only, Unavailable before analysis or without a Recording, Expired turns and evidence while the non-content Lead Assessment remains, the Transcript, Lead Assessment, and Lead Review timeline stages, and the Operator-only Retry requesting the failed stage with its Recording-derived key, 409 when nothing failed or media expired, 403 for a Client Viewer, the Call Detail Not Found, 401, and a secret-free 502 in `tests/integration/call-detail.test.ts`; the OpenAI Integrations card's configured models, last successful Transcript and Lead Assessment, and Organization-scoped failed analysis count without content in `tests/domain/provider-health.test.ts` and `tests/integration/integrations.test.ts`; Lead Review precedence; the Call Detail Transcript immediately below the player with timestamped Caller and Business turns that seek playback, the active turn during playback, follow mode that pauses after the user scrolls away with Resume Follow and reduced-motion scrolling, keyboard search with highlighted matches and a match count, the processing, failed, skipped, expired, and unavailable Transcript states with Retry only for Operators, the automated Lead Assessment with its score, summary, rationale, processing time, and evidence that seeks and emphasizes its turn, its isolated pending and failed states, the header classification labeled automated until a Lead Review exists, and the Lead Review as the reporting result directly above the Lead Assessment, read only for Client Viewers, with the Operator add and update form, classification and note-length validation, pending state, and refused-save message in `tests/components/call-detail-analysis.test.tsx`; the OpenAI Integrations card in `tests/components/integrations-view.test.tsx`; seeking from a Transcript turn and an evidence snippet, Transcript search, and a Lead Review that survives a reload in `tests/e2e/call-detail-playback.spec.ts` | Domain, contract, task, integration, component, and browser |
| Activity and analytics | The Calls page and allow-listed sort read from and written to the URL, with Started descending on the first page as the fallback for anything else, and the Calls filter query round-tripping through the URL with unknown, malformed, or out-of-range values dropped, in `tests/domain/call-list-query.test.ts`; global Calls covering every Organization Workspace for an Operator and only granted Workspaces for a Client Viewer, nothing from another Organization, a removed Access Grant hiding its Calls from an existing session, Workspace Calls fixed to one Workspace with the same Not Found for an ungranted, missing, or other-Organization Workspace, a 401 for unauthenticated reads, Started descending by default, canonical Call Outcomes with In Progress Calls, connected durations, Recording availability including Expired, the effective Lead classification with Lead Review precedence and the Lead Score, server pages of 25, allow-listed sorting in either direction, and the user timezone for global Calls and the Workspace timezone for Workspace Calls, each Calls filter narrowing the list, a Workspace filter never returning an ungranted or other-Organization Workspace's Calls, the effective classification filter using Lead Review precedence, Started date ranges resolved in the user's or Workspace's timezone through the whole last day, search by caller digits or Workspace name with LIKE wildcards escaped, Recording availability filters agreeing with row labels, analysis status across both stages, whether the unfiltered scope has Calls, and readable Workspace filter options in `tests/integration/calls.test.ts`; the Calls Data Grid columns in DESIGN order without the Workspace column in Workspace scope, disabled Export Recordings and Export CSV, the No Calls Empty state, a fetch error with Retry inside the grid, Play Recording only for a playable Recording, row selection opening Call Detail, sorting and paging kept in the URL with Skeleton rows only for client-side loads, the search box and basic and advanced filters editing one filter query that returns to the first page, and the no-matches Empty state with Clear Filters apart from the No Calls state in `tests/components/calls-view.test.tsx`; Play Recording starting the player on open in `tests/components/recording-player.test.tsx` and `tests/components/call-detail-view.test.tsx`; the append-only Call event log with Call received once under duplicate voice delivery, Forwarding attempted, Call completed with its outcome and a second event for a corrected outcome, and Spam gate passed, failed after the last attempt, and failed on hang-up in `tests/integration/twilio-webhooks.test.ts`, Recording transferred, Transcript skipped with its reason, one Recording transfer failed across repeated failures before a successful retry, and no event for a cleanup failure in `tests/integration/recording-transfer.test.ts`, one Transcript failed across retries followed by Transcript completed in `tests/integration/recording-transcription.test.ts`, one Lead Assessment failed followed by Lead Assessment completed with its classification and score in `tests/integration/recording-lead-assessment.test.ts`, one Lead Review added per add or update with its reviewer in `tests/integration/lead-review.test.ts`, SELECT and INSERT without UPDATE or DELETE for the runtime role in `tests/integration/migrations.test.ts`, and the idempotent backfill of pre-migration Calls in `tests/integration/call-event-backfill.test.ts`; the Activity filter subset and Load more cursors in `tests/domain/activity-query.test.ts`, and the Activity Call Detail source with its back link, caller-only search, and validation in `tests/domain/call-source.test.ts` and `tests/integration/calls.test.ts`; Activity covering every Organization Workspace for an Operator and only granted Workspaces for a Client Viewer with filters never widening that scope, a 401 for unauthenticated reads, one entry per Call however many Call events it has, steps in occurrence order with only the latest Call completed, Lead Review steps with classification and reviewer, Lead Review precedence for the effective classification, a neutral pending step for unfinished processing, a Transcript expired step derived once media expires, day grouping in the user's timezone, the default 7-day window starting at local midnight six days back, keyset Load more of 25 that new Calls never shift and that never repeats or skips tied start times, a refresh through the loaded window, caller-only search, and the processing state filter in `tests/integration/activity.test.ts`; Today, Yesterday, and calendar date labels, the entry header opening Call Detail with the Activity back context, expanded entries showing only occurred steps with one Badge each, the freshness label, the 30-second refresh running only while the document is visible and promptly on a stale return, refresh merging by Call id without duplicates, a refresh error keeping entries with Retry, Load more with its failure isolated to its region, the No Activity and No results states, and caller search in the URL in `tests/components/activity-view.test.tsx`; a simulated Twilio lifecycle of signed voice, Forward Call, Recording, and status callbacks producing one Activity entry under Today with Call received, Forwarding attempted, Call answered, and Recording processing, redelivered webhooks adding no entry or step after Refresh, the Calls row with its outcome, connected duration, and Processing Recording, a Call Outcome filter that keeps it, a non-matching outcome with Clear Filters, and Call Detail returning to the same filtered Calls URL, plus no horizontal page scroll, the Data Grid scrolling inside its Frame, the Sidebar Sheet below `md`, and reachable search, filter, paging, Refresh, Back to Calls, and Previous and Next Call controls on Calls, Workspace Calls, Activity, and Call Detail at 390px, 768px, and 1440px in `tests/e2e/simulated-call-lifecycle.spec.ts`; analytics ranges read from and written to the URL with malformed, reversed, pre-2000, and over-ten-year custom ranges falling back to 30 Days, equal prior windows, Monday-through-Sunday weeks, daily, weekly, and monthly trend intervals, and View Calls carrying the range as the Started filter in `tests/domain/analytics-range.test.ts`; exact Total Calls, Answer Rate over Calls with a Forwarding attempted event, Good Leads with Lead Review precedence in both directions, and Average Connected Duration over Answered Calls on fixed non-round fixtures, relative comparisons for counts and durations and percentage points for Answer Rate, no comparison for All Time and none against a zero prior, trend buckets in the user's or Workspace's timezone across local midnight and the Nov 1, 2026 DST fallback, Workspace performance withheld from single-Workspace scope, no ungranted or other-Organization data in any aggregate, Total Calls and Good Leads equal to the Calls list for the same scope and range, Workspaces list 30-day stats, Last Call, and webhook health from accepted voice webhooks on the current Tracking Number, the last successful inbound Call skipping a later Failed Call, and a readable Workspace list when its stats fail in `tests/integration/analytics.test.ts` and `tests/integration/workspaces.test.ts`; the KPI row with comparisons and dashes, the trend chart legend, tooltip, and hidden data table, Workspace performance shown only with fleet data, region errors with Retry that keep other regions, and the Workspaces list stat columns in `tests/components/analytics-panels.test.tsx`, `tests/components/home-dashboard.test.tsx`, `tests/components/workspace-overview.test.tsx`, and `tests/components/workspaces-view.test.tsx`; and Home and Workspace Overview with no horizontal page scroll, KPI columns of 1, 2, and 4, a visible legend, and reachable date range and View Calls at 390px, 768px, and 1440px in `tests/e2e/simulated-call-lifecycle.spec.ts` | Domain, integration, component, and browser |
| Reports and exports | Authorized scope, Monday-to-Sunday periods, CSV and PDF parameters, artifact expiry, revoked-download denial | Domain, task, integration, and browser |
| Background workflows | Idempotency keys, retries, partial failure, stage recovery, concurrency boundaries | Task and integration |
| User interface | Server-provided first data rendering without Skeletons for Workspaces (`tests/components/workspaces-view.test.tsx`), Users (`tests/components/app-shell.test.tsx`), Integrations (`tests/components/integrations-view.test.tsx`), and Workspace Settings Access (`tests/components/workspace-settings-view.test.tsx`), quiet background revalidation, Workspaces search, state, and page kept in the URL, and URL list-query parsing in `tests/domain/workspace-list-query.test.ts`; role-aware navigation, the top Sidebar account menu with the current Organization, DiceBear avatar, Account Settings, and Sign out, and user administration dialogs in `tests/components/app-shell.test.tsx`; the Call Detail header, Call facts with the Operator-only Twilio call SID, Recording and retention status, processing timeline, and no deferred actions in `tests/components/call-detail-view.test.tsx`; Workspace Overview Recent Calls rows linking to Call Detail and their Empty state in `tests/components/workspace-overview.test.tsx`; loading, empty, error, expired, and archived states; keyboard-accessible critical flows | Component and browser |

Code coverage is reported from the beginning as a regression signal. Percentage gates are introduced only after representative code establishes a trustworthy baseline. Coverage never replaces this behavior matrix.

### Layered verification

Use the narrowest useful check during development:

1. **Each behavior:** run one focused test and confirm RED for the expected reason.
2. **Green loop:** rerun that focused test until it passes.
3. **Before agent handoff:** run all affected tests, applicable integration or contract suites, incremental typecheck, and lint for changed files.
4. **Full boundary:** run all tests, full lint, typecheck, and production build before merge and after dependency, schema, migration, runtime-binding, build-configuration, or cross-cutting architecture changes.

Live smoke tests remain opt-in and are reported separately.

### Required script contract

Application scaffolding must provide these stable package scripts so agents do not invent verification commands:

- `test`
- `test:domain`
- `test:integration`
- `test:contracts`
- `test:workers`
- `test:tasks`
- `test:components`
- `test:e2e`
- `test:smoke`
- `typecheck`
- `lint`
- `build`
- `verify`
- `verify:full`

`test` runs the fast non-container Vitest projects. `verify` runs those fast tests, typecheck, and full lint without Testcontainers, Playwright, live smoke tests, or a production build. When persistence changed, run `test:integration` in addition to `verify`. `verify:full` runs every required non-live suite, full lint, typecheck, Playwright, and the production build. Focused Vitest paths remain the preferred inner-loop command.

`smoke:staging-call --tracking-number <E.164> [--limit 5] [--replay]` is the manual live check for the dedicated Staging Tracking Number. It prints the newest Calls with their state, Call Outcome, voicemail capture length, provider events, and Recordings (source, channels, transfer state, Twilio cleanup state, and failure stage) from the Staging database (`DATABASE_MIGRATION_URL`) and fails unless the newest Call is Completed. `--replay` resends that Call's stored Keypad Gate, Forward Call, voicemail recording, connected Recording, and status callbacks to the Staging Worker as freshly signed Twilio requests (`TWILIO_AUTH_TOKEN`) and fails unless the Call is unchanged. It never prints caller numbers, Recording object keys, or Recording SIDs.

`trigger:dev` runs the pinned Trigger.dev CLI in the Dev environment with `--env-file .env.trigger`, which is how Staging and Preview Recordings are processed.

### Build-speed policy

- Never run a production build after every red-green cycle.
- Run focused Vitest files or affected domain projects locally.
- Partition Vitest projects by domain, integration, contract, Worker, and component layers.
- Start Testcontainers only for persistence-related suites and reuse the PostgreSQL container within the run.
- Keep the six Playwright journeys out of the normal inner loop.
- Run independent CI checks in parallel.
- Cache package-manager data, Playwright browser binaries, TypeScript incremental state, and the Next.js build cache where safe.
- Keep live provider smoke tests on an explicit manual or scheduled path.

### Agent verification handoff

Every implementation handoff states:

- Tests added or changed, or why no behavioral test was required
- The expected failing test observed before implementation, when TDD applied
- Verification commands and outcomes
- Typecheck, lint, and build status
- Any check not run and the reason

An agent must not claim completion while a required check is failing. Pre-existing failures must be reported separately from failures introduced by the change.

## Security and privacy

- Dark-mode UI does not change security behavior.
- Every tenant-owned query is scoped to Organization.
- Every Client Viewer query is also scoped through current Access Grants.
- R2 buckets are private.
- Media and generated files require authenticated, authorized access.
- Recording audio streams only through the Workspace-authorized audio route; ungranted, revoked, cross-Organization, and not-yet-Stored Recordings return the same Not Found as an unreadable Workspace, and object keys are never logged or returned.
- Download URLs are short-lived and do not bypass current authorization.
- Twilio API key secrets are encrypted as Organization credentials with AES-256-GCM; the rationale is recorded in [ADR 0005](./docs/adr/0005-encrypt-organization-twilio-credentials.md).
- The Twilio encryption master key is the `TWILIO_CREDENTIAL_MASTER_KEY` Cloudflare deployment secret.
- R2, Hyperdrive, OpenAI, Trigger.dev, and Email Service credentials remain deployment secrets or bindings.
- Secrets, verification codes, Transcript content, and Recording URLs are never logged.
- Disabling a user revokes active sessions.
- Authentication responses do not reveal whether an email is provisioned.
- Destructive media purge requires explicit confirmation.

The fixed recording disclosure is a product safeguard, not a substitute for reviewing recording and privacy requirements in every jurisdiction where Tracking Numbers operate.

## Cost posture

Tracer favors variable usage costs and shared infrastructure over per-Workspace subscriptions.

Primary controls:

- Existing Twilio numbers are imported rather than purchased by Tracer.
- One Organization-level Twilio connection serves all Workspaces.
- R2 becomes the only durable Recording copy after verified transfer.
- R2 avoids media-download egress charges.
- Automatic analysis can be disabled per Workspace.
- Calls under the 15-second threshold skip paid transcription and analysis.
- Blocked and unconnected Calls skip analysis unless a qualifying voicemail exists.
- Recording and Transcript content expire after 12 months.
- Reports and exports expire after 7 days.
- Trigger.dev concurrency limits protect provider budgets.
- Cloudflare Email Service includes an initial outbound allowance on Workers Paid.
- Static lead-generation sites remain outside Tracer and continue using their existing Cloudflare hosting model.

Provider prices change. Validate current Twilio, Cloudflare, Neon, Trigger.dev, and OpenAI pricing before production rollout and monitor actual cost per connected Call and per Workspace.

## Explicitly out of scope

- Public customer sign-up
- Customer billing and subscriptions
- Customer-owned Twilio accounts
- Multiple Organizations in the UI
- Tracking or Destination Numbers outside the United States and Canada
- Non-English prompts, transcription, analysis, or localization
- Buying or releasing Twilio numbers
- Password authentication
- Arbitrary TwiML or custom code nodes
- Call Flow loops
- General IVR menus or multi-destination ring groups
- Uploaded prompt audio
- Flow simulation and real test calls
- Scheduled report emails
- Per-Workspace retention duration
- Configurable analysis-duration threshold
- Per-Access-Grant permissions
- Permanent Workspace deletion
- Security or configuration audit log in Activity

## Implementation roadmap

[docs/IMPLEMENTATION_ROADMAP.md](./docs/IMPLEMENTATION_ROADMAP.md) is the authoritative sequence from ideation through Production. It uses small vertical milestones with explicit dependencies, test-first behaviors, verification gates, environment targets, and exit criteria.

- Current milestone: M8 - Workspace Access Grants
- Next milestone: M9 - Minimal Inbound Call Tracer Bullet
- At most one milestone may be In Progress.
- Local, Preview, Staging, and Production are distinct promotion stages.
- Substantive roadmap and milestone changes are recorded in [docs/CHANGELOG.md](./docs/CHANGELOG.md).

Do not implement work that is absent from the roadmap. Add or change a milestone first, update every affected planning document, and record the substantive change under `Unreleased` in the Changelog.

## Repository status

M6 - Workspace Setup is Complete and merged to `main`. M7 - Call Flow Publication and Workspace Activation is In Progress on the `milestone/m7-call-flow-activation` branch.
