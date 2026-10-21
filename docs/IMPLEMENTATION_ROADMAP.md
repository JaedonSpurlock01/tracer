# Tracer Implementation Roadmap

This document is the authoritative implementation sequence for Tracer from ideation through production deployment. It converts the product scope in `README.md`, domain language in `CONTEXT.md`, interface specification in `DESIGN.md`, and engineering rules in `AGENTS.md` into small, verifiable milestones.

## Document authority

- Use this roadmap to choose and sequence implementation work.
- Use `CONTEXT.md` for canonical domain language and invariants.
- Use `DESIGN.md` for page composition, states, branding, and ReUI rules.
- Use `README.md` for product scope, architecture, security, and testing strategy.
- Use `AGENTS.md` for mandatory agent behavior and verification rules.
- Use `docs/CHANGELOG.md` to record substantive roadmap, scope, milestone, and deployment changes.

If these documents conflict, stop implementation and resolve the conflict before continuing. Update every affected document in the same change.

## Current state

- **Current milestone:** None
- **Next milestone:** M18 - Production Hardening and Acceptance, which the Product Owner starts explicitly; it carries the two M17 Staging checks as entry criteria
- **Current environment:** Local, Preview, and Staging application and data paths verified; Production data resources provisioned but not deployed
- **Production status:** Not deployed
- **Last roadmap review:** 2026-10-21

M9 is Complete and merged to `main`. It delivered signed Twilio voice and status webhooks, the encrypted Organization Twilio Auth Token, idempotent Call lifecycle and provider-event persistence, the minimal constrained TwiML renderer, and Tracking Number replacement. M10 is Complete and merged to `main`. It delivered Business Hours, Keypad Gate, Whisper, and Voicemail execution, the Business Hours and override editor, text-to-speech prompt configuration with a browser Preview, and the Workspace Overview Flow summary. The Product Owner verified M10 on Staging before merging. Staging verification also fixed stale prefetched pages after a write and Resume Setup reverting a new Destination Number after a detach. M11 is Complete and merged to `main`. It delivered dual-channel connected-conversation recording, signed Recording callbacks, idempotent Trigger.dev transfer from Twilio to private R2 with size and checksum verification before Twilio cleanup, a 12-hour recovery sweep, the Workspace-authorized Recording stream route, and R2 and Trigger.dev health in Integrations. M12 is Complete. It delivered Trigger.dev waveform peak generation with recovery-sweep coverage, the Workspace-authorized peaks route, media expiry 12 months after Call start on both media routes, Call Detail with an accessible wavesurfer.js player, Call facts, processing timeline, and availability states, and Workspace Overview Recent Calls. M13 is Complete. It delivered analysis eligibility decided when a Recording is Stored, per-channel `whisper-1` Transcripts with 3-hour capping, immutable validated `gpt-5-mini` Lead Assessments with Transcript-linked evidence, the Operator Lead Review with reporting precedence, Operator Retry and recovery-sweep coverage for both stages, Call Detail Transcript, Lead Assessment, and Lead Review sections, and OpenAI processing health in Integrations. The Staging test-call check for M13 is deferred until after M14. M14 is Complete. It delivered server-backed global and Workspace Calls with canonical outcomes, Lead Review precedence, and server pagination and sorting; one filter query for the toolbar and the advanced popover, including AND and OR condition groups inside the readable Workspace scope; Workspace tabs; Call Detail with a validated back link to its source list and previous and next Call navigation; the append-only Call event log with backfill; and the day-grouped Activity timeline with 30-second visible-tab refresh and region-isolated failures. M15 is Complete. It delivered one analytics query service shared by Home, Workspace Overview, and the Workspaces list; Total Calls, Answer Rate over forwarded Calls, Good Leads with Lead Review precedence, and Average Connected Duration with equal prior-period comparisons; the three-series trend chart in the user or Workspace timezone; Workspace performance for multi-Workspace scope; Recent Calls; routing health with webhook health from accepted voice webhooks; and 7, 30, 90, All Time, and bounded custom ranges. M16 is Complete. It delivered scoped PDF and CSV reports generated in Trigger.dev, Calls Export CSV and Recording ZIP exports with a CSV manifest and a 500-Recording limit, a precomputed stereo MP3 per Stored Recording with Download MP3 and single-Call Export Call, requester-only Report history and the notification popover with downloads that recheck access to the whole Workspace scope, and seven-day artifact expiry through the `report-artifacts` R2 lifecycle rule with a 6-hour sweep that fails stuck jobs and deletes metadata after 90 days.

## Status model

| Status | Meaning |
| --- | --- |
| Not Started | Approved scope with no implementation underway |
| In Progress | The single milestone currently being implemented |
| Blocked | Work cannot continue until a named dependency or decision is resolved |
| Complete | Every exit criterion and required verification gate passed |
| Deferred | Explicitly removed from the active sequence without being completed |

At most one milestone may be In Progress. Multiple agents may work on disjoint tasks within that milestone, but the next milestone does not begin until the current milestone is Complete or explicitly Deferred.

## Roadmap operating rules

### Starting a milestone

Before writing implementation code:

1. Confirm every dependency is Complete.
2. Change the milestone status to In Progress.
3. Update Current state at the top of this document.
4. Add the milestone start under `Unreleased` in `docs/CHANGELOG.md`.
5. Identify the first public behavior and its failing tracer-bullet test.
6. Confirm required environment bindings and credentials are available without exposing secrets.

### Executing a milestone

- Deliver one vertical behavior slice at a time.
- Follow red-green-refactor for each behavior.
- Do not build all tests first and implementation second.
- Keep the application runnable after every completed slice.
- Use provider fakes and contract fixtures by default.
- Run only focused checks in the inner loop.
- Update milestone notes when scope, dependencies, risks, or exit criteria change.
- Record a blocker immediately rather than opening work in a later milestone.

### Completing a milestone

A milestone is Complete only when:

1. Every listed behavior is implemented or explicitly moved through change control.
2. Required tests passed through public interfaces.
3. The expected RED state was observed for each new behavior.
4. Affected integration, contract, Worker, task, and component tests passed.
5. Typecheck and lint passed.
6. The milestone's verification gate passed.
7. User-facing loading, empty, error, permission, and responsive states are covered when applicable.
8. Security and authorization boundaries were reviewed.
9. README, CONTEXT, DESIGN, roadmap, and Changelog updates are complete where applicable.
10. The milestone outcome is demonstrable in its target environment.

After completion:

- Set the milestone to Complete.
- Set Current milestone to None or the next explicitly started milestone.
- Add a Completed entry to `docs/CHANGELOG.md`.
- Do not silently start the next milestone.

## Change control

A roadmap change is substantive when it changes milestone scope, order, dependency, status, risk, exit criteria, environment promotion, architecture, or product behavior.

For a substantive change:

1. Update this roadmap.
2. Update the source product, domain, design, or architecture document when affected.
3. Add a Changed, Added, Removed, Security, or Completed entry to `docs/CHANGELOG.md`.
4. State why the previous plan no longer fits.
5. Recheck downstream milestone dependencies.

Routine implementation details, typo fixes, and code-level refactors remain in Git history and do not require Changelog entries.

## Verification levels

### Focused loop

Use while implementing one behavior:

- One focused Vitest file or affected domain project
- The narrowest useful type or lint check when needed
- No production build
- No Playwright unless the behavior is browser-specific
- No live provider smoke test

### Agent handoff

Use before an agent finishes implementation work:

- All affected tests
- Applicable integration, contract, Worker, task, and component suites
- Incremental typecheck
- Lint on changed files or the narrowest supported lint target
- Explicit report of tests, RED state, commands, outcomes, and skipped checks

### Full milestone gate

Use when a milestone changes dependencies, schema, migrations, bindings, build configuration, architecture, or environment promotion, and before merge at a full verification boundary:

- `verify:full`
- Migration validation when persistence changed
- Preview or Staging smoke checks as required by the milestone
- No live provider checks unless the milestone explicitly requires them

## Environment promotion model

### Local

- Provider fakes by default
- Testcontainers PostgreSQL for persistence suites
- Local Cloudflare Worker tooling
- Local Trigger.dev development process when task behavior is in scope
- No production credentials

### Preview

- Per-branch application deployment
- No production provider credentials
- Seeded non-sensitive test data
- Fast verification and applicable browser checks before sharing

### Staging

- Isolated Neon branch or database
- Isolated R2 bucket
- Staging Cloudflare bindings and secrets
- Trigger.dev Dev environment, executed by a locally run `pnpm trigger:dev` pointed at Staging resources, because a Trigger.dev Staging environment is a paid plan
- Dedicated Twilio test number
- OpenAI test budget and non-sensitive audio fixtures
- Cloudflare Email Service test recipients

### Production

- Manual promotion only
- `verify:full` passed
- Migrations reviewed and rehearsed in Staging
- Rollback path documented and tested
- Secrets and bindings validated without disclosure
- Staging acceptance passed
- Deployment recorded in `docs/CHANGELOG.md` under a dated heading

## Milestone summary

| ID | Milestone | Status | Target environment | Depends on |
| --- | --- | --- | --- | --- |
| M0 | Planning and Governance Baseline | Complete | Documentation | None |
| M1 | Verified Application Skeleton | Complete | Local and Preview | M0 |
| M2 | Data Platform and Environment Isolation | Complete | Local, Preview, and Staging | M1 |
| M3 | Provisioned Authentication and Organization Bootstrap | Complete | Local and Preview | M2 |
| M4 | Operator Administration and Application Shell | Complete | Local and Preview | M3 |
| M5 | Organization Integrations and Twilio Connection | Complete | Staging | M4 |
| M6 | Workspace Setup | Complete | Preview and Staging | M5 |
| M7 | Call Flow Publication and Workspace Activation | Complete | Preview and Staging | M6 |
| M8 | Workspace Access Grants | Complete | Preview and Staging | M7 |
| M9 | Minimal Inbound Call Tracer Bullet | Complete | Staging | M8 |
| M10 | Complete First-Release Call Routing | Complete | Staging | M9 |
| M11 | Durable Recording Transfer | Complete | Staging | M10 |
| M12 | Waveform Playback and Call Detail | Complete | Preview and Staging | M11 |
| M13 | Transcript, Lead Assessment, and Lead Review | Complete | Staging | M12 |
| M14 | Calls and Activity Operations | Complete | Preview and Staging | M13 |
| M15 | Dashboard and Workspace Analytics | Complete | Preview and Staging | M14 |
| M16 | Reports and Recording Exports | Complete | Staging | M15 |
| M17 | Retention, Purge, and Lifecycle Automation | Deferred | Staging | M16 |
| M20 | Sites and Cloudflare Connection | Complete | Preview and Staging | M17 |
| M21 | Search Rankings | Complete | Preview and Staging | M20 |
| M22 | Cost and Revenue | Complete | Preview and Staging | M21 |
| M23 | Form Submissions | Complete | Preview and Staging | M22 |
| M18 | Production Hardening and Acceptance | Not Started | Staging | M23 |
| M19 | Production Deployment and Stabilization | Not Started | Production | M18 |

