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
- **Next milestone:** M1 - Verified Application Skeleton
- **Current environment:** Documentation only
- **Production status:** Not deployed
- **Last roadmap review:** 2026-10-12

No implementation milestone is In Progress until an agent or contributor explicitly starts M1 and updates this section and `docs/CHANGELOG.md`.

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
- Trigger.dev Staging environment
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
| M1 | Verified Application Skeleton | Not Started | Local and Preview | M0 |
| M2 | Data Platform and Environment Isolation | Not Started | Local, Preview, and Staging | M1 |
| M3 | Provisioned Authentication and Organization Bootstrap | Not Started | Local and Preview | M2 |
| M4 | Operator Administration and Application Shell | Not Started | Local and Preview | M3 |
| M5 | Organization Integrations and Twilio Connection | Not Started | Staging | M4 |
| M6 | Workspace Setup | Not Started | Preview and Staging | M5 |
| M7 | Call Flow Publication and Workspace Activation | Not Started | Preview and Staging | M6 |
| M8 | Workspace Access Grants | Not Started | Preview and Staging | M7 |
| M9 | Minimal Inbound Call Tracer Bullet | Not Started | Staging | M8 |
| M10 | Complete First-Release Call Routing | Not Started | Staging | M9 |
| M11 | Durable Recording Transfer | Not Started | Staging | M10 |
| M12 | Waveform Playback and Call Detail | Not Started | Preview and Staging | M11 |
| M13 | Transcript, Lead Assessment, and Lead Review | Not Started | Staging | M12 |
| M14 | Calls and Activity Operations | Not Started | Preview and Staging | M13 |
| M15 | Dashboard and Workspace Analytics | Not Started | Preview and Staging | M14 |
| M16 | Reports and Recording Exports | Not Started | Staging | M15 |
| M17 | Retention, Purge, and Lifecycle Automation | Not Started | Staging | M16 |
| M18 | Production Hardening and Acceptance | Not Started | Staging | M17 |
| M19 | Production Deployment and Stabilization | Not Started | Production | M18 |

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

- **Status:** Not Started
- **Outcome:** A minimal Next.js application runs locally and in Preview with the final styling foundations and fast verification commands.
- **Depends on:** M0
- **Target environment:** Local and Preview

#### Vertical slices

1. Render a health page through the Cloudflare-compatible Next.js runtime.
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

- **Status:** Not Started
- **Outcome:** Tracer can migrate and query isolated PostgreSQL environments through the production-compatible data path.
- **Depends on:** M1
- **Target environment:** Local, Preview, and Staging

#### Vertical slices

1. Prove a Drizzle migration against Testcontainers PostgreSQL.
2. Read and write a minimal application record through a public repository interface.
3. Connect Staging to Neon through Hyperdrive using a least-privilege role.
4. Prove Preview and Staging cannot access Production data or bindings.

#### Test-first behaviors

- A clean database reaches the latest schema through migrations.
- Applying migrations twice is safe or fails with the expected migration-tool behavior.
- Repository behavior is identical through Testcontainers and Staging Hyperdrive paths.
- An environment cannot resolve another environment's tenant data or object bindings.

#### Deliverables

- Neon projects or branches for Staging and Production
- Hyperdrive configuration per environment
- Drizzle schema and migration workflow
- Dedicated migration connection outside the Worker runtime
- Testcontainers PostgreSQL harness with container reuse
- Environment binding inventory without secret values
- Migration rollback or forward-recovery procedure

#### Verification gate

- `test:integration`, `typecheck`, `lint`, and `build` pass.
- Migrations succeed from an empty database in Local and Staging.
- Staging read and write smoke checks pass through Hyperdrive.

#### Exit criteria

- Schema changes have one documented path from Local through Production.
- Staging is isolated from Production at the database and binding levels.

## Phase 2 - Identity and authorization

### M3 - Provisioned Authentication and Organization Bootstrap

