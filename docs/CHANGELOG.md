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

- Encrypted the Organization Twilio API key secret with AES-256-GCM under the `TWILIO_CREDENTIAL_MASTER_KEY` deployment secret, verified credentials before storage or rotation, and excluded secret material from every application response; see ADR 0005.

### Deployment

- Provisioned `TWILIO_CREDENTIAL_MASTER_KEY` for the `tracer` Worker, the `tracer-staging` Worker, and the Previews Base configuration; Preview and Staging share one value because they share the Staging database. The `tracer` Worker was created as an empty secret holder and remains undeployed.
- Applied migrations 0001 through 0004, runtime grants, and the initial Operator bootstrap to the Staging database through the `Bootstrap Authentication` workflow; Staging had carried only the M2 schema until this point.
- Added the `EMAIL` send binding to the `staging` Wrangler environment and provisioned the Staging and Preview authentication secrets after live checks showed every database-backed Staging route failing with `EMAIL is required`; Wrangler environments do not inherit top-level bindings or secrets.
- Deployed `tracer-staging` with the corrected bindings and verified anonymous route guards, generic OTP responses, and the Integrations API boundary live.
- Promoted M2's isolated Staging data path after direct migration and protected Hyperdrive read/write smoke checks passed.

### Completed

- Completed M0 - Planning and Governance Baseline.
- Completed M1 - Verified Application Skeleton after fast tests, typecheck, lint, build, Preview deployment, and the live `/health` smoke check passed.
- Completed M2 - Data Platform and Environment Isolation after the full verification, least-privilege, Preview, and live Staging gates passed.
- Completed M6 - Workspace Setup after the domain, integration, component, typecheck, lint, build, and migration idempotence gates passed and the Product Owner accepted Setup Required Workspace creation, General settings, archive, restore, and Resume Setup with no Twilio mutation; migration 0005 and the `workspace` runtime grant still need to be applied to Staging.
- Completed M5 - Organization Integrations and Twilio Connection after the fast, integration, Worker, typecheck, lint, build, and migration idempotence gates passed, the browser journey passed in GitHub Actions, and the live Twilio connection test and six-number inventory sync succeeded against the shared Staging database.
- Completed M4 - Operator Administration and Application Shell after the domain, contract, integration, component, and Worker suites, typecheck, lint, and build passed locally and the browser journey and Preview deployment gates passed in GitHub Actions.
- Completed M3 - Provisioned Authentication and Organization Bootstrap after the domain, contract, integration, component, and browser suites, Preview deployment, and local bootstrap, email-code sign-in, and session revocation gates passed; live Email Service delivery remains an external check.