M18 and M19 keep their identifiers so earlier Changelog entries stay valid; the sequence runs M17, M20, M21, M22, M23, M18, M19. Phase 7 (Business HQ) sits between Phase 6 and the deployment phase because the Product Owner decided on 2026-10-20 that every Business HQ domain ships before Production, and on 2026-10-21 pulled Form Submissions forward from the backlog into Phase 7 as M23 for the same reason.

## Phase 0 - Ideation and governance

### M0 - Planning and Governance Baseline

- **Status:** Complete
- **Outcome:** Product scope, domain language, design system, architecture, testing strategy, roadmap, and Changelog policy are documented before implementation.
- **Depends on:** None

#### Delivered

- Product and architecture overview in `README.md`
- Canonical domain glossary and relationships in `CONTEXT.md`
- Branding and page specifications in `DESIGN.md`
- Agent, TDD, verification, and documentation rules in `AGENTS.md`
- Incremental roadmap in this document
- Project-evolution history in `docs/CHANGELOG.md`

#### Exit criteria

- Required planning documents exist and cross-reference one another.
- Product, domain, design, architecture, and testing terms do not conflict.
- The next milestone has explicit dependencies and exit criteria.
- Roadmap and Changelog maintenance are mandatory for agents.

## Phase 1 - Executable foundation

### M1 - Verified Application Skeleton

- **Status:** Complete
- **Outcome:** A minimal Next.js application runs locally and in Preview with the final styling foundations and fast verification commands.
- **Depends on:** M0
- **Target environment:** Local and Preview

#### Vertical slices

1. Serve a typed JSON health endpoint through the Cloudflare-compatible Next.js runtime.
2. Apply the dark-only Tailwind, shadcn/ui, ReUI, Geist, and Tracer token foundations.
3. Expose stable verification scripts without adding product behavior.
4. Deploy the verified skeleton to a branch Preview.

#### Test-first behaviors

- The application health interface returns a successful, typed response.
- The root layout applies dark mode and the expected semantic theme tokens.
- The verification script fails on a deliberately failing fixture before that fixture is corrected.

#### Deliverables

- Next.js and TypeScript application scaffold
- Cloudflare Workers adapter and local runtime configuration
- Tailwind, shadcn/ui, ReUI, Geist, and dark-only theme setup
- Vitest projects for domain, contract, Worker, task, and component tests
- React Testing Library setup
- Playwright setup without expanding beyond the six approved journeys
- Stable scripts from the README testing contract
- CI jobs for fast tests, typecheck, lint, and build
- Preview deployment pipeline

#### Verification gate

- `test`, `typecheck`, `lint`, and `build` pass.
- A Preview deployment responds successfully.
- No production secrets are present in Preview.
- Build and test caches are configured where safe.

#### Exit criteria

- A new agent can install dependencies, run the app, run focused tests, and execute documented verification commands without inventing setup steps.
- The application has no product behavior beyond the verified skeleton.

### M2 - Data Platform and Environment Isolation

- **Status:** Complete
- **Outcome:** Tracer can migrate and query PostgreSQL through production-compatible paths while non-production data and bindings remain isolated from Production.
- **Depends on:** M1
- **Target environment:** Local, Preview, and Staging
- **Execution note:** Testcontainers persistence suites run in GitHub Actions because the Local Windows environment cannot provide a Docker-compatible runtime.

#### Vertical slices

1. Prove a Drizzle migration against Testcontainers PostgreSQL.
2. Create and read a minimal Organization through a public repository interface.
3. Connect Staging to Neon through Hyperdrive using a least-privilege role.
4. Prove Preview and Staging cannot access Production data or bindings.

#### Test-first behaviors

- A clean database reaches the latest schema through migrations.
- Applying migrations twice succeeds as a no-op through Drizzle's migration journal.
- Organization repository behavior is identical through Testcontainers and Staging Hyperdrive paths.
- Preview and Staging cannot resolve Production tenant data or object bindings.

#### Deliverables

- Separate Neon projects for Staging and Production
- Separate Hyperdrive configurations for Preview, Staging, and Production; Preview and Staging intentionally share the Staging database
- Drizzle schema and migration workflow
- Dedicated migration connections outside the Worker runtime
- Testcontainers PostgreSQL 17 harness with container reuse in GitHub Actions
- Environment binding inventory without secret values
- Forward-recovery procedure with Neon point-in-time or branch restore fallback

#### Verification gate

- `test:integration`, `typecheck`, `lint`, and `build` pass.
- Migrations succeed from an empty database in Local and Staging.
- Staging read and write smoke checks pass through Hyperdrive.

#### Exit criteria

- Schema changes have one documented path from Local through Production.
- Staging is isolated from Production at the database and binding levels.

## Phase 2 - Identity and authorization

### M3 - Provisioned Authentication and Organization Bootstrap

- **Status:** Complete
- **Outcome:** The initial Operator can bootstrap Spurlock Labs and sign in only through the approved passwordless email-code method.
- **Execution note:** Local verification runs on PostgreSQL 17 in a Docker-compatible container, with the explicit `E2E_AUTH_FAKE` seam standing in for Cloudflare Email Service. Preview enforces non-production credentials and the application recipient allowlist by configuration; live Email Service delivery to an allowlisted recipient was not exercised and remains an external check.
- **Depends on:** M2
- **Target environment:** Local and Preview

#### Vertical slices

1. Bootstrap one Organization and one provisioned Operator through a one-time command.
2. Sign in a provisioned user with an email verification code.
3. Reject unprovisioned and Disabled identities without account enumeration.
4. View and revoke sessions in Account Settings.

#### Test-first behaviors

- Bootstrap creates exactly one Spurlock Labs Organization and initial Operator.
- Repeated bootstrap is safely rejected or idempotently reports the existing Organization.
- Email OTP cannot create unprovisioned users.
- Disabled users cannot create sessions and existing sessions are revoked.
- Authentication errors do not reveal whether an email is provisioned.

#### Deliverables

- Better Auth with Organization and Email OTP plugins
- Cloudflare Email Service integration for OTP and access notices
- Bootstrap command
- Sign In and Verify Email Code pages
- Account Settings Profile, Preferences, and Security sections
- First Playwright journey for provisioned email-code sign-in

#### Verification gate

- Domain, contract, integration, component, and first Playwright journey pass.
- Preview authentication uses non-production credentials and recipients.
- Session revocation is verified through the public interface.

#### Exit criteria

- Only provisioned identities can enter Tracer.
- The initial Organization and Operator can be reproduced from documented setup.

### M4 - Operator Administration and Application Shell

- **Status:** Complete
- **Outcome:** Active Operators can manage other Operators through a secure application shell before Workspace and Client Viewer resources exist.
- **Depends on:** M3
- **Target environment:** Local and Preview
- **Execution note:** Only Operator provisioning is available; the Provision User role field exposes Client Viewer as unavailable until M8. The Sidebar renders every global navigation item from DESIGN.md, with guarded placeholder pages for Activity, Calls, Workspaces, and Reports until their milestones deliver them. Last sign-in and provisioning attribution are persisted on the user record. Local domain, contract, integration, component, Worker, typecheck, lint, and build gates passed; the browser journey could not complete reliably on the 2-CPU Local VM because Turbopack first-compile latency exceeded Playwright timeouts, so the browser journey and Preview deployment gates run in GitHub Actions before M4 is marked Complete.

#### Vertical slices

1. Render the Operator Sidebar shell and account menu.
2. Provision and manage additional Operators.
3. Restrict Users and Integrations navigation and routes to Operators.
4. Protect the last Active Operator from disablement.
5. Disable and re-enable another Operator while revoking sessions immediately.

#### Test-first behaviors

- Organization scope applies to every user-management query.
- Operator-only routes require an Active Operator through the server boundary.
- The last Active Operator cannot be disabled.
- A newly provisioned Operator receives Organization-wide Operator capabilities after first sign-in.
- Client Viewer provisioning and role demotion remain unavailable until M8 can create a required Access Grant atomically.
- Hidden navigation never substitutes for server authorization.

#### Deliverables

- Application shell and responsive Sidebar
- Users page and management Dialog for Operator administration
- Organization Operator-role behavior
- Central server authorization foundation
- Operator-only route and action guards

#### Verification gate

- Domain, integration, and component tests pass.
- Direct route and API attempts are tested, not only hidden navigation.
- Accessibility checks cover responsive navigation and management dialogs.

#### Exit criteria

- Operator role and User State rules are enforced centrally.
- Client Viewer provisioning and Workspace-specific authorization are explicitly deferred to M8, after an Active Workspace exists.

## Phase 3 - Organization operations

### M5 - Organization Integrations and Twilio Connection

- **Status:** Complete
- **Outcome:** An Operator can securely connect and verify the Organization's Twilio account while viewing provider health.
- **Depends on:** M4
- **Target environment:** Staging
- **Execution note:** The Twilio boundary uses direct REST calls through `fetch` behind a small client interface so the official SDK can replace it later without changing domain code. Number inventory accepts only `+1` numbers because Twilio's owned-number API does not return a country; United States and Canada are not distinguished in this release. Disconnect dependency checking is a pure policy fed by an Active Workspace count that stays zero until M6 creates the Workspace table. R2, OpenAI, and Trigger.dev report Configured or Not configured from binding and secret presence only; their Test actions arrive with their own milestones. The Operator entered the Twilio API key through the Integrations page against the shared Staging database; Test Connection and Sync Numbers succeeded and stored six E.164 numbers. Preview and Staging share one `TWILIO_CREDENTIAL_MASTER_KEY` because they share that database. The Staging Worker gained its `EMAIL` binding and authentication secrets during this milestone after live checks showed every database-backed Staging route failing with `EMAIL is required`.

#### Vertical slices

1. Encrypt and store one Organization Twilio API credential.
2. Test the credential without exposing its secret.
3. Synchronize United States and Canadian number inventory.
4. Display health for Twilio, R2, OpenAI, Trigger.dev, Hyperdrive, and Cloudflare Email Service.
5. Block Twilio disconnect while Active Workspaces depend on it.

#### Test-first behaviors

- Twilio secrets cannot be read back after storage.
- Authentication data is never logged or returned through application interfaces.
- Credential rotation preserves service only after the replacement is verified.
- Number inventory normalizes phone numbers to E.164.
- Disconnect validation identifies dependent Active Workspaces.

#### Deliverables

- Organization credential encryption using a deployment-held master key
- Twilio client boundary and contract fixtures
- Number inventory synchronization
- Integrations page with isolated provider health states
- Staging provider configuration and test number

#### Verification gate

- Contract and integration tests pass with secrets redacted.
- A Staging Twilio connection test succeeds.
- Logs and error responses contain no credential material.

#### Exit criteria

- Staging can enumerate eligible numbers through the connected Organization account.
- Operators can diagnose configuration without accessing stored secret values.

### M6 - Workspace Setup

