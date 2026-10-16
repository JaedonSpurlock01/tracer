# Changelog

This document records Tracer's project evolution from ideation through production operation. It tracks substantive roadmap changes, resolved product or architecture decisions, milestone starts and completions, scope changes, security decisions, and deployments.

Routine code changes, typo fixes, formatting changes, and implementation details remain in Git history.

## Update protocol

### Add an entry when

- A roadmap milestone starts, completes, becomes Blocked, or is Deferred.
- Milestone scope, order, dependency, risk, verification gate, or exit criteria changes.
- Product, domain, design, architecture, security, testing, or environment decisions change.
- First-release scope is added, changed, or removed.
- Preview, Staging, or Production promotion changes the project's operational state.
- A Production deployment or rollback occurs.

### Do not add an entry for

- Routine implementation inside an unchanged milestone.
- Refactoring that does not change behavior, architecture, or roadmap status.
- Typo, formatting, or wording-only corrections.
- Generated dependency-lock changes without a substantive dependency decision.

### Categories

- **Added:** New approved scope, milestone, capability, document, or environment
- **Changed:** A substantive change to an existing decision, scope, dependency, gate, or plan
- **Completed:** A milestone or major acceptance gate that met every exit criterion
- **Removed:** Scope or a milestone explicitly removed from the active plan
- **Security:** Security, privacy, authorization, secret-management, or incident changes
- **Deployment:** Environment promotions, Production deployments, rollbacks, and stabilization events

### Entry style

- Write one concise outcome per bullet.
- Reference the milestone ID when applicable.
- Explain why a plan changed, not every file changed.
- Use canonical terms from `CONTEXT.md`.
- Never include secrets, credentials, customer audio, Transcript content, caller numbers, or other sensitive data.

## Release process

All ongoing entries remain under `Unreleased`.

For a Production deployment:

1. Create a new heading using the deployment date in `YYYY-MM-DD` format.
2. Move the relevant `Unreleased` entries under that dated heading.
3. Add a Deployment entry with the promoted milestone and environment result.
4. Record any rollback or corrective deployment under the same date, or a new date when it occurs later.
5. Recreate an empty `Unreleased` section with the category headings needed for future changes.

Semantic versioning is deferred until Tracer exposes a separately supported external API or release line.

## Unreleased

### Added

- Added `docs/IMPLEMENTATION_ROADMAP.md` as the authoritative incremental path from ideation through Production.
- Added this project-evolution Changelog and its mandatory update protocol.
- Added a domain behavior matrix, layered verification policy, and stable verification-script contract to project planning.
- Added Local, Preview, Staging, and Production as the required environment promotion path.

### Changed

