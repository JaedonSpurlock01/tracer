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

- Added a projected monthly Workspace cost and pricing guide to the unscheduled backlog at the Product Owner's request, to show what a Workspace costs across numbers, call minutes, recording, storage, transcription, and hosting.
- Added `docs/IMPLEMENTATION_ROADMAP.md` as the authoritative incremental path from ideation through Production.
- Added this project-evolution Changelog and its mandatory update protocol.
- Added a domain behavior matrix, layered verification policy, and stable verification-script contract to project planning.
- Added Local, Preview, Staging, and Production as the required environment promotion path.

### Changed

- Decided for M17 that expiry and Purge Media delete the Lead Assessment rationale and keep its summary, delete the Twilio copy of a Recording whose transfer did not finish, and that Purge Media also deletes unexpired export artifacts containing the Recording; Staging demonstrates expiry with backdated fixtures.
- Started M17 - Retention, Purge, and Lifecycle Automation for 12-month media and Transcript expiry, Operator Purge Media, preserved Call metadata and analytics, verified report artifact and metadata expiry, and idempotent lifecycle cleanup.
- Completed M16 - Reports and Recording Exports after the domain, task, integration, authorization, component, typecheck, lint, build, and Playwright gates passed, the Verification workflow's Staging gate applied migrations 0017 and 0018 and deployed `tracer-staging`, and the Product Owner verified reports, Calls exports, Export Call, Download MP3, and the notification popover on Staging with existing Calls. Observing Staging report artifacts expire after 7 days moves to M17's lifecycle verification.
- Added the `report-artifacts` R2 lifecycle rule to `tracer-recordings-staging` on 2026-10-18, deleting objects under `reports/` after 7 days and aborting their incomplete multipart uploads after 1 day; Production receives it in M19 through `scripts/configure-report-lifecycle.ts`.
- Added `@react-pdf/renderer` and the `geist` font package for the report PDF, the ffmpeg Trigger.dev build extension for Recording MP3s, and a Tracer-owned ZIP64 writer for Recording exports, with `pdfjs-dist` and `fflate` as test-only dependencies. The PDF renderer and React stay external to the Trigger.dev bundle because pdfkit resolves its font metrics through package-internal imports.
- Changed M16 during implementation: every report and export job freezes its Calls at request time, a request matching no Calls is refused, a Calls export uses the Calls page's timezone and a global Calls export is scoped to the Workspaces of its matched Calls, Regenerate reproduces the original window, Download MP3 no longer waits for waveform peaks, stuck jobs fail after 6 hours so Retry is offered, and the PDF uses light content pages after a dark cover for printing.
- Scoped M16 with the Product Owner: a precomputed stereo MP3 per Stored Recording derived with ffmpeg in Trigger.dev and backfilled by the recovery sweep, Download MP3 on Call Detail and the Calls row actions, Export Call as a single-Call Recording ZIP with Transcript and Lead Assessment, report and export jobs visible only to their requester with every download rechecking access to the job's whole Workspace scope, and Recording ZIP exports limited to 500 retained Recordings.
- Started M16 - Reports and Recording Exports for scoped PDF and CSV reports, Recording ZIP exports with a CSV manifest, authorized downloads, report history, the notification popover, and seven-day artifact and ninety-day metadata expiry.
- Completed M15 - Dashboard and Workspace Analytics after the domain, integration, component, typecheck, lint, build, and Playwright gates passed, including Home and Workspace Overview responsive checks, the Verification workflow's Staging gate deployed `tracer-staging` and passed the database smoke check, and the Product Owner verified Home, Workspace Overview, and the Workspaces list on Staging. Review fixes bounded custom ranges to dates from 2000 spanning at most 3660 days, kept the Workspace list readable when its stats fail, counted the last successful inbound Call as the newest Call not ending Failed, and sent a Client Viewer with no readable Workspace from Home to the Workspaces list.
- Started M15 - Dashboard and Workspace Analytics for Total Calls, Answer Rate, Good Leads, and Average Connected Duration with equal prior-period comparisons, the three-series trend chart, Workspace comparison, Recent Calls, routing health, and 7, 30, 90, All Time, and custom ranges on Home and Workspace Overview.
- Scoped M15 with the Product Owner: Answer Rate over Calls with a Forwarding attempted event, Lead Rate as Good Leads over Total Calls, Twilio webhook health derived from accepted voice webhooks on the current Tracking Number (signature rejections stay unrecorded), Answer Rate comparisons in percentage points, and the Workspaces list 30-day Calls, Good Leads, Last Call, and Integration health columns filled from the same analytics service.
- Started M14 - Calls and Activity Operations for the server-backed global and Workspace Calls Data Grid with canonical outcomes, one filter query for basic and advanced filters, Call Detail opened with source filters preserved, the day-grouped expandable Activity timeline with 30-second visible-tab refresh, and region-isolated fetch failures.
- Scoped M14 with the Product Owner: an append-only Call event table written with each lifecycle change and backfilled for existing Calls as the Activity source and Lead Review history, Export Recordings and Export CSV shown disabled until M16, Calls defaulting to all time and Activity to the last 7 days with Load more, and Play Recording opening Call Detail with playback started. Added the DESIGN Workspace tabs to M14 because no earlier milestone built them and Workspace Calls needs them as its entry point. Added AND and OR condition groups to the Calls filter query at the Product Owner's request, so the ReUI Filters advanced popover's Add group action works.
- Started M13 - Transcript, Lead Assessment, and Lead Review for analysis eligibility, OpenAI timestamped speaker-normalized Transcripts, Transcript turns synchronized with waveform seeking, validated immutable Lead Assessments, and the separate Operator Lead Review with reporting precedence.
- Scoped M13 with the Product Owner: eligibility from connected duration (falling back to the dual-channel Recording duration until the forwarded leg's status arrives) or voicemail Recording duration with the analysis toggle read when the Recording is Stored, per-channel transcription merged into Caller and Business turns for exact speaker labels, a 3-hour transcription and assessment cap, one fixed Lead Assessment prompt, `whisper-1` for transcription because it is the lowest-cost OpenAI model that returns segment timestamps, `gpt-5-mini` for the Lead Assessment over `gpt-5-nano` for summary and evidence quality at well under a cent per Call, one overwritable current Lead Review, and Operator Retry, Transcript search, and the OpenAI Integrations card brought into M13.
- Started M12 - Waveform Playback and Call Detail for Trigger.dev waveform peak generation, aligned Caller and Business or mixed waveform lanes, authorized private Recording playback, Call facts, the processing timeline, and Recording availability states.
- Gave M12 a Workspace Overview Recent Calls entry point to Call Detail because the Calls list waits for M14, chose wavesurfer.js for the waveform player for playback quality, deferred Download MP3 to M16 and kept playback-only audio, and treated media as Expired 12 months after Call start in M12 while deferring the Purged state to M17, which adds purge.
- Added `@trigger.dev/build` 4.7.2, pinned to the `@trigger.dev/sdk` version, as a development dependency for M12 so `trigger.config.ts` can add the Audio Waveform build extension that installs `audiowaveform` in deployed task images; it is imported only by the Trigger.dev configuration, so nothing new enters the Worker bundle, and the local Dev runner that serves Staging and Preview needs `audiowaveform` installed itself because the extension skips Dev builds.
- Added `wavesurfer.js` 7.12.12, pinned to the newest 7.x release at least two weeks old, as a runtime dependency for the M12 Call Detail player, which the Product Owner chose for playback quality; it loads only in the browser on Call Detail, draws precomputed peaks without decoding audio, and leaves streaming and seeking to the Workspace-authorized Range-capable audio route.
- Started M11 - Durable Recording Transfer for signed Recording callbacks, idempotent Trigger.dev Recording transfer from Twilio to private R2, verified Twilio cleanup, Recording processing states, and Trigger.dev integration health.
- Added dual-channel connected-conversation recording to M11 because M10 records voicemail only and M11's outcome requires connected Recordings, and added the Workspace-authorized Recording stream route to M11 so private media has one tested read path before M12 playback.
- Chose Twilio WAV as the authoritative R2 Recording format and private Staging and Production R2 buckets for M11, because WAV keeps separate Caller and Business channels for waveform lanes and transcription; Preview uses the Staging bucket because it already shares the Staging database.
- Ran Tracer Staging and Preview Recording processing in the Trigger.dev Dev environment through a locally run `pnpm trigger:dev`, instead of a Trigger.dev Staging environment, because Trigger.dev Staging requires a paid plan; requests carry a 7-day queue lifetime so Recordings wait for the dev server, and Tracer Production keeps the Trigger.dev Production environment for isolation.
- Limited M11's R2 and Trigger.dev Integrations health to configuration, last successful Recording transfer, and recent transfer failures read from Tracer's own state, deferring live Trigger.dev run status and provider test cycles to avoid another provider contract.
- Chose a 12-hour Trigger.dev sweep to recover Recordings left Pending or Failed, bounded to Recordings under 7 days old, because recovery is rarely needed and a frequent sweep would keep the Neon compute awake.
- Added `@trigger.dev/sdk` and the `trigger.dev` CLI at 4.7.2 and `aws4fetch` 1.0.20 for M11, imported only by Trigger.dev tasks; the Worker triggers runs through Trigger.dev's REST API so neither the SDK nor the R2 signing client enters the Worker bundle.
- Started M10 - Complete First-Release Call Routing for Business Hours, Keypad Gate, Whisper, and Voicemail execution, the Business Hours and override editor, text-to-speech prompt configuration, and the Workspace Overview Flow summary, carrying M9's live Staging call checks.
- Made voicemail capture independent of the Workspace recording setting, which now governs connected conversations only, because a caller who leaves a message consents by doing so; a Voicemail with no usable capture ends as Missed after a Forward Call Missed branch and Abandoned after Business Hours Closed, and Keypad Gate replays its prompt once before Blocked.
- Made Resume Setup write a new Destination Number into the published Call Flow's Forward Call step instead of only the Workspace, because activation republished the old Flow and reverted the number after a detach; spam gate and whisper stay managed in the Flow, as in Workspace Settings.
- Cleared the browser's client cache after every successful write because pages prefetched in full kept showing pre-mutation data for up to five minutes, such as a detached Tracking Number still shown as attached after navigating away and back.
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

- M13 requests Lead Assessments with OpenAI response storage disabled, tells the Lead Assessment model to treat the Transcript as untrusted data, rejects evidence that does not quote a real Transcript turn, and keeps Transcript text and evidence in deletable rows apart from the immutable Lead Assessment so expiry and purge can remove content while scores and Lead Reviews remain.
- Gave the Trigger.dev Recording-processing task direct access through a bucket-scoped R2 S3 API token, a Neon runtime-role connection string, and the Twilio credential master key as Trigger.dev environment secrets, because the task runs outside the Worker bindings and later waveform and transcription stages need the same R2 access.
- Authorized every Client Viewer Workspace read through `data/workspace-authorization.ts` against current Access Grants on each request, so grant removal blocks an existing session's next read, and returned Not Found for ungranted Workspaces so they cannot be discovered (M8).
- Encrypted the Organization Twilio API key secret with AES-256-GCM under the `TWILIO_CREDENTIAL_MASTER_KEY` deployment secret, verified credentials before storage or rotation, and excluded secret material from every application response; see ADR 0005.

### Deployment

- Provisioned `TWILIO_CREDENTIAL_MASTER_KEY` for the `tracer` Worker, the `tracer-staging` Worker, and the Previews Base configuration; Preview and Staging share one value because they share the Staging database. The `tracer` Worker was created as an empty secret holder and remains undeployed.
- Applied migrations 0001 through 0004, runtime grants, and the initial Operator bootstrap to the Staging database through the `Bootstrap Authentication` workflow; Staging had carried only the M2 schema until this point.
- Added the `EMAIL` send binding to the `staging` Wrangler environment and provisioned the Staging and Preview authentication secrets after live checks showed every database-backed Staging route failing with `EMAIL is required`; Wrangler environments do not inherit top-level bindings or secrets.
- Deployed `tracer-staging` with the corrected bindings and verified anonymous route guards, generic OTP responses, and the Integrations API boundary live.
- Promoted M2's isolated Staging data path after direct migration and protected Hyperdrive read/write smoke checks passed.

### Completed

- Completed M14 - Calls and Activity Operations after the domain, integration, component, Worker, typecheck, lint, build, and Playwright gates passed, including the simulated Twilio lifecycle journey and responsive checks, the Verification workflow's Staging gate applied migration 0016 with its runtime grants and passed the database smoke check, and the Product Owner verified the Calls, Activity, and Call Detail behavior on Staging. The deferred M13 Staging test calls and the M11 Staging voicemail transfer check remain open.
- Completed M13 - Transcript, Lead Assessment, and Lead Review after the domain, contract, task, component, harness, Worker, integration, browser, typecheck, lint, build, and migration validation gates passed and the Verification workflow's Staging gate applied migration 0015 with its runtime grants and passed the database smoke check. The Product Owner deferred the Staging test-call check until after M14, so real OpenAI processing on Staging remains unverified.
- Completed M12 - Waveform Playback and Call Detail after the domain, contract, task, integration, Worker, component, browser, typecheck, lint, build, migration validation, and Staging database smoke gates passed with migration 0014 applied to Staging. Existing Staging connected Recordings generated Caller and Business waveform peaks through the local Trigger.dev Dev runner, and the Product Owner verified Call Detail playback on Staging through the Workspace-authorized media routes without a public R2 URL; the Staging voicemail transfer check deferred from M11 remains open.
- Completed M11 - Durable Recording Transfer after the task, contract, integration, Worker, component, browser, typecheck, lint, build, and Staging database smoke gates passed with migrations 0012 and 0013 applied to Staging. Two Staging connected calls transferred to the private Staging R2 bucket through the local Trigger.dev Dev runner with matching size and SHA-256 before their Twilio copies were deleted; the Product Owner deferred the Staging voicemail transfer check.
- Completed M10 - Complete First-Release Call Routing after the domain, contract, integration, Worker, component, browser, typecheck, lint, and build gates passed with migration 0011 adding pending Call Outcomes, voicemail capture, and the new provider event kinds. The Product Owner verified the Staging branch checks and carried M9 call checks before merging; provider costs from those checks were not recorded.
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