- **Status:** Complete
- **Outcome:** An Operator can create and manage a Setup Required Workspace without activating Twilio routing prematurely.
- **Depends on:** M5
- **Target environment:** Preview and Staging
- **Execution note:** Workspace names are unique per Organization case-insensitively across every state. The Create Workspace Dialog renders all four wizard steps but only Basics is editable; Number, Routing, and Review stay disabled until M7, and Resume Setup reopens the Dialog on the disabled Number step. The Workspaces Data Grid is server-backed with Organization-scoped search, Workspace State filtering, and pagination; number, metric, and health columns render placeholders until their milestones. Migration 0005 creates the `workspace` table with the M7 routing settings columns already present so M7 avoids a second schema change, and the runtime role receives SELECT, INSERT, and UPDATE but never DELETE on it; rerun `db:grant-runtime` on Staging after applying it. The Workspace service has no Twilio dependency, and the Integrations disconnect check now reads the real Active Workspace count.

#### Vertical slices

1. Create a Setup Required Workspace with name and reporting timezone.
2. List, search, and open Workspaces through the Workspaces Data Grid.
3. Edit Workspace name and reporting timezone.
4. Archive a never-activated Workspace without changing Twilio.
5. Restore an Archived Workspace to Setup Required.
6. Resume setup without claiming the Workspace is Active.

#### Test-first behaviors

- A new Workspace starts in Setup Required.
- Setup Required has no active Number Assignment or published Flow Version.
- Workspace names and reporting timezones validate through public interfaces.
- Archiving a never-activated Workspace performs no Twilio mutation.
- Restore returns an Archived Workspace to Setup Required and never activates routing.
- Organization scope applies to every Workspace query.

#### Deliverables

- Workspace and Workspace State domain modules
- Workspaces Data Grid
- Initial Create Workspace and Resume Setup flow
- Workspace Settings General section
- Setup Required, Archived, loading, empty, and error states

#### Verification gate

- Domain, integration, and component tests pass.
- No Twilio mutation occurs in this milestone.
- Preview demonstrates create, archive, restore, and resume setup.

#### Exit criteria

- A Setup Required Workspace is durable and recoverable.
- Activation is impossible until M7 publishes a valid Flow Version and attaches a Tracking Number.

## Phase 4 - Workspace activation, access, and call routing

### M7 - Call Flow Publication and Workspace Activation

- **Status:** Complete
- **Outcome:** An Operator can finish setup, publish a valid initial Call Flow, activate one Tracking Number safely, and manage the resulting active Workspace lifecycle.
- **Depends on:** M6
- **Target environment:** Preview and Staging
- **Execution note:** Migration 0006 adds `number_assignment`, `call_flow_draft`, and `flow_version`; the runtime role receives no DELETE on assignments or versions, so published versions are immutable at the database boundary. Call Flow graphs are stored as JSON and validated by the pure `data/call-flow.ts` validator; the wizard generates the constrained initial graph and the React Flow editor supports the full node catalog. Activation runs in one transaction under the Workspace advisory lock: the Twilio voice configuration is snapshotted and persisted before the number is pointed at `${BETTER_AUTH_URL}/api/twilio/voice/{assignmentId}`, and a Twilio failure rolls everything back so the Workspace stays Setup Required. Archiving an Active Workspace restores the snapshot first and aborts, keeping the Workspace Active, if restoration fails; DESIGN.md was corrected accordingly. After publication the Destination Number, spam gate, and whisper settings are derived from the published graph, and enabling recording is refused until the published version contains a Recording Disclosure. Tracking Number replacement stays deferred until the first persisted Call. Browser journeys run against the in-memory `E2E_TWILIO_FAKE` Twilio boundary; the live Staging attach, activate, archive, and restore check on the dedicated test number is a separate gate the Product Owner triggers after migrations 0005 and 0006 reach Staging.

#### Vertical slices

1. Select one unassigned Tracking Number and read its current Twilio voice configuration.
2. Configure the Destination Number, recording, analysis, disclosure voice, spam gate, and whisper setup options.
3. Generate and save the initial editable Call Flow draft.
4. Validate one Incoming Call and every required terminal outcome without cycles.
5. Require Recording Disclosure when recording is enabled.
6. Save invalid drafts while preventing publication.
7. Atomically snapshot prior Twilio configuration, attach Tracer, start the Number Assignment, publish the Flow Version, and mark the Workspace Active.
8. Edit and publish a later draft without changing the active version until publication succeeds.
9. Archive the Active Workspace and restore prior Twilio configuration.
10. Restore the Workspace to Setup Required without silently reactivating routing.
11. Read prior Flow Versions without editing them.

#### Test-first behaviors

- A Workspace has at most one editable draft.
- Invalid drafts remain saved but cannot publish.
- Activation requires one valid Tracking Number, Destination Number, and publishable Flow.
- One Tracking Number cannot be actively assigned twice.
- Attachment records prior Twilio configuration before changing it.
- Activation failure leaves the Workspace Setup Required and restores or preserves external configuration safely.
- Publication failure leaves the prior Flow Version active.
- An Active Workspace has exactly one active Number Assignment and one published Flow Version.
- New Calls pin the active Flow Version at start.
- Published versions are immutable.
- Archive restores prior Twilio configuration safely.
- Restore never silently reactivates routing.

#### Deliverables

- Number Assignment, Call Flow, and Flow Version domain modules
- Complete Create Workspace wizard
- Graph validator
- React Flow palette, canvas, inspector, and publish toolbar
- Workspace Settings Number and Recording and AI sections
- Twilio attachment and restoration boundaries
- Validation result navigation
- Second Playwright journey for Workspace creation and activation
- Third Playwright journey for valid publication and invalid rejection

#### Verification gate

- Domain, contract, integration, component, and both Workspace and Flow Playwright tests pass.
- Failure injection covers partial attachment, activation, publication, and restoration.
- Keyboard interaction and canvas alternatives satisfy the documented accessibility boundary.
- No arbitrary TwiML or custom code can enter the graph.
- Staging proves attach, activate, archive, and restore behavior on the dedicated test number.

#### Exit criteria

- A valid minimal Flow Version and Number Assignment can activate a Workspace atomically.
- Active Workspace lifecycle transitions are recoverable and auditable.
- Twilio number ownership remains outside Tracer.
- Live inbound routing still waits for M9.

### M8 - Workspace Access Grants

- **Status:** Complete
- **Outcome:** An Operator can grant a Client Viewer explicit read access to an Active Workspace without exposing any ungranted Workspace.
- **Depends on:** M7
- **Target environment:** Preview and Staging
- **Execution note:** New Access Grants may target only Active Workspaces. Existing grants survive archive and keep read-only access to the Archived Workspace; they also survive a restore to Setup Required but authorize nothing until the Workspace is Active again. A Client Viewer always holds at least one Access Grant: provisioning and Operator demotion require one, and removing the last remaining grant is refused, so an Operator disables the user to end all access. Until M15 delivers the scoped Home dashboard, a multi-Workspace Client Viewer lands on the Workspaces list filtered to their grants; a one-Workspace Client Viewer lands on that Workspace Overview. Migration 0007 adds `access_grant`; the runtime role receives SELECT, INSERT, and DELETE but no UPDATE. Migration 0007 and the refreshed runtime grants must reach Staging through the approved GitHub workflow before M8's Staging check runs.

#### Vertical slices

1. Provision one Client Viewer and one required Access Grant atomically.
2. Send access instructions without an activation token or password.
3. Open the granted Workspace through the Client Viewer shell.
4. Deny every ungranted Workspace through pages and server interfaces.
5. Add a second Access Grant to the same Client Viewer.
6. Remove one Access Grant and block subsequent reads immediately.
7. Preserve read-only historical access for existing grants when a Workspace is Archived.
8. Allow Operator-to-Client-Viewer demotion only when at least one Access Grant exists.

#### Test-first behaviors

- Client Viewer provisioning requires at least one Access Grant.
- User creation and initial grant succeed or fail atomically.
- Each Access Grant connects exactly one Client Viewer to exactly one Workspace.
- Duplicate grants do not create duplicate authorization.
- Client Viewer access requires a current direct Access Grant.
- Grant removal blocks the next authorized request.
- Organization scope and Access Grant scope both apply.
- Setup Required Workspaces cannot be newly granted to Client Viewers.
- Role demotion validates Access Grants and last-Operator protection.
- Hidden navigation never substitutes for server authorization.

#### Deliverables

- Access Grant domain and persistence behavior
- Client Viewer provisioning and access-instruction email
- Users management support for both roles and safe role changes
- Central Workspace authorization policy
- Workspace Settings Access section
- Role-aware Workspace navigation and switcher
- Fifth Playwright journey for granted access and ungranted denial

#### Verification gate

- Domain, integration, authorization, component, and Access Grant Playwright tests pass.
- Direct route and server-interface attempts are tested, not only hidden navigation.
- Revocation is verified with an already authenticated Client Viewer session.

#### Exit criteria

- A Client Viewer can open only directly granted Active or Archived Workspaces.
- Revocation takes effect without waiting for a new login.

### M9 - Minimal Inbound Call Tracer Bullet

- **Status:** Complete
- **Outcome:** One real Staging inbound call travels through Tracer, forwards to the Destination Number, and persists a canonical Call lifecycle.
- **Depends on:** M8
- **Target environment:** Staging
- **Execution note:** Twilio signs webhooks with the account Auth Token, which the M5 API key credential cannot replace, so the Organization Twilio connection gains an Auth Token encrypted under ADR 0005, entered and verified on the Integrations page before storage. Workspace activation is refused until that Auth Token is configured, because every inbound Call would otherwise fail signature validation. A Call whose pinned Flow Version reaches a step deferred to M10 (Business Hours, Keypad Gate, Whisper, or Voicemail) ends as Failed with a persisted reason rather than skipping the step. A voice webhook for an ended Number Assignment or a non-Active Workspace returns `<Reject/>`, creates no Call, and persists the provider event for diagnosis. Forward Call maps a connected leg to Answered, no-answer or busy to Missed, a caller hang-up before connection to Abandoned, and provider or Tracer errors to Failed. Replace Number is available for any Active Workspace; replacing after a completed Call is only the Staging verification order. At the Product Owner's request, M9 also moves the account menu to the top of the Sidebar with a DiceBear avatar, lists the current Organization with a disabled New organization action, and removes the Sidebar Workspace switcher because the Workspaces page owns Workspace selection. Detach Number ends the active Number Assignment as detached, restores the number's prior Twilio voice configuration, and moves the Workspace to Setup Required with its Calls and Flow Versions intact, so an Operator can stop routing without a replacement number; the number stays in the Twilio account, and a Twilio failure aborts the detach and keeps the Workspace Active. Workspace Settings sections become separate pages behind a vertical rail. Frequently used pages render their first data on the server and their navigation links prefetch the full route, so they open without Skeletons; each view then revalidates quietly in the background because a fully prefetched route can be served from the client cache for up to five minutes. Workspaces search, state filter, and page live in the URL so the server renders the requested page.

#### Vertical slices

1. Validate a signed Twilio voice webhook.
2. Create or resume a Call idempotently.
3. Load and pin the active Flow Version.
4. Return TwiML for Incoming Call, fixed disclosure when enabled, Forward Call, and terminal outcome.
5. Map status callbacks into Answered, Missed, Abandoned, or Failed.
6. Reject invalid signatures and inactive assignments.
7. Replace the Tracking Number after a completed Call while preserving Number Assignment and Call history.

#### Test-first behaviors

