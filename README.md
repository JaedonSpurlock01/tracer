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

- Recording is configurable per Workspace.
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
- Activity
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
5. Configure non-production `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `AUTH_EMAIL_FROM`, and `AUTH_EMAIL_ALLOWED_RECIPIENTS` outside the repository. The Cloudflare bindings are named `HYPERDRIVE` and `EMAIL`.
6. Open `http://127.0.0.1:3000/sign-in` for passwordless email-code authentication. Without a Cloudflare `EMAIL` binding, run `pnpm dev:local` instead of `pnpm dev`; it targets the local `tracer` database on port 5433 with `E2E_AUTH_FAKE=true`, so read the code from `http://127.0.0.1:3000/api/test/auth-otp`. This seam is disabled in production. After signing in, Operators manage other Operators at `http://127.0.0.1:3000/users` and connect the Organization Twilio account at `http://127.0.0.1:3000/integrations`. `dev:local` supplies a placeholder `TWILIO_CREDENTIAL_MASTER_KEY`; every deployed environment needs its own base64-encoded 32-byte value as a Cloudflare secret.
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
4. A simulated Twilio lifecycle produces Activity, Calls, and Call Detail data.
5. A Client Viewer opens a granted Workspace and is denied every ungranted Workspace.
6. An authorized user generates and downloads a report through a completed fake Trigger.dev job.

Add another browser test only when behavior truly crosses browser, route, and backend boundaries or when a browser-specific regression requires it.

### Domain behavior matrix

This matrix is the initial executable coverage contract. As tests are implemented, each row must link to or name its test suite. A domain is not complete while its documented invariants lack executable coverage.

| Domain | Required behavior coverage | Primary layer |
| --- | --- | --- |
| Organization and identity | Organization migration and repository persistence in `tests/integration/migrations.test.ts`; identity normalization and admission in `tests/domain/auth-policy.test.ts`; transactional email mapping in `tests/contracts/transactional-email.test.ts`; bootstrap uniqueness, generic provisioned-only sign-in, disabled sessions, first-sign-in activation, Organization deletion protection, and session revocation are covered in `tests/integration/authentication.test.ts`, with UI behavior in `tests/components/auth-pages.test.tsx` and the browser journey in `tests/e2e/provisioned-email-code-sign-in.spec.ts`; Operator role policy and last Active Operator protection in `tests/domain/auth-policy.test.ts`; Organization-scoped Operator administration, direct API authorization, provisioning, disablement with session revocation, and re-enablement in `tests/integration/operator-administration.test.ts` | Domain, contract, integration, component, and browser |
| Organization integrations | Credential encryption round trip and tamper rejection in `tests/domain/credential-encryption.test.ts`; E.164 normalization in `tests/domain/phone-number.test.ts`; disconnect dependency policy and Twilio SID validation in `tests/domain/integrations-policy.test.ts`; provider health states in `tests/domain/provider-health.test.ts`; Twilio REST authorization, payload mapping, pagination, and secret-free errors in `tests/contracts/twilio-client.test.ts`; Organization-scoped connect, verified rotation, failure recording, inventory sync and release, blocked disconnect, and Hyperdrive and Email Service tests in `tests/integration/integrations.test.ts`; Integrations page states and secret-free rendering in `tests/components/integrations-view.test.tsx` | Domain, contract, integration, and component |
| Workspace access | Direct Access Grants, Organization scope, granted reads, ungranted denials, immediate revocation | Domain, integration, and browser |
| Workspace lifecycle | Setup Required, Active, Archived, restore to setup, archive history preservation | Domain and integration |
| Number Assignment | One active assignment, prior Twilio configuration restoration, replacement history, number uniqueness | Domain, integration, and contract |
| Call Flow | Graph validation, required disclosure, Business Hours branches, voicemail paths, immutable publication, Flow Version pinning | Domain and browser |
| Call lifecycle | Signed callbacks, duplicate delivery, canonical Call Outcome mapping, lifecycle transitions | Domain, contract, and integration |
| Recording and media | Verified R2 copy before Twilio deletion, dual-channel metadata, waveform state, retention, early purge | Domain, task, and integration |
| Transcript and assessment | Eligibility threshold, analysis toggle, normalized speakers, immutable Lead Assessment, Lead Review precedence | Domain, contract, and task |
| Activity and analytics | Workspace scope, effective classifications, canonical outcomes, timezone boundaries, aggregate definitions | Domain and integration |
| Reports and exports | Authorized scope, Monday-to-Sunday periods, CSV and PDF parameters, artifact expiry, revoked-download denial | Domain, task, integration, and browser |
| Background workflows | Idempotency keys, retries, partial failure, stage recovery, concurrency boundaries | Task and integration |
| User interface | Role-aware navigation and Operator administration dialogs in `tests/components/app-shell.test.tsx`; loading, empty, error, expired, and archived states; keyboard-accessible critical flows | Component and browser |

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

- Current milestone: M5 - Organization Integrations and Twilio Connection, In Progress
- Next milestone: M6 - Workspace Setup
- At most one milestone may be In Progress.
- Local, Preview, Staging, and Production are distinct promotion stages.
- Substantive roadmap and milestone changes are recorded in [docs/CHANGELOG.md](./docs/CHANGELOG.md).

Do not implement work that is absent from the roadmap. Add or change a milestone first, update every affected planning document, and record the substantive change under `Unreleased` in the Changelog.

## Repository status

M4 - Operator Administration and Application Shell is Complete. M5 - Organization Integrations and Twilio Connection is In Progress on the `milestone/m5-organization-integrations` branch.