- **Status:** Not Started
- **Outcome:** The initial Operator can bootstrap Spurlock Labs and sign in only through approved passwordless methods.
- **Depends on:** M2
- **Target environment:** Local and Preview

#### Vertical slices

1. Bootstrap one Organization and one provisioned Operator through a one-time command.
2. Sign in a provisioned user with an email verification code.
3. Sign in a provisioned user through Google OAuth.
4. Reject unprovisioned and Disabled identities without account enumeration.
5. View and revoke sessions in Account Settings.

#### Test-first behaviors

- Bootstrap creates exactly one Spurlock Labs Organization and initial Operator.
- Repeated bootstrap is safely rejected or idempotently reports the existing Organization.
- Email OTP and Google cannot create unprovisioned users.
- Disabled users cannot create sessions and existing sessions are revoked.
- Authentication errors do not reveal whether an email is provisioned.

#### Deliverables

- Better Auth with Organization and Email OTP plugins
- Google OAuth configuration
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

- **Status:** Not Started
- **Outcome:** Active Operators can manage other Operators through a secure application shell before Workspace and Client Viewer resources exist.
- **Depends on:** M3
- **Target environment:** Local and Preview

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

- **Status:** Not Started
- **Outcome:** An Operator can securely connect and verify the Organization's Twilio account while viewing provider health.
- **Depends on:** M4
- **Target environment:** Staging

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

- **Status:** Not Started
- **Outcome:** An Operator can create and manage a Setup Required Workspace without activating Twilio routing prematurely.
- **Depends on:** M5
- **Target environment:** Preview and Staging

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

- **Status:** Not Started
- **Outcome:** An Operator can finish setup, publish a valid initial Call Flow, activate one Tracking Number safely, and manage the resulting active Workspace lifecycle.
- **Depends on:** M6
- **Target environment:** Preview and Staging

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

- **Status:** Not Started
- **Outcome:** An Operator can grant a Client Viewer explicit read access to an Active Workspace without exposing any ungranted Workspace.
- **Depends on:** M7
- **Target environment:** Preview and Staging

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

- **Status:** Not Started
- **Outcome:** One real Staging inbound call travels through Tracer, forwards to the Destination Number, and persists a canonical Call lifecycle.
- **Depends on:** M8
- **Target environment:** Staging

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
- Signature validation
- Minimal constrained TwiML renderer
- Call lifecycle and provider-event persistence
- Tracking Number replacement flow in Workspace Settings
- Contract fixtures for voice and status callbacks
- Staging smoke script for the dedicated number

#### Verification gate

- Domain, contract, Worker, and integration tests pass.
- One real Staging call is answered and one non-answer outcome is observed.
- Duplicate callback replay leaves state unchanged.
- Staging replaces the test number after a completed Call and verifies historical attribution.

#### Exit criteria

- The first end-to-end telephony path works without recording or AI dependencies.
- Failures are diagnosable from persisted state.

### M10 - Complete First-Release Call Routing

- **Status:** Not Started
- **Outcome:** Published flows execute Business Hours, Keypad Gate, Whisper, Forward Call, and Voicemail branches with the documented outcomes.
- **Depends on:** M9
- **Target environment:** Staging

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
- Provider costs from branch smoke checks are recorded.

#### Exit criteria

- Every supported Flow node executes through a public, tested boundary.
- Every graph path produces a canonical outcome or a recoverable failure.

## Phase 5 - Media and intelligence

### M11 - Durable Recording Transfer

- **Status:** Not Started
- **Outcome:** Connected recordings and voicemail audio move durably from Twilio to private R2 through idempotent Trigger.dev workflows.
- **Depends on:** M10
- **Target environment:** Staging

#### Vertical slices

1. Accept and persist a signed Recording callback.
2. Trigger one idempotent Recording-processing run.
3. Download dual-channel or caller-only media from Twilio.
4. Upload the private object to R2 and verify size and checksum metadata.
5. Delete the Twilio copy only after verification.
6. Retry failed stages without duplicating objects or deleting the only valid copy.