- Valid signatures pass and invalid signatures fail.
- Duplicate callbacks do not duplicate Calls or transitions.
- Each completed Call has exactly one canonical Call Outcome.
- A Call continues with its pinned Flow Version after a new publication.
- Historical Calls retain their dialed Tracking Number after replacement.
- Replacement restores prior Twilio configuration and starts a new Number Assignment safely.
- Webhook handlers persist accepted events before triggering follow-up work.

#### Deliverables

- Twilio webhook routes
- Encrypted Organization Twilio Auth Token and signature validation
- Minimal constrained TwiML renderer
- Call lifecycle and provider-event persistence
- Tracking Number replacement flow in Workspace Settings
- Contract fixtures for voice and status callbacks
- Staging smoke script for the dedicated number
- Sidebar account and Organization menu replacing the Workspace switcher, added at the Product Owner's request
- Detach Number in Workspace Settings and one page per Workspace Settings section, added at the Product Owner's request
- Server-rendered first data and full Link prefetching for Workspaces, Workspace Settings, Users, and Integrations, with Workspaces pagination in the URL, added at the Product Owner's request

#### Verification gate

- Domain, contract, Worker, and integration tests pass.
- One real Staging call is answered and one non-answer outcome is observed.
- Duplicate callback replay leaves state unchanged.
- Staging replaces the test number after a completed Call and verifies historical attribution.
- The Product Owner waived the three live Staging checks above when closing M9 on 2026-10-16; they move to M10's verification gate. The automated suites passed in the pull request's full-verification and Staging database smoke checks.

#### Exit criteria

- The first end-to-end telephony path works without recording or AI dependencies.
- Failures are diagnosable from persisted state.

### M10 - Complete First-Release Call Routing

- **Status:** Complete
- **Outcome:** Published flows execute Business Hours, Keypad Gate, Whisper, Forward Call, and Voicemail branches with the documented outcomes.
- **Depends on:** M9
- **Target environment:** Staging
- **Execution note:** Voicemail captures the caller's message whether or not Workspace recording is enabled, because the caller chooses to leave it; the recording setting and its disclosure govern connected conversations only. Voicemail succeeds when Twilio reports a completed recording with at least 1 second of audio. A Voicemail with no usable capture ends as Missed when entered from a Forward Call Missed branch and Abandoned when entered from Business Hours Closed; a Twilio recording error ends as Failed with a persisted reason. Keypad Gate replays its prompt once after a wrong digit or timeout, then follows Blocked; a caller hang-up during the gate is Blocked. Text-to-speech Preview uses the browser's speech synthesis, labeled as an approximation of the selected Twilio voice. Business Hours is evaluated once in the Workspace timezone at the Call's persisted start, a window includes its start and excludes its end, a window may end at 24:00 so overnight hours are entered as one segment per day, and a date override replaces that date's weekly windows. A Whisper must lead directly to a Forward Call and is spoken only to the answering business leg. M10 stores the voicemail's Twilio recording reference and length on the Call; moving the audio to R2 remains M11. Voicemail captured while recording is disabled is kept but never analyzed, because analysis already requires recording.

#### Vertical slices

1. Execute Business Hours with weekly windows and date overrides.
2. Execute Keypad Gate Pass and Blocked branches.
3. Play the optional English Whisper to the business.
4. Route Closed or Missed paths to Voicemail.
5. Capture up to 120 seconds of voicemail, stop on detectable silence, and accept `#` finish.
6. Map successful voicemail capture to the Voicemail Call Outcome.

#### Test-first behaviors

- Business Hours uses the Workspace timezone at boundary transitions.
- Every Business Hours and Keypad Gate path reaches one terminal outcome.
- Blocked Calls never forward.
- Whisper occurs only on the business-answer path.
- Voicemail limits and finish conditions are enforced.
- Failed voicemail capture does not report Voicemail success.

#### Deliverables

- Full first-release TwiML execution layer
- Business Hours and override editor
- Text-to-speech prompt configuration
- Voicemail node behavior
- Workspace Overview read-only Flow summary
- Contract fixtures for Gather, Dial, and Record callbacks

#### Verification gate

- Domain, contract, Worker, and integration suites pass.
- Staging exercises each branch with non-sensitive test calls.
- Carried from M9: one real Staging call is answered and one non-answer outcome is observed, `pnpm smoke:staging-call --replay` leaves state unchanged, and Staging replaces the test number after a completed Call and verifies historical attribution.
- Provider costs from branch smoke checks are recorded.
- The Product Owner marked M10 Complete on 2026-10-16 after the domain, contract, integration, Worker, component, browser, typecheck, lint, and build gates passed, and before the live Staging checks above ran. The Product Owner then verified the Staging branch checks before merging on 2026-10-16. Provider costs from those checks were not recorded.

#### Exit criteria

- Every supported Flow node executes through a public, tested boundary.
- Every graph path produces a canonical outcome or a recoverable failure.

## Phase 5 - Media and intelligence

### M11 - Durable Recording Transfer

- **Status:** Complete
- **Outcome:** Connected recordings and voicemail audio move durably from Twilio to private R2 through idempotent Trigger.dev workflows.
- **Depends on:** M10
- **Target environment:** Staging
- **Execution note:** M10 records voicemail only; Forward Call's Dial does not record connected conversations, so M11 adds dual-channel recording from answer to Forward Call when Workspace recording is enabled. The Recording-processing task runs in Trigger.dev Cloud, outside the Worker bindings, so it reaches R2 through a bucket-scoped S3 API token, PostgreSQL through a Neon runtime-role connection string, and Twilio by decrypting the Organization credential with the Twilio credential master key held as a Trigger.dev environment secret; M12 waveform and M13 transcription need the same direct R2 access. M11 also adds the Workspace-authorized Recording stream route as the only read path for private media, so M12 playback consumes an already-tested authorization boundary. R2 stores Twilio's WAV as the authoritative copy because it is lossless and keeps the Caller and Business channels separate for M12 waveform lanes and M13 transcription; MP3 downloads are derived later. Staging and Production each have a private bucket (`tracer-recordings-staging`, `tracer-recordings-production`) with no public or `r2.dev` access; Tracer Staging and Preview use the Trigger.dev Dev environment and the Staging bucket, because a Trigger.dev Staging environment requires a paid plan and Preview already shares the Staging database; Dev runs execute only while `pnpm trigger:dev` runs locally against Staging resources, so each Recording-processing request carries a 7-day queue lifetime instead of Dev's 10-minute default and Staging verification requires the local dev server. Tracer Production uses the Trigger.dev Production environment, preserving Production isolation. Integrations reports R2 and Trigger.dev health from Tracer's own Recording state (configuration, last successful transfer, recent transfer failures) without calling the Trigger.dev API; the live run status, task version, and test-cycle items in DESIGN remain later scope. A Recording left Pending or Failed is recovered by a Trigger.dev scheduled sweep every 12 hours that re-requests processing with the same idempotency key for Recordings between 1 hour and 7 days old; a shorter interval would keep the Neon compute from scaling to zero for a failure the Product Owner expects to be rare.

#### Vertical slices

1. Record connected conversations with separate Caller and Business channels when Workspace recording is enabled.
2. Accept and persist a signed Recording callback.
3. Trigger one idempotent Recording-processing run.
4. Download dual-channel or caller-only media from Twilio.
5. Upload the private object to R2 and verify size and checksum metadata.
6. Delete the Twilio copy only after verification.
7. Retry failed stages without duplicating objects or deleting the only valid copy.
8. Stream a Recording only through current Workspace authorization.

#### Test-first behaviors

- Duplicate Recording callbacks trigger one logical workflow.
- Twilio media is never deleted before R2 verification.
- Retry after upload reuses or safely replaces the expected object.
- Partial failures preserve enough state for targeted recovery.
- Private objects cannot be accessed without current authorization.
- A recording-enabled Workspace records the answered Forward Call leg in dual channel, and a recording-disabled Workspace never records it.

#### Deliverables

- Trigger.dev Cloud configuration
- Recording transfer task and stage persistence
- R2 object-key and metadata policy
- Twilio cleanup operation
- Recording processing states
- Trigger.dev integration health in Integrations
- Dual-channel Forward Call recording and its signed status callback
- Workspace-authorized Recording stream route

#### Verification gate

- Task, contract, integration, and authorization tests pass.
- Staging proves one connected call and one voicemail transfer.
- Failure injection proves Twilio cleanup does not run early.
- The Product Owner marked M11 Complete on 2026-10-17 after the task, contract, integration, Worker, component, browser, typecheck, lint, and build gates passed, integration failure injection proved Twilio cleanup waits for a verified R2 object, and two Staging connected calls transferred through the local Trigger.dev Dev runner with matching R2 size and SHA-256 and their Twilio copies deleted. The Staging voicemail transfer is deferred to a later Product Owner check.

#### Exit criteria

- R2 is the authoritative durable media source.
- Recording transfer is safe under duplicate delivery and retry.

### M12 - Waveform Playback and Call Detail

- **Status:** Complete
- **Outcome:** Authorized users can inspect a Call and play retained audio through an accessible interactive waveform.
- **Depends on:** M11
- **Target environment:** Preview and Staging
- **Execution note:** Calls and Activity remain placeholders until M14, so M12 adds Call Detail at `/workspaces/{workspaceId}/calls/{callId}` and the Workspace Overview Recent Calls list (five newest Calls) from DESIGN as its entry point. The player uses wavesurfer.js over precomputed peaks and streams audio only through the M11 Workspace-authorized Recording route; peaks are served through the same Workspace authorization. Download MP3 and Export Call wait for M16, so M12 offers playback only. Transcript, Lead Assessment, and Lead Review wait for M13, and previous and next Call navigation waits for the M14 Calls list. Recording media counts as Expired 12 months after the Call starts: the audio and peaks routes refuse it and Call Detail labels it Expired, while the Call, its facts, Recording metadata, and analytics remain indefinitely. The Purged state, its timestamp, and Purge Media wait for M17, where the purge action that writes them is built.

#### Vertical slices

1. Generate waveform peaks through Trigger.dev Audio Waveform tooling.
2. Render one mixed lane or aligned Caller and Business lanes.
3. Authorize and stream private Recording media.
4. Support play, pause, seek, zoom, playback speed, volume, and keyboard controls.
5. Render Call facts and processing timeline.
6. Handle processing, failed, unavailable, expired, and purged states.

#### Test-first behaviors

- Waveform derivation is idempotent and tied to Recording retention.
- Client Viewers can stream only recordings in granted Workspaces.
- Revoked access blocks the next media request.
- Single-channel fallback is explicit and usable.
- The waveform is not the only seek interface.

#### Deliverables

- Waveform generation task
- Private media delivery boundary
- Call Detail header, player, facts, and processing timeline
- Loading, unavailable, expired, and error states
- Component accessibility coverage

#### Verification gate

- Task, integration, component, and authorization tests pass.
- Preview keyboard and responsive checks pass.
- Staging playback works without a public R2 object URL.
- The Product Owner marked M12 Complete on 2026-10-17 after the domain, contract, task, integration, Worker, component, browser, typecheck, lint, build, migration validation, and Staging database smoke gates passed with migration 0014 applied to Staging, the two existing Staging connected Recordings generated Caller and Business peaks from real `audiowaveform` output through the local Trigger.dev Dev runner, and the Product Owner verified playback, controls, and layout on Staging, which runs the same build as Preview. The Staging voicemail transfer check deferred from M11 remains open.