- Started M10 - Complete First-Release Call Routing for Business Hours, Keypad Gate, Whisper, and Voicemail execution, the Business Hours and override editor, text-to-speech prompt configuration, and the Workspace Overview Flow summary, carrying M9's live Staging call checks.
- Made voicemail capture independent of the Workspace recording setting, which now governs connected conversations only, because a caller who leaves a message consents by doing so; a Voicemail with no usable capture ends as Missed after a Forward Call Missed branch and Abandoned after Business Hours Closed, and Keypad Gate replays its prompt once before Blocked.
- Allowed a Business Hours window to end at 24:00 so overnight hours can be entered as one segment per calendar day, made a date override replace that date's weekly windows, and required every Whisper to lead directly to a Forward Call so it is heard only by the answering business.
- Moved M9's live Staging call checks into M10's verification gate because the Product Owner closed M9 before they ran; M10 cannot complete until a real answered and non-answer Call, callback replay, and number replacement are verified on Staging.
- Started M9 - Minimal Inbound Call Tracer Bullet for signed Twilio voice and status webhooks, idempotent Call lifecycle and provider-event persistence, the minimal constrained TwiML renderer, and Tracking Number replacement.
- Added an encrypted Twilio Auth Token to the Organization Twilio connection because Twilio signs webhooks with the Auth Token and the M5 API key credential cannot validate them, and refused Workspace activation until that Auth Token is configured so no live Tracking Number routes Calls Tracer cannot authenticate.
- Ended M9 Calls that reach a step deferred to M10 as Failed instead of skipping the step, rejected voice webhooks for inactive Number Assignments without creating a Call, and made Replace Number available for any Active Workspace rather than only after the first Call.
- Changed Tracking Number replacement failure handling to abort the replacement and keep the Workspace Active on its current Number Assignment instead of moving it to Setup Required, matching the M7 archive rule, because ending an assignment while Twilio still routes to it would leave inbound Calls unowned; replacement attaches the new number before restoring the old one so one number always routes to Tracer.
- Added a Sidebar account menu to M9 at the top of the Sidebar with a DiceBear avatar, the current Organization, a disabled New organization action, Account Settings, and Sign out, and removed the Sidebar Workspace switcher because the Workspaces page owns Workspace selection.
- Added Detach Number to M9: an Operator can end an Active Workspace's Number Assignment without a replacement, which restores the number's prior Twilio configuration and returns the Workspace to Setup Required, so its Access Grants authorize nothing until reactivation. It is named Detach rather than Release because Tracer never releases a number from Twilio.
- Split Workspace Settings into one page per section behind a vertical rail.
- Added server-rendered first data and full Link prefetching to Workspaces, Workspace Settings, Users, and Integrations so they open without Skeletons, with quiet background revalidation instead of a shorter experimental client-cache lifetime, and moved Workspaces search, state filter, and page into the URL.
- Started M8 - Workspace Access Grants for Access Grant persistence, Client Viewer provisioning and access instructions, the central Workspace authorization policy, safe role changes, and the Workspace Settings Access section.
- Restricted new Access Grants to Active Workspaces, kept existing grants as read-only access to Archived Workspaces and as dormant authorization after a restore to Setup Required, and refused removing a Client Viewer's last Access Grant so a Client Viewer always holds at least one grant.
- Started M7 - Call Flow Publication and Workspace Activation for the Number Assignment, Call Flow, and Flow Version domain modules, the completed Create Workspace wizard, the graph validator, the React Flow editor, and the Twilio attachment and restoration boundaries.
- Changed the archive restoration failure rule: a failed Twilio restoration now aborts the archive and keeps the Workspace Active instead of moving it to Setup Required, because ending the Number Assignment while Twilio still routes to Tracer would leave inbound Calls unowned.
- Made the published Flow Version the source of truth for the Destination Number, spam gate, and whisper settings after publication, and refused enabling recording until the published version contains a Recording Disclosure, so Workspace settings and the live graph cannot disagree.
- Added the non-production `E2E_TWILIO_FAKE` seam so the approved browser journeys exercise activation and publication without a live Twilio account.
- Started M6 - Workspace Setup for the Workspace and Workspace State domain modules, the Workspaces Data Grid, Setup Required Workspace creation, General settings, and archive and restore without any Twilio mutation.
- Started M5 - Organization Integrations and Twilio Connection for the encrypted Organization Twilio credential, number inventory synchronization, and the Operator Integrations page with isolated provider health.
- Scoped M5 number inventory to `+1` numbers without distinguishing United States from Canada, because Twilio's owned-number API does not report a country and a static area-code table or Lookup calls were not justified for the first release.
- Deferred R2, OpenAI, and Trigger.dev Test Connection actions to their owning milestones; M5 reports only Configured or Not configured for those providers from binding and secret presence.
- Started M4 - Operator Administration and Application Shell for the authenticated Sidebar shell, central Operator authorization, and Operator provisioning, disablement, and re-enablement.
- Started M3 - Provisioned Authentication and Organization Bootstrap for provisioned passwordless identity, Organization bootstrap, and session revocation.
- Deferred Google sign-in from M3 to the unscheduled backlog because email-code authentication meets current Operator needs.
- Started M1 - Verified Application Skeleton for the Local and Preview foundation.
- Blocked M1 completion until the `tracer` Cloudflare Worker exists and a trusted pull request passes the Preview deployment and `/health` smoke check.
- Started M2 - Data Platform and Environment Isolation after M1 passed its trusted Preview deployment gate.
- Revised M2 so Preview intentionally shares Staging data while separate Hyperdrive configurations keep both non-production paths isolated from Production.
- Selected OpenNext as the Cloudflare Workers adapter because Tracer requires standard Next.js runtime behavior while vinext remains beta.
- Replaced the coarse implementation sequence with small vertical milestones that each define dependencies, test-first behaviors, verification gates, and exit criteria.
- Sequenced Workspace setup before Call Flow publication and activation, then scheduled Client Viewer provisioning and Access Grants after an Active Workspace exists.
- Scheduled Tracking Number replacement after the first persisted Call so historical attribution can be verified.
- Required at most one roadmap milestone to be In Progress at a time.
- Required agents to update the roadmap and Changelog when substantive project state changes.