#### Test-first behaviors

- Duplicate Recording callbacks trigger one logical workflow.
- Twilio media is never deleted before R2 verification.
- Retry after upload reuses or safely replaces the expected object.
- Partial failures preserve enough state for targeted recovery.
- Private objects cannot be accessed without current authorization.

#### Deliverables

- Trigger.dev Cloud configuration
- Recording transfer task and stage persistence
- R2 object-key and metadata policy
- Twilio cleanup operation
- Recording processing states
- Trigger.dev integration health in Integrations

#### Verification gate

- Task, contract, integration, and authorization tests pass.
- Staging proves one connected call and one voicemail transfer.
- Failure injection proves Twilio cleanup does not run early.

#### Exit criteria

- R2 is the authoritative durable media source.
- Recording transfer is safe under duplicate delivery and retry.

### M12 - Waveform Playback and Call Detail

- **Status:** Not Started
- **Outcome:** Authorized users can inspect a Call and play retained audio through an accessible interactive waveform.
- **Depends on:** M11
- **Target environment:** Preview and Staging

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

#### Exit criteria

- An authorized user can investigate retained audio without direct provider access.

### M13 - Transcript, Lead Assessment, and Lead Review

- **Status:** Not Started
- **Outcome:** Eligible recordings produce normalized English Transcripts and advisory Lead Assessments, while Operators can add a separate authoritative Lead Review.
- **Depends on:** M12
- **Target environment:** Staging

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

#### Exit criteria

- Eligible Calls progress independently through Transcript and Lead Assessment states.
- Human review never overwrites model output.

## Phase 6 - Operations and reporting

### M14 - Calls and Activity Operations

- **Status:** Not Started
- **Outcome:** Users can search, filter, and investigate authorized Calls and follow expandable operational Activity.
- **Depends on:** M13
- **Target environment:** Preview and Staging

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

#### Exit criteria

- Calls and Activity are trustworthy operational views across authorized scope.

### M15 - Dashboard and Workspace Analytics

- **Status:** Not Started
- **Outcome:** Home and Workspace Overview present consistent, timezone-correct business and routing metrics.
- **Depends on:** M14
- **Target environment:** Preview and Staging

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

#### Exit criteria

- The same Call dataset produces consistent metrics across Home, Workspace, and Calls.

### M16 - Reports and Recording Exports

- **Status:** Not Started
- **Outcome:** Authorized users can request, monitor, and download scoped PDF, CSV, and Recording ZIP artifacts.
- **Depends on:** M15
- **Target environment:** Staging

#### Vertical slices

1. Define report scope for one or more accessible Workspaces.
2. Resolve Previous Week as Monday through Sunday and Previous Month as a completed calendar month.
3. Generate a branded PDF summary through Trigger.dev.
4. Generate complete CSV detail.
5. Generate a Recording ZIP with CSV manifest from current filters.
6. Authorize every download and expose job history.
7. Expire generated artifacts after seven days and metadata after ninety days.

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

#### Verification gate

- Domain, task, integration, authorization, and report Playwright tests pass.
- Generated files are inspected for expected metadata and representative content.
- Staging artifacts expire through the configured lifecycle path.

#### Exit criteria

- Reports and exports preserve authorization from request through download.
- Long-running generation never blocks a Worker request.

### M17 - Retention, Purge, and Lifecycle Automation

- **Status:** Not Started
- **Outcome:** Media, Transcript content, generated artifacts, and metadata expire or purge according to documented policy without corrupting analytics.
- **Depends on:** M16
- **Target environment:** Staging

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

#### Exit criteria

- Every retained content type has one tested creation and deletion path.

## Phase 7 - Deployment and operation

### M18 - Production Hardening and Acceptance

- **Status:** Not Started
- **Outcome:** The complete first release passes security, reliability, accessibility, cost, and operational acceptance in Staging.
- **Depends on:** M17
- **Target environment:** Staging

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