#### Exit criteria

- An authorized user can investigate retained audio without direct provider access.

### M13 - Transcript, Lead Assessment, and Lead Review

- **Status:** Complete
- **Outcome:** Eligible recordings produce normalized English Transcripts and advisory Lead Assessments, while Operators can add a separate authoritative Lead Review.
- **Depends on:** M12
- **Target environment:** Staging
- **Execution note:** Eligibility uses durations Tracer already persists rather than paid speech detection: connected Calls use the forwarded leg's connected duration, falling back to the dual-channel Recording duration when that leg's status has not arrived by the time the Recording is Stored, and voicemail uses the Recording duration, each needing at least 15 seconds, and the Workspace analysis toggle is read when the Recording is Stored, so enabling analysis later does not backfill earlier Calls. Transcription splits the dual-channel WAV into Caller and Business mono audio, transcribes each channel with `whisper-1` `verbose_json` segments, the lowest-cost OpenAI transcription model that returns segment timestamps (the cheaper `gpt-transcribe` returns none), and merges segments by start time, so speaker labels come from the channel rather than diarization; a voicemail is one Caller channel. Each channel is chunked below OpenAI's upload limits with chunk offsets applied to timestamps, and only the first 3 hours of a longer Recording are transcribed and assessed. The Lead Assessment uses one fixed Tracer prompt with the Workspace name as context and `gpt-5-mini` with strict structured output, chosen over `gpt-5-nano` for summary and evidence quality at well under a cent per Call; per-Workspace lead criteria stay out of scope. Both model identifiers are fixed values, checked against OpenAI's documentation and pricing on 2026-10-17. A Call keeps one current Lead Review that an update overwrites with its reviewer and time; review history waits for the M14 Activity log. M13 also adds an Operator-only Retry for a failed Transcript or Lead Assessment, recovery-sweep coverage for both stages, Transcript search with follow mode and Resume Follow, and the OpenAI Integrations card's configured models, last successful Transcript and Lead Assessment, and recent failures; the live OpenAI authentication test remains later scope. Transcription drops segments matching Whisper's own no-speech rule so silent channels do not produce invented text, runs on a 1 GB Trigger.dev machine so a 3-hour stereo WAV fits in memory, and stops without retrying on OpenAI request errors that cannot succeed on retry; Lead Assessments are requested with OpenAI response storage disabled and fail when an evidence quote is not found in its referenced Transcript turn. The Operator adds or updates a Lead Review from its section on Call Detail; the header action joins the header's Download MP3, Export Call, and overflow actions when M16 builds them. Staging verification uses non-sensitive test calls the Product Owner places, at least one over 15 seconds, one under it, and one voicemail, with `OPENAI_API_KEY` set in the Trigger.dev Dev environment.

#### Vertical slices

1. Determine analysis eligibility from settings, spam result, and captured speech duration.
2. Produce a timestamped, speaker-normalized Transcript through OpenAI.
3. Render Transcript turns synchronized with waveform seeking.
4. Validate and persist the structured Lead Assessment.
5. Add or update an Operator Lead Review.
6. Compute effective lead classification with Lead Review precedence.

#### Test-first behaviors

- Disabled analysis and ineligible recordings do not call OpenAI.
- Fifteen seconds is evaluated from connected talk or captured voicemail speech.
- Lead Assessment output is immutable.
- Lead Review remains separate and takes reporting precedence.
- Evidence links resolve to valid Transcript turns.
- Provider failures do not remove usable Recording playback.

#### Deliverables

- Analysis eligibility domain service
- OpenAI transcription and assessment boundaries
- Normalized Transcript schema
- Lead Assessment validation
- Lead Review interface
- Transcript and assessment sections on Call Detail

#### Verification gate

- Domain, contract, task, integration, and component tests pass.
- Staging processes approved non-sensitive audio fixtures.
- Cost and token metadata are captured without logging content.
- The Product Owner marked M13 Complete on 2026-10-17 after the domain, contract, task, component, harness, Worker, integration, browser, typecheck, lint, build, and migration validation gates passed locally and in the Verification workflow, whose Staging gate applied migration 0015 and its runtime grants, deployed `tracer-staging`, and passed the database smoke check. The Product Owner deferred processing non-sensitive Staging test calls (connected over 15 seconds, connected under 15 seconds, and voicemail) through the local Trigger.dev Dev runner until after M14; that check and the Staging voicemail transfer check deferred from M11 remain open.

#### Exit criteria

- Eligible Calls progress independently through Transcript and Lead Assessment states.
- Human review never overwrites model output.

## Phase 6 - Operations and reporting

### M14 - Calls and Activity Operations

- **Status:** Complete
- **Outcome:** Users can search, filter, and investigate authorized Calls and follow expandable operational Activity.
- **Depends on:** M13
- **Target environment:** Preview and Staging
- **Execution note:** Activity reads an append-only Call event table that each lifecycle writer (Twilio voice and status webhooks, Recording transfer, Transcript, Lead Assessment, and Lead Review) appends to in the same transaction as the state change it records, so every step, failures included, carries its exact time, and each Lead Review add or update is its own event, which provides the review history M13 deferred; the migration backfills events for existing Calls from their persisted state. One Activity entry per Call is the grouping of its events, never a duplicated row. Export Recordings and Export CSV appear disabled on Calls until M16 builds them, and Download MP3 stays out of the row actions until then. With no date filter, Calls covers all time and Activity covers the last 7 days with Load more. Play Recording opens Call Detail and starts the M12 player, so playback keeps one authorized surface. Call Detail opened from Calls or Activity keeps the source filters for its back link and adds the previous and next Call navigation M12 deferred. M14 also builds the Workspace tabs from DESIGN (Overview, Calls, Flow for Operators, and Settings, with Reports added when M16 builds it), which no earlier milestone built and which Workspace Calls needs as its entry point. The Calls filter query supports AND and OR condition groups from the ReUI Filters advanced popover, so its Add group action works rather than being a dead control.

#### Vertical slices

1. Render the server-backed Calls Data Grid with canonical outcomes.
2. Apply basic and advanced filters through one filter query.
3. Open Call Detail while preserving source filters.
4. Group Activity by date and one expandable entry per Call.
5. Refresh Activity every 30 seconds while visible and pause while hidden.
6. Isolate partial fetch and processing failures to their regions.

#### Test-first behaviors

- Filters never return ungranted Workspace data.
- Effective classification uses Lead Review precedence.
- Activity events update one Call entry rather than duplicating it.
- Global dates use user timezone and Workspace dates use Workspace timezone.
- Existing Activity remains visible after a refresh failure.

#### Deliverables

- Global and Workspace Calls pages
- Activity page
- ReUI Data Grid, Filters, and Timeline compositions
- Server pagination, sorting, and search
- Fourth Playwright journey for a simulated Twilio lifecycle

#### Verification gate

- Domain, integration, component, and lifecycle Playwright tests pass.
- Responsive grid and timeline checks pass at the documented breakpoints.
- Server authorization is tested independently from UI filters.
- The Product Owner marked M14 Complete on 2026-10-18 after the domain, integration, component, Worker, typecheck, lint, build, and Playwright gates passed locally and in the Verification workflow, including the simulated Twilio lifecycle journey and responsive checks at 390px, 768px, and 1440px; the workflow's Staging gate applied migration 0016 with its runtime grants, deployed `tracer-staging`, and passed the database smoke check; and the Product Owner verified Calls, filters, Activity, and Call Detail on Staging. The Staging test calls deferred from M13 and the Staging voicemail transfer check deferred from M11 remain open.

#### Exit criteria

- Calls and Activity are trustworthy operational views across authorized scope.

### M15 - Dashboard and Workspace Analytics

- **Status:** Complete
- **Outcome:** Home and Workspace Overview present consistent, timezone-correct business and routing metrics.
- **Depends on:** M14
- **Target environment:** Preview and Staging
- **Execution note:** One analytics query service backs Home, Workspace Overview, and the Workspaces list, so every surface shares the KPI definitions. Answer Rate divides Answered Calls by Calls with a Forwarding attempted event, so Abandoned, Missed, and Failed forwards count against it while after-hours Voicemail, Blocked, and spam-gate failures do not. Lead Rate in Workspace performance is Good Leads divided by Total Calls. Twilio webhook health comes from recorded provider events rather than a live Twilio check: an Active Workspace warns when its current Tracking Number has no accepted voice webhook. Signature rejections are refused before any write and stay unrecorded, so forged traffic never writes to the database. M15 also fills the Workspaces list Calls and Good Leads for the last 30 days, Last Call, and Integration health columns from the same service. Home replaces the interim Workspaces-list landing for multi-Workspace Client Viewers. Total Calls counts every Call started in the period, In Progress included, and Average Connected Duration averages Answered Calls only. All Time shows no comparison, and a comparison against a zero prior period shows a dash rather than a percentage. Custom ranges plot daily points up to 31 days, weekly points (Monday through Sunday) up to 180 days, and monthly points beyond. Generate Report appears disabled until M16 builds Reports. The trend chart uses the shadcn chart component over `recharts`, the dependency ReUI's chart examples build on. View Calls carries the dashboard range as the Started filter. Comparisons show relative change for counts and durations and percentage points for Answer Rate. The webhook warning's Operator-only recovery action opens Workspace Settings.

#### Vertical slices

1. Compute Total Calls, Answer Rate, Good Leads, and Average Connected Duration.
2. Compute Total, Answered, and Good Lead trend series.
3. Compare Workspaces within authorized scope.
4. Render Recent Calls with preserved navigation context.
5. Render Workspace routing health and read-only Flow summary.
6. Support 7, 30, 90, All Time, and custom ranges.

#### Test-first behaviors

- KPI definitions match README and DESIGN.
- Lead Review precedence is consistent in every aggregate.
- Comparison periods use equal prior windows.
- Date buckets respect the selected user or Workspace timezone.
- Single-Workspace viewers do not receive fleet comparison data.

#### Deliverables

- Analytics query services
- Home dashboard
- Workspace Overview
- Charts, KPI Frames, Workspace comparison, and Recent Calls
- Region-level loading, empty, and error states

#### Verification gate

- Domain, integration, and component tests pass.
- Aggregates are checked against fixed, non-round fixture datasets.
- Responsive and chart accessibility checks pass.
- The Product Owner marked M15 Complete on 2026-10-18 after the domain, integration, component, typecheck, lint, build, and Playwright gates passed locally and in the Verification workflow, including Home and Workspace Overview responsive checks at 390px, 768px, and 1440px; the workflow's Staging gate deployed `tracer-staging` with the CodeRabbit review fixes and passed the database smoke check; and the Product Owner verified Home, Workspace Overview, and the Workspaces list on Staging. M15 adds no migration. The Staging test calls deferred from M13 and the Staging voicemail transfer check deferred from M11 remain open.

#### Exit criteria

- The same Call dataset produces consistent metrics across Home, Workspace, and Calls.

### M16 - Reports and Recording Exports

