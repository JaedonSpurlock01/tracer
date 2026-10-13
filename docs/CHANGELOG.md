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

- Allowed explicit Local interactive development to use remote Staging bindings when Docker or local PostgreSQL is unavailable; default Local remains isolated.
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

### Deployment

- Promoted M2's isolated Staging data path after direct migration and protected Hyperdrive read/write smoke checks passed.

### Completed

- Completed M0 - Planning and Governance Baseline.
- Completed M1 - Verified Application Skeleton after fast tests, typecheck, lint, build, Preview deployment, and the live `/health` smoke check passed.
- Completed M2 - Data Platform and Environment Isolation after the full verification, least-privilege, Preview, and live Staging gates passed.