### Security

- Authorized every Client Viewer Workspace read through `data/workspace-authorization.ts` against current Access Grants on each request, so grant removal blocks an existing session's next read, and returned Not Found for ungranted Workspaces so they cannot be discovered (M8).
- Encrypted the Organization Twilio API key secret with AES-256-GCM under the `TWILIO_CREDENTIAL_MASTER_KEY` deployment secret, verified credentials before storage or rotation, and excluded secret material from every application response; see ADR 0005.

### Deployment

- Provisioned `TWILIO_CREDENTIAL_MASTER_KEY` for the `tracer` Worker, the `tracer-staging` Worker, and the Previews Base configuration; Preview and Staging share one value because they share the Staging database. The `tracer` Worker was created as an empty secret holder and remains undeployed.
- Applied migrations 0001 through 0004, runtime grants, and the initial Operator bootstrap to the Staging database through the `Bootstrap Authentication` workflow; Staging had carried only the M2 schema until this point.
- Added the `EMAIL` send binding to the `staging` Wrangler environment and provisioned the Staging and Preview authentication secrets after live checks showed every database-backed Staging route failing with `EMAIL is required`; Wrangler environments do not inherit top-level bindings or secrets.
- Deployed `tracer-staging` with the corrected bindings and verified anonymous route guards, generic OTP responses, and the Integrations API boundary live.
- Promoted M2's isolated Staging data path after direct migration and protected Hyperdrive read/write smoke checks passed.

### Completed

- Completed M10 - Complete First-Release Call Routing after the domain, contract, integration, Worker, component, browser, typecheck, lint, and build gates passed with migration 0011 adding pending Call Outcomes, voicemail capture, and the new provider event kinds. The Product Owner marked it Complete before the live Staging branch checks, carried M9 call checks, and provider cost recording ran, and will run them before merge.
- Completed M9 - Minimal Inbound Call Tracer Bullet after the domain, contract, integration, component, browser, typecheck, lint, build, and Staging database smoke gates passed with migrations 0008 through 0010 applied to Staging. The Product Owner waived the live Staging call gate (an answered and a non-answer call, signed callback replay, and number replacement with historical attribution); it moves to M10's Staging verification.
- Completed M8 - Workspace Access Grants after the domain, contract, integration, component, and Access Grant browser gates passed in a full-verification run on `main`, including direct-route, API denial, and revocation from an existing session, and migration 0007 with its `access_grant` runtime grants was confirmed in the Staging database.
- Completed M7 - Call Flow Publication and Workspace Activation after the domain, contract, integration, component, and Workspace and Flow browser gates passed and the Product Owner confirmed the live Staging attach, activate, archive, and restore check on the dedicated test number.
- Completed M0 - Planning and Governance Baseline.
- Completed M1 - Verified Application Skeleton after fast tests, typecheck, lint, build, Preview deployment, and the live `/health` smoke check passed.
- Completed M2 - Data Platform and Environment Isolation after the full verification, least-privilege, Preview, and live Staging gates passed.
- Completed M6 - Workspace Setup after the domain, integration, component, typecheck, lint, build, and migration idempotence gates passed and the Product Owner accepted Setup Required Workspace creation, General settings, archive, restore, and Resume Setup with no Twilio mutation; migration 0005 and the `workspace` runtime grant still need to be applied to Staging.
- Completed M5 - Organization Integrations and Twilio Connection after the fast, integration, Worker, typecheck, lint, build, and migration idempotence gates passed, the browser journey passed in GitHub Actions, and the live Twilio connection test and six-number inventory sync succeeded against the shared Staging database.
- Completed M4 - Operator Administration and Application Shell after the domain, contract, integration, component, and Worker suites, typecheck, lint, and build passed locally and the browser journey and Preview deployment gates passed in GitHub Actions.
- Completed M3 - Provisioned Authentication and Organization Bootstrap after the domain, contract, integration, component, and browser suites, Preview deployment, and local bootstrap, email-code sign-in, and session revocation gates passed; live Email Service delivery remains an external check.