- **Status:** Complete
- **Outcome:** Authorized users can request, monitor, and download scoped PDF, CSV, and Recording ZIP artifacts.
- **Depends on:** M15
- **Target environment:** Staging
- **Execution note:** Stored Recordings are dual-channel WAV, which the Worker cannot transcode, so a Trigger.dev ffmpeg task derives one stereo MP3 per Stored Recording in R2 alongside its waveform peaks, and the recovery sweep backfills Recordings Stored before M16; the MP3 expires with the Recording, and M17 purges it with the WAV and peaks. Download MP3 streams that MP3 through the same Workspace authorization and media expiry as the M11 Recording route, on Call Detail and as the Calls row action M14 deferred. Export Call on Call Detail is a single-Call Recording ZIP built by the same export path, holding the MP3, its CSV manifest row, and the Transcript and Lead Assessment when present. Report and export jobs are visible only to their requester in Report history and the notification popover, and every download rechecks the requester's current access to every Workspace in the job's scope, so losing access to any one of them blocks the whole artifact. A Recording ZIP is limited to 500 retained Recordings; the export confirmation blocks a larger match and asks for narrower filters, and the ZIP streams to R2 through a multipart upload. The PDF is rendered in Trigger.dev with `@react-pdf/renderer` and embedded Geist, without a headless browser. A duplicate submission with the same requester and parameters returns the existing unexpired job. Generated artifacts expire through an R2 lifecycle rule on their prefix after 7 days, and a scheduled Trigger.dev task deletes job metadata after 90 days. That task runs every 6 hours, also marks a job still Queued or Generating 6 hours after its request as Failed so Retry is offered, and deletes a purged job's R2 objects first as a backup to the lifecycle rule; the rule was applied to `tracer-recordings-staging` on 2026-10-18 with Wrangler, and `scripts/configure-report-lifecycle.ts` applies the same rule idempotently, which M19 uses for Production. Every job's Calls are frozen at its request time, so generation matches the counts the confirmation showed, a report or export that matches no Calls is refused, and a ZIP with no retained Recordings is refused. A Calls export uses the Calls page's timezone, the account timezone on global Calls and the Workspace reporting timezone on Workspace Calls, and a global Calls export's scope is the Workspaces of the Calls it matches, so losing access to an unrelated Workspace does not block its download. Regenerate, which is also Retry for a Failed job, reproduces the original job's resolved window as a Custom Range rather than re-resolving a preset. The PDF uses light content pages after a dark cover so it prints well. The Recording ZIP stores MP3s without recompression in a ZIP64-capable archive that streams to R2 through a multipart upload, its `manifest.csv` lists every matched Call with whether its Recording was included or why it was omitted, and the report task allows one hour on a 1 GB machine. Download MP3 needs only a Stored MP3 and retained media, independent of waveform peaks. The CSV neutralizes spreadsheet formulas except plain E.164 numbers and starts with a UTF-8 byte-order mark for Excel.

#### Vertical slices

1. Define report scope for one or more accessible Workspaces.
2. Resolve Previous Week as Monday through Sunday and Previous Month as a completed calendar month.
3. Generate a branded PDF summary through Trigger.dev.
4. Generate complete CSV detail.
5. Generate a Recording ZIP with CSV manifest from current filters.
6. Authorize every download and expose job history.
7. Expire generated artifacts after seven days and metadata after ninety days.
8. Derive a stereo MP3 for each Stored Recording and backfill existing Recordings.
9. Download MP3 from Call Detail and the Calls row actions.
10. Export Call as a single-Call Recording ZIP.

#### Test-first behaviors

- Report generation rejects ungranted Workspaces.
- Multi-Workspace reports use the selected document timezone.
- PDF classification and CSV classification use Lead Review precedence.
- Expired or revoked artifacts cannot download.
- Missing or expired recordings are counted and omitted explicitly.
- Duplicate job submission uses one logical artifact set.

#### Deliverables

- Report request and artifact domains
- Trigger.dev PDF, CSV, and ZIP tasks
- Reports page and generation Dialog
- Report history and notification popover
- Sixth Playwright journey for report generation and download
- Precomputed Recording MP3, Download MP3, and Export Call
- Report lifecycle sweep and the `reports/` R2 lifecycle rule

#### Verification gate

- Domain, task, integration, authorization, and report Playwright tests pass.
- Generated files are inspected for expected metadata and representative content.
- Staging artifacts expire through the configured lifecycle path.

- The Product Owner marked M16 Complete on 2026-10-19 after the domain, task, integration, authorization, component, typecheck, lint, build, and Playwright gates passed locally and in the Verification workflow, including the report generation journey; the workflow's Staging gate applied migrations 0017 and 0018, reran the runtime grants, deployed `tracer-staging`, and passed the database smoke check; and the Product Owner verified Reports PDF and CSV, Calls Export CSV and Export Recordings, Export Call, Download MP3 with the MP3 backfill, and the notification popover on Staging using existing Staging Calls. The `report-artifacts` lifecycle rule is applied to `tracer-recordings-staging`; observing the first Staging artifacts expire after 7 days moves to M17, which owns lifecycle verification.

#### Exit criteria

- Reports and exports preserve authorization from request through download.
- Long-running generation never blocks a Worker request.

### M17 - Retention, Purge, and Lifecycle Automation

- **Status:** Deferred
- **Outcome:** Media, Transcript content, generated artifacts, and metadata expire or purge according to documented policy without corrupting analytics.
- **Depends on:** M16
- **Target environment:** Staging
- **Execution note:** Before M17, media expiry was only derived at read time, and no content was deleted. M17 deletes it for real. Expiry 12 months after Call start and Operator Purge Media remove the same content: the Recording WAV, waveform peaks, and MP3 in R2; the Transcript turns; the Lead Assessment evidence quotes; and the Lead Assessment rationale. The Lead Assessment summary, classification, score, and usage are kept, as are the Call, its facts and outcome, Recording metadata, Transcript and assessment usage and cost, the Lead Review, the Call event log, and analytics. When a Recording's audio may still be at Twilio because its transfer is Pending or Failed, purge and expiry stop the transfer and delete the Twilio copy, and the sweep retries that deletion until it succeeds. Purge Media also deletes unexpired Recording ZIP and Export Call artifacts that include the purged Recording and marks those jobs expired, so no downloadable copy remains. Staging demonstrates expiry with a script that seeds backdated fixture Calls rather than with a shortened retention setting.

#### Vertical slices

1. Identify Recording, waveform, Transcript, and evidence content at 12-month expiry.
2. Purge media early through an irreversible Operator action.
3. Preserve non-content Call metadata and analytics.
4. Expire report and export artifacts after seven days.
5. Remove job metadata after ninety days.
6. Retry partial lifecycle cleanup idempotently.

#### Test-first behaviors

- Expiry and purge remove exactly the documented content.
- Early purge requires current Operator authorization.
- Client Viewers cannot purge.
- Analytics remain stable after content removal.
- Repeated cleanup is safe.
- Partial cleanup can resume without restoring deleted content.

#### Deliverables

- Retention selection queries
- Trigger.dev scheduled cleanup tasks
- Purge Media AlertDialog and task
- Expired and purged UI states
- Lifecycle observability and failure recovery

#### Verification gate

- Domain, task, integration, and component tests pass.
- Staging uses shortened test fixtures to demonstrate each lifecycle safely.
- R2 and PostgreSQL state agree after cleanup.
- Staging report artifacts generated during M16 verification are confirmed expired by the `report-artifacts` R2 lifecycle rule.

- On 2026-10-19 the Product Owner had M17 merged to `main` while it was still In Progress. By then every slice was implemented, `verify:full` had passed locally, and the Verification workflow had passed. Two checks remained: the Product Owner's Staging demonstration with `pnpm fixtures:retention`, which covers purge, expiry, and R2 and PostgreSQL agreement; and confirmation that the M16 Staging report artifacts expired through the `report-artifacts` rule, which is due around 2026-10-25.
- On 2026-10-20 the Product Owner deferred M17 so that Phase 7 could start. Its code is complete and merged; the two remaining Staging checks moved into the M18 entry criteria, where they are performed before Production hardening begins. Nothing in M17 is reopened for implementation.

#### Exit criteria

- Every retained content type has one tested creation and deletion path.

## Phase 7 - Business HQ

Phase 7 turns Tracer from a call-tracking application into the operating console for every rank-and-rent website Spurlock Labs runs. Each Business HQ domain is its own vertical milestone: the website and its hosting (M20), its search rankings (M21), and what it costs and earns (M22). Form submissions joined the phase as M23 on 2026-10-21. Later domains such as SMS and Business Profile follow the same intake rules after M19. The Product Owner's stress-tested decisions for this phase are recorded in `docs/CHANGELOG.md` under 2026-10-20.

### M20 - Sites and Cloudflare Connection

- **Status:** Complete
- **Outcome:** An Operator connects the Organization's Cloudflare account on Integrations, links one Site to a Workspace from the wizard or Workspace Settings, and everyone with access sees that Site's preview, traffic, performance, health, and uptime inside the Workspace, with the application shell restructured around a Workspace-scoped sidebar that later domains extend.
- **Depends on:** M17
- **Target environment:** Preview and Staging
- **Execution note:** A Site is a Cloudflare Worker on the connected account that serves at least one custom domain; `tracer` and `tracer-staging` have none and are never Sites. The Cloudflare connection is an Account ID plus a scoped API token (Workers Scripts Read, Workers Custom Domains Read, Account Analytics Read, Browser Rendering Edit) encrypted with the same master key and envelope as the Twilio credentials, verified with the token-verify endpoint on connect and Test, and read by the Worker and by Trigger.dev tasks alike; nothing Cloudflare-related lives in `.env` or Worker secrets besides the master key. Cloudflare has no third-party OAuth, so Connect is a token form with a link to Cloudflare's token page. A Site Link is the period during which one Site is linked to one Workspace, mirroring Number Assignment: at most one open Site Link per Workspace and per Site, ended on replace, detach, or archive, never touching Cloudflare. Traffic is synced, not proxied: the `site-sync` scheduled task runs hourly, pulls every connected Site's per-day Web Analytics (visits, page views, top paths, referrers, device split, Core Web Vitals p75) and Worker invocation counts and errors for today and yesterday into `site_metric_day` through the GraphQL Analytics API, records the Worker's deployments into `site_deployment`, fetches the apex URL and records status and response time into `site_check`, and backfills 30 days when a Site is first seen. The preview is a 1280 by 800 JPEG from the Browser Rendering screenshot endpoint stored in R2 under `sites/{siteId}/preview-{versionId}.jpg`, captured by the `site-preview` task when the sync sees a new live deployment, by the daily sweep, and on the Operator's Refresh Preview, and served through a Workspace-authorized route like Recording media. Site health is derived at read time from the stored rows: Down after two consecutive failed checks; Warning when a hostname's certificate is not active, Worker errors exceed 5 percent of requests over the last 24 hours, or a Site that had visits in the prior 7 days has had none for 48 hours; Healthy otherwise; and Unknown before the first sync. Health shows on the Workspaces grid Integration health column, the Site page header, Workspace Overview, and the Cloudflare card on Integrations. Visit-to-Call is Calls divided by visits over the same range and is the first funnel number in the product. Client Viewers see the Site page read-only without the Hosting panel, deployments, Worker errors, or any Cloudflare identifier. The shell change: the Sidebar inside a Workspace swaps its navigation for that Workspace's pages grouped by domain (Overview; Website: Site; Phone: Calls, Flow; Reports; Settings) with an All Workspaces link at the top, replacing the Workspace tabs; outside a Workspace the global navigation is unchanged. The prototype that settled this (three shells on the Workspace route) is kept as a patch outside `main`; the Product Owner chose the Workspace sidebar from variant B with the scorecard row from variant C.

#### Vertical slices

1. Connect, test, rotate, and disconnect Cloudflare on Integrations with encrypted credentials and the connection shown in provider health.
2. List Sites from the connected account with their hostnames, last deployment, and link state, and show them on the Cloudflare card.
3. Link a Site to a Workspace from a Site step in the Create Workspace wizard and from a Site section in Workspace Settings; replace and detach end the Site Link.
4. Sync per-day traffic, deployments, and uptime checks hourly in Trigger.dev with a 30-day backfill on first sight.
5. Capture and serve the Site preview on new deployments, daily, and on Refresh Preview.
6. Render the Site page with preview, facts, Visits, Page Views, Calls, and Visit-to-Call, the traffic and Calls chart, Top pages, Referrers, Performance, and the Operator-only Hosting panel.
7. Derive Site health and show it on the Workspaces grid, Site page, Workspace Overview, and Integrations.
8. Replace the Workspace tabs with the Workspace-scoped Sidebar and add a Site summary panel to Workspace Overview.

#### Test-first behaviors

- Cloudflare credentials are stored encrypted, verified on connect, and never returned in any response.
- Only Workers with at least one custom domain are Sites, and Sites are scoped to the Organization that connected the account.
- A Workspace has at most one open Site Link and a Site is linked to at most one Workspace at a time.
- Replace and detach end the open Site Link without a Cloudflare write.
- Hourly sync is idempotent per Site and day, and the first sync of a Site backfills 30 days.
- Health follows the documented rules from stored checks, metrics, and hostnames.
- Visit-to-Call divides Calls by visits over the same resolved range and timezone.
- Client Viewers never receive hosting data or Cloudflare identifiers.
- The preview route rechecks Workspace authorization on every request.
- Inside a Workspace the Sidebar shows that Workspace's pages and hides Flow and Settings from Client Viewers.

#### Deliverables

- `cloudflare_connection`, `site`, `site_hostname`, `site_link`, `site_metric_day`, `site_deployment`, `site_check`, and `site_preview` tables with runtime grants
- Cloudflare REST and GraphQL client with contract fixtures
- `site-sync` hourly and `site-preview` tasks
- Site page, Site step, Site settings section, Site summary panel, Workspace Sidebar
- Integrations Cloudflare card and Workspaces grid health

#### Verification gate

- Domain, contract, task, integration, and component tests pass.
- Playwright covers connecting Cloudflare with the fake, linking a Site in the wizard, and opening the Site page as an Operator and a Client Viewer.
- Staging shows the six live Sites with real previews and traffic.

#### Exit criteria

- One Workspace on Staging is linked to a live Site and its Site page shows a preview captured by Browser Rendering, traffic synced from Web Analytics, and an uptime check.
- The Workspace Sidebar replaces the tabs on every Workspace page, and the Playwright journeys pass with it.

#### Completion note

M20 closed on 2026-10-20 after the domain, contract, task, integration, component, Worker, typecheck, lint, build, and Playwright gates passed. Playwright covers connecting Cloudflare with the fake, linking a Site in the wizard, skipping the Site step, and opening the Site page as an Operator and as a Client Viewer, and every Workspace journey passes with the Workspace Sidebar. The close-out added the newest ten deployments and 30-day uptime with the median response time to the Site read model and the Site page, kept the health reason in the Client Viewer response, and bounded the Site picker list so the wizard footer stays inside short viewports. The Staging demonstration with real Cloudflare credentials, the six live Sites with real previews and traffic and one linked Workspace showing a Browser Rendering preview, Web Analytics traffic, and an uptime check, is still to be performed by the Product Owner after deployment to Staging.

### M21 - Search Rankings

- **Status:** Complete
- **Outcome:** Each Site tracks a weighted keyword set from its Service Area, and Operators and Client Viewers see a Search Visibility score, its 30-day trend, per-keyword positions, and the pages that outrank the Site.
- **Depends on:** M20
- **Target environment:** Preview and Staging
- **Execution note:** Rankings come from DataForSEO's Google organic SERP endpoint, connected on Integrations as its own provider (API login and password encrypted like Cloudflare). No Google account is involved and Tracer never scrapes Google: a SERP vendor has no tie to the Site and is the only source of location-specific results. Each Site gets a Service Area (city, region, country, prefilled from the hostname when possible and editable) and Keywords, each with a phrase and a weight from 1 to 5, default 1. The daily `rank-check` task queries every Keyword of every linked Site from its Service Area, stores the position (1 to 100 or Not Ranking), the ranking URL, and the top ten results with their domains into `keyword_rank_day`, and never exceeds one lookup per Keyword per day. Search Visibility is a 0 to 100 score: each position maps to a click-through curve (1 is 100, 2 is 60, 3 is 45, 4 is 35, 5 is 25, 6 to 10 taper to 10, 11 to 20 are 3, beyond 20 and Not Ranking are 0), multiplied by its weight, summed, and divided by the total weight. The Site page gains a Search panel with the score, a 30-day sparkline, and the keyword table with position and 7-day change; Workspace Overview's scorecard shows the score. Expected spend is a few dollars a month at seven Sites and fifteen Keywords each; the Integrations card shows lookups this month.

#### Vertical slices

1. Connect, test, rotate, and disconnect DataForSEO on Integrations.
2. Edit a Site's Service Area and Keywords in Workspace Settings.
3. Check every Keyword daily and store positions and top results.
4. Compute Search Visibility and its trend.
5. Render the Search panel and the Overview scorecard value.

#### Test-first behaviors

- Keyword phrases are unique per Site, weights stay within 1 to 5, and at most 25 Keywords exist per Site.
- The daily check is idempotent per Keyword and day and stops when the provider is not connected.
- Search Visibility matches the documented curve and weighting, and an empty Keyword set yields no score rather than zero.
- Client Viewers read Search results but cannot edit Keywords.

#### Deliverables

- `dataforseo_connection`, `site_keyword`, and `keyword_rank_day` tables with runtime grants
- DataForSEO client with contract fixtures and the `rank-check` daily task
- Search panel, Keywords settings, Integrations card

#### Verification gate

- Domain, contract, task, integration, and component tests pass.
- Staging checks the live Pocatello Site's Keywords once and shows the score.

#### Exit criteria

- A Staging Site shows a Search Visibility score computed from real DataForSEO positions.

M21 closed on 2026-10-20 after the domain, contract, integration, task, component, typecheck, lint, build, and Playwright gates passed. It delivered the DataForSEO connection on Integrations with its lookups this month and Keywords tracked, the Service Area and Keywords editors in Site settings, the daily `rank-check` task with one lookup per Keyword per day, the `keyword_rank_day` history with the top ten results, the Search Visibility read model with its 30-day trend and 7-day change, the Search panel beside Performance on the Site page, and the Search Visibility tile on the Workspace Overview scorecard. Playwright covers connecting DataForSEO with the fake, setting a Service Area and two Keywords, running the check through the E2E-only check route, and reading the score on the Site page and the Overview. Keyword edits are scoped to the linked Site rather than the Organization so a Keyword id from another Site answers Not Found. The Staging check of the live Pocatello Site's Keywords with real DataForSEO credentials is still to be performed by the Product Owner after deployment to Staging.

### M22 - Cost and Revenue

- **Status:** Complete
- **Outcome:** Home and every Workspace show what each website costs per month and year, what its Deal earns, and the resulting profit, so the Product Owner can see whether the rank-and-rent model is paying.
- **Depends on:** M21
- **Target environment:** Preview and Staging
- **Execution note:** Prices come from a maintained rate table in `data/pricing.ts`, not provider billing APIs: Twilio number rental, inbound and forwarded minutes, recording minutes, Workers Paid, R2 storage, DataForSEO per lookup, and OpenAI per-token rates for usage rows that lack a stored cost. A Workspace's monthly cost is Telephony (rental plus minutes from Calls and Recordings), Processing (Transcript and Lead Assessment usage), Hosting (an even share of Workers Paid and R2 across Active Workspaces), Search (lookups), and Domain (the Site's annual renewal, entered by hand with registrar and renewal date, amortized monthly). A Deal is a Workspace's agreement with its business: Monthly, Weekly, or Per Lead with an amount, a start date, and an optional end date, at most one open Deal per Workspace. Projected monthly revenue is the amount for Monthly, amount times 52 over 12 for Weekly, and amount times Good Leads in the month for Per Lead; profit is revenue minus cost, and Cost per Good Lead is cost divided by Good Leads. Home gets Monthly Cost (with the yearly projection beneath), Monthly Revenue, and Profit tiles and a cost and revenue column pair in Workspace performance; Workspace Overview's scorecard shows Visits, Calls, Visit-to-Call, Search Visibility, Monthly Cost, and Profit; the Site page gets a Deal and cost panel; a Pricing guide page explains every rate with a worked two-hour Call. Stripe reconciliation of real payments is a backlog connection, not part of M22.

#### Vertical slices

1. Maintain the rate table and compute Telephony, Processing, Hosting, Search, and Domain cost per Workspace and month.
2. Enter the Site's Domain renewal in Workspace Settings.
3. Create, edit, and end a Deal per Workspace.
4. Project revenue, profit, and Cost per Good Lead.
5. Render the Home tiles and columns, the Overview scorecard, the Site Deal and cost panel, and the Pricing guide.

#### Test-first behaviors

- Cost is computed from persisted usage and the rate table and reproduces the worked example.
- Shared costs are split evenly across Active Workspaces only.
- At most one open Deal per Workspace, and Per Lead revenue follows Good Leads with Lead Review precedence.
- Client Viewers never see cost, Deals, or profit.

#### Deliverables

- `deal` table and Site domain renewal columns with runtime grants
- Cost and revenue query service shared by Home, Overview, and the Site page
- Pricing guide page

#### Verification gate

- Domain, integration, and component tests pass.
- Staging shows cost and profit for the linked Workspace.

#### Exit criteria

- Home shows Monthly Cost, Monthly Revenue, and Profit across Staging Workspaces, and the numbers reconcile with the rate table by hand.

M22 closed on 2026-10-20 after the domain, integration, component, typecheck, lint, build, and Playwright gates passed. It delivered the maintained rate table in `data/pricing.ts` with the date its prices were checked, the `deal` table with at most one open Deal per Workspace and the Site's Domain renewal columns, the Deal routes and the Domain renewal route under the Workspace handler (Operator only, 403 for Client Viewers), the cost and revenue service that prices each Workspace's calendar month from persisted usage (Telephony, Processing, Hosting split evenly across Active Workspaces, Search, and Domain) and projects Monthly, Weekly, and Per Lead revenue with Lead Review precedence, the Home Money row with the yearly projection and the Cost and Revenue columns, the Overview Monthly Cost and Profit tiles, the Site Deal and cost panel with Add, Edit, and End Deal, the Domain renewal and Deal editors in Site settings, and the Pricing guide with the worked two-hour Call ($4.44: 120 inbound, forwarded, and Recording minutes, 240 transcribed channel minutes, and one Lead Assessment). Revenue follows the Deal that is open now, so past months are priced against the current Deal rather than the one open then. Playwright covers adding a Monthly Deal, reading Monthly Cost, Monthly Revenue, and Profit on Home and the Overview as an Operator, and a Client Viewer seeing none of them. The Staging reconciliation by hand, Home's cost and profit across the Staging Workspaces checked against the rate table, is still to be performed by the Product Owner after deployment to Staging.

### M23 - Form Submissions

- **Status:** Complete
- **Outcome:** Every contact form on a rank-and-rent Site posts to Tracer instead of emailing the business directly, so each Form Submission is stored under its Workspace, forwarded by Tracer to the business from the Site's own address, counted beside Good Lead Calls as the Workspace's Leads, and reviewable by an Operator.
- **Depends on:** M22
- **Target environment:** Preview and Staging
- **Execution note:** The Site Worker keeps its own validation and honeypot and replaces its email send with `POST /api/forms` carrying the Organization's one Forms key as a bearer token, its own hostname, and a submission id it minted, so a retried request is idempotent. One key for every Site was the Product Owner's call on 2026-10-21 over a key per Site: adding a city then needs no new secret, the site repository passes the key to every Worker at deploy time, and a leaked key can do no more than a spam bot already can, which the hold rule and review absorb. Tracer finds the Organization by the SHA-256 hash of the key, the Site by its primary or `www` hostname, follows the Site's open Site Link to the Workspace, and refuses with 401 for an unknown key, 404 for a hostname that is not a Site, 409 for a Site with no open Site Link (nothing is stored; the Site shows its existing error asking the customer to call), and 400 for a submission without a name or any contact. A stored Form Submission keeps the normalized name, phone, and email plus every field as submitted, so Sites in different verticals can post different fields. The same person (same phone or email) may submit twice within 24 hours and both are forwarded; the third and later are Held: stored, not forwarded, and not counted until an Operator approves (forwards and counts) or rejects (never forwarded, reviewed as Not Good Lead). Tracer forwards from the Worker through the Cloudflare Email Service binding, because Trigger.dev Cloud has no email binding, as `<Workspace name> <info@<Site primary hostname>>` with Reply-To the submitter, to the Workspace's forwarding recipients kept in Workspace Settings; a submission with no recipients is stored as Not forwarded, a provider failure as Forward failed with the provider's reason, and both offer Resend. Sending from the Site's domain works because the Sites and Tracer share one Cloudflare account where each Site domain is onboarded to Email Sending; the coupling is contained so a domain that is not onboarded shows as Forward failed, Tracer's binding carries no per-Site sender lists, and the Site knows nothing about Tracer beyond the URL and its key. Every unheld submission is a Good Lead by default; an Operator review (Good Lead, Not Good Lead, Uncertain) takes precedence, mirroring the Call rule. Good Leads on Home, the Workspace Overview, the Workspaces list, the trend chart, Workspace performance, and Per Lead revenue count Good Lead Calls and Good Lead Form Submissions together. The Forms page is the Website group's second item in the Workspace Sidebar; Client Viewers read it without the Form key or Operator actions. Because reports share the analytics aggregate, their Good Leads total also counts Form Submissions, but a Form Submissions section in the PDF and CSV, Activity entries, and Turnstile on the Sites stay out of scope. The Sites post to the Staging Worker until M19 switches them to Production. The logic prototype that settled the model (one HTML file with the pure reducer) is kept on the `prototype/form-submissions` branch.

#### Vertical slices

1. Store a Form Submission from a Site's POST with key, Site Link, validation, idempotency, and the hold rule.
2. Forward from the Site's address to the Workspace's recipients, record the result, and Resend.
3. Approve, reject, and review submissions; combine Good Leads with Calls in analytics and revenue.
4. Generate and revoke the Organization's Forms key on Integrations and edit forwarding recipients in Workspace Settings.
5. Render the Workspace Forms page and enable Forms in the Sidebar.

#### Test-first behaviors

- An unknown key, an unlinked Site, and a contactless submission are refused without a row; a repeated submission id returns the existing row and sends no second email.
- The third submission from one person within 24 hours is Held until approved or rejected, and only Good Lead submissions count toward Leads and Per Lead revenue.
- Forwarding records Sent, Not configured, or Failed with the provider's reason, and Resend retries.
- A Client Viewer reads submissions but cannot approve, reject, review, resend, or edit recipients, and only Operators reach the Forms key on Integrations.

#### Deliverables

- `form_submission` table, the Organization Forms key hash, and Workspace forwarding recipients with runtime grants
- `POST /api/forms` public route and the Workspace Forms routes
- Combined Good Leads in the analytics and cost and revenue services
- Workspace Forms page and Settings editors
- The Site repository's `lead.ts` posting to Tracer

#### Verification gate

- Domain, integration, component, typecheck, lint, and build gates pass.
- Staging receives a real submission from the Pocatello Site and forwards it.

#### Exit criteria

- A submission on a linked Site appears on its Workspace Forms page, reaches the forwarding recipients from the Site's address, and raises Good Leads on Home and the Overview.

M23 closed on 2026-10-21 after the domain, contract, integration, component, Worker, typecheck, lint, build, and Playwright gates passed in CI and the Staging deployment applied migration 0025. The Product Owner verified the Staging gate the same day: a real submission from the Pocatello Site reached its Workspace Forms page and the forwarding recipients. The close-out renamed the dashboard chart from Call trends to Leads generated and added a fourth series, Forms, counting every Form Submission received per bucket beside Total Calls, Answered Calls, and the combined Good Leads; the PDF report keeps its three series. The asphalt, solar, and dumpster site repositories post to the Staging Worker until M19 switches them to Production.

## Phase 8 - Deployment and operation

### M18 - Production Hardening and Acceptance

- **Status:** Not Started
- **Outcome:** The complete first release passes security, reliability, accessibility, cost, and operational acceptance in Staging.
- **Depends on:** M23
- **Target environment:** Staging
- **Entry criteria carried from M17:** the Product Owner's Staging retention demonstration with `pnpm fixtures:retention`, and confirmation that the M16 Staging report artifacts expired through the `report-artifacts` rule.

#### Vertical slices

1. Complete and cross-reference every domain behavior matrix row.
2. Exercise duplicate webhook and task delivery under failure injection.
3. Exercise provider outage and retry behavior.
4. Verify authorization across every page, API, media, and artifact boundary.
5. Verify responsive, keyboard, focus, contrast, and reduced-motion behavior.
6. Establish measured coverage baselines and decide whether evidence supports percentage gates.
7. Measure representative cost per connected Call and per Workspace.
8. Rehearse migration, deployment, rollback, credential rotation, and incident procedures.

#### Required acceptance

- All six Playwright journeys pass against Staging provider fakes or approved test resources.
- Live smoke tests pass for Twilio, R2, OpenAI, Trigger.dev, Hyperdrive, and Cloudflare Email Service.
- No unresolved critical or high security finding remains.
- No required check is skipped without Product Owner approval.
- Observability identifies failed webhooks, tasks, transfers, analysis, reports, retention, and emails.
- Backup and restore procedures are documented and exercised.

#### Verification gate

- `verify:full` passes.
- Staging migrations and rollback rehearsal pass.
- Production bindings and secrets are validated by name and presence without revealing values.
- Product Owner completes acceptance of the documented first-release scope.

#### Exit criteria

- A production go or no-go decision can be made from evidence rather than assumption.
- Rollback criteria and responsible actions are explicit.

### M19 - Production Deployment and Stabilization

- **Status:** Not Started
- **Outcome:** Tracer is deployed to Production through a controlled promotion and remains stable through the initial observation period.
- **Depends on:** M18
- **Target environment:** Production

#### Deployment sequence

1. Freeze roadmap scope for the deployment.
2. Confirm `verify:full` and Staging acceptance evidence.
3. Confirm backup, migration, rollback, secrets, and bindings.
   Apply the `report-artifacts` R2 lifecycle rule to `tracer-recordings-production` with `scripts/configure-report-lifecycle.ts`, as M16 applied it to `tracer-recordings-staging`.
4. Apply Production migrations through the documented path.
5. Deploy the Cloudflare Worker application.
6. Deploy the matching Trigger.dev task version.
7. Run read-only health checks.
8. Run approved live smoke checks with the dedicated rollout procedure.
9. Confirm authentication, authorization, inbound call, Recording transfer, analysis, reporting, and retention scheduling.
10. Record the deployment under a dated heading in `docs/CHANGELOG.md` and recreate `Unreleased`.

#### Stabilization checks

- Monitor webhook rejection and failure rates.
- Monitor Trigger.dev queue depth, retries, and failed runs.
- Monitor R2 transfer and cleanup consistency.
- Monitor PostgreSQL errors, latency, and connection behavior.
- Monitor OpenAI usage and analysis failures.
- Monitor email delivery, queueing, and permanent bounces.
- Monitor cost per connected Call and per active Workspace.
- Roll back when documented failure thresholds are reached.

#### Verification gate

- Production smoke checks pass.
- No migration or task-version mismatch exists.
- No authorization boundary differs from Staging.
- Deployment and any corrective action are recorded in the Changelog.

#### Exit criteria

- Tracer serves the first-release scope in Production.
- Operational owners can detect, diagnose, and recover from documented failure modes.
- The roadmap Current state identifies the next approved post-launch milestone or states that no milestone is active.

## Unscheduled backlog

- Google sign-in for provisioned identities, deferred until email-code usage demonstrates a need for another authentication method.
- Stripe connection to reconcile real payments against each Workspace's Deal, after M22 ships projected revenue.
- Site deployment Rollback to the previous version from the Hosting panel, Operator only, with the Archive confirmation pattern.
- Site traffic and Search Visibility sections in the generated PDF report.
- Form submissions from the Sites posted to Tracer instead of email, SMS handling, and Google Business Profile tracking, as later Business HQ milestones.
- Small fixes found during the M17 full verification, none blocking:
  - `components/tracer/workspaces-view.tsx:436` assigns `canActivate` but never uses it.
  - The Workspaces DataGrid renders a Base UI `Button` with `nativeButton` on a non-button element. This logs 34 accessibility warnings during the Playwright run.

## Post-launch roadmap intake

New work after M19 does not enter implementation directly.

1. Describe the user or operational problem.
2. Resolve domain terminology in `CONTEXT.md` when needed.
3. Resolve page or interaction impact in `DESIGN.md` when needed.
4. Resolve architecture and testing impact in `README.md`.
5. Add a new vertical milestone with dependencies, test-first behaviors, verification gate, and exit criteria.
6. Record the addition under `Unreleased` in `docs/CHANGELOG.md`.
7. Start it only when no other milestone is In Progress.

Examples of post-launch candidates currently outside first-release scope include multiple Organizations in the UI, customer-owned Twilio accounts, international numbers, multilingual processing, audio prompt uploads, scheduled report email, configurable retention, and additional Call Flow node types.
