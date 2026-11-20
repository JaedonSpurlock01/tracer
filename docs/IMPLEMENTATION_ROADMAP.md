# Tracer Implementation Roadmap

This document is the authoritative implementation sequence for Tracer from ideation through production deployment. It converts the product scope in `docs/SPECIFICATION.md`, domain language in `CONTEXT.md`, interface specification in `DESIGN.md`, and engineering rules in `AGENTS.md` into small, verifiable milestones.

## Document authority

- Use this roadmap to choose and sequence implementation work.
- Use `CONTEXT.md` for canonical domain language and invariants.
- Use `DESIGN.md` for page composition, states, branding, and ReUI rules.
- Use `docs/SPECIFICATION.md` for product scope, architecture, security, and testing strategy, and `README.md` for setup, environment variables, and deployment.
- Use `AGENTS.md` for mandatory agent behavior and verification rules.
- Use `docs/CHANGELOG.md` to record substantive roadmap, scope, milestone, and deployment changes.

If these documents conflict, stop implementation and resolve the conflict before continuing. Update every affected document in the same change.

## Current state

- **Current milestone:** M28 - Workspace Overview Briefing, started on 2026-11-20
- **Next milestone:** M29 - Forms, Settings, and Action Feedback, then M30
- **Last completed:** M27 - Calls Absorbs Activity, on 2026-11-20, with its Staging acceptance riding with M28's
- **Paused:** M18 - Production Hardening and Acceptance, deferred by the Product Owner on 2026-11-18 for the Experience Overhaul. M24's Staging gate and M19 wait behind it
- **Why the plan changed:** the Product Owner reviewed the running application on 2026-11-18 and found it clunky and unfinished to use. Interface polish had been arriving as one-line additions to M18, which made M18 a catch-all and never addressed how whole pages read. The Experience Overhaul is its own phase so the interface is planned and verified as product work
- **Current environment:** Local, Preview, and Staging application and data paths verified; Production deployed from `main` on 2026-11-18 ahead of M19 for Product Owner acceptance, with Production data empty since 2026-10-24
- **Last roadmap review:** 2026-11-20

Completed milestones M0 through M23 and their full records are in `docs/ROADMAP_ARCHIVE.md`.

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
| M25 | Interface Foundations | Complete | Local and Preview | M23 |
| M26 | Home Briefing | Complete | Preview and Staging | M25 |
| M27 | Calls Absorbs Activity | Complete | Preview and Staging | M26 |
| M28 | Workspace Overview Briefing | In Progress | Preview and Staging | M27 |
| M29 | Forms, Settings, and Action Feedback | Not Started | Preview and Staging | M28 |
| M30 | Detail Pages and Experience Acceptance | Not Started | Staging | M29 |
| M18 | Production Hardening and Acceptance | Deferred | Staging | M30 |
| M24 | Keyword Discovery | Deferred | Preview and Staging | M18 |
| M19 | Production Deployment and Stabilization | Not Started | Production | M24 |

The active sequence is M25, M26, M27, M28, M29, M30, then M18, M24, and M19. Phase 9 (Experience Overhaul) was added on 2026-11-18 and runs before the deployment phase because the Product Owner decided the interface must feel finished before Production acceptance resumes. Records for M0 through M23 are in `docs/ROADMAP_ARCHIVE.md`.

M18 and M19 keep their identifiers so earlier Changelog entries stay valid; the sequence runs M17, M20, M21, M22, M23, M18, M24, M19. M24 was added on 2026-10-24 at the Product Owner's request and sits before M19 because it depends on the validated Service Area that M18's Search adapter work introduces. Phase 7 (Business HQ) sits between Phase 6 and the deployment phase because the Product Owner decided on 2026-10-20 that every Business HQ domain ships before Production, and on 2026-10-21 pulled Form Submissions forward from the backlog into Phase 7 as M23 for the same reason.

## Phase 9 - Experience overhaul

Phase 9 makes the interface read at a glance and feel finished. It was added on 2026-11-18 after the Product Owner reviewed every page of the running application with sample data and chose the Briefing layout from a three-way Home prototype. The review found the same few causes on every page: timestamps with seconds that wrap table rows, tiles and panels of equal visual weight, the same pattern built several different ways, weak feedback after an action, and internal vocabulary used as labels. Each milestone below changes how existing data is presented. None adds a domain concept, a provider, or a migration.

The Briefing layout sets the shared pattern: a page header with its controls on one row, one stat strip, panels with a header bar, one-line list rows, and short timestamps.

### M25 - Interface Foundations

- **Status:** Complete
- **Outcome:** Every page can be rebuilt from one small set of shared parts and written rules, and the defects visible on every page are gone.
- **Depends on:** M23
- **Target environment:** Local and Preview
- **Execution note:** Started on 2026-11-18. The parts live in `components/tracer` beside the views that use them. Existing pages move to the parts in M26 through M30, one page per milestone, so no page is half converted at a milestone boundary. `DESIGN.md` gains a Foundations section that states the rules below; its per-page sections are rewritten by the milestone that rebuilds each page.
- **Progress (2026-11-18):** all four slices landed locally. The global Sidebar navigation sits in a padded group; the 16 page actions that wrapped a link in a Button are links styled with `buttonVariants`, because defaulting Button to non-native rendering gave those anchors the button role and broke 14 existing page tests; `formatShortTime` is in `components/tracer/call-format.ts`; `StatStrip`, `FactList`, `PageHeader`, `Panel`, and `ListRow` are in `components/tracer/page-parts.tsx`; `DESIGN.md` has its Foundations section and Instrument Sans is recorded as the interface font. The verification gate passed locally (756 unit and component tests, 14 Worker tests, 22 browser journeys, typecheck, lint with no new warnings, production build). The database integration suite did not run because Docker was not running. 
- **Completion (2026-11-19):** the Product Owner directed on 2026-11-19 that M25 close on its local gate and that its Preview demonstration ride with M26's Preview, since no page layout changed in M25. The database integration suite runs with M26's gate.

#### Vertical slices

1. Shell defects: the global Sidebar navigation gets the same group padding as the Workspace navigation, and every Button rendered as a link stops logging the Base UI native-button error.
2. Time and empty values: one formatter shows a time of day for today, a short date otherwise, and the full timestamp on hover, and one rule names an absent value instead of printing a dash.
3. Shared parts: page header, stat strip with an optional change against the previous period, panel with a header bar, fact list, and list row.
4. Foundations in `DESIGN.md`: type scale, where monospace is allowed (phone numbers and identifiers only), timestamp format, empty-value wording, content maximum width, and one definition each for page header, panel header, and table density. The Geist and Instrument Sans contradiction is resolved to what ships.

#### Test-first behaviors

- A Call started today shows its time of day, an older one shows its date, and both expose the full timestamp in the reporting timezone.
- A stat shows its change against the previous period only when a previous period exists.
- The global and Workspace Sidebar navigation render inside the same padded group.
- A page with link-rendered Buttons renders without a console error.

#### Deliverables

- The shared parts and the time formatter, each with component tests
- `DESIGN.md` Foundations section

#### Verification gate

- Component, typecheck, lint, and build gates pass.
- The browser journeys pass unchanged, since no page layout changes in this milestone.

#### Exit criteria

- The parts exist, are covered, and are documented, and no page logs a console error on load.

### M26 - Home Briefing

- **Status:** Complete
- **Outcome:** Home shows the state of every readable Workspace in one screen: one stat strip, the Leads generated chart beside the latest Calls, and the Workspaces as a compact list.
- **Depends on:** M25
- **Target environment:** Preview and Staging
- **Execution note:** Started on 2026-11-19. Home is rebuilt from the M25 page parts in `components/tracer/page-parts.tsx`.
- **Progress (2026-11-19):** all three slices landed locally. Home is the Briefing layout: the header sentence names the scope and range beside the date controls and Generate Report; one stat strip holds the four Call stats and, for Operators, Monthly Revenue and Profit, with the Monthly Cost named on one line beneath it; Leads generated sits beside Recent Calls as one-line rows; the Workspaces list shows each Workspace's profit to Operators. The Home prototype and its sample data are removed and remain in commit `250fdac` as the record of the three-way comparison. `Panel` clips its contents like `FramePanel` did, because the chart's screen-reader table otherwise widened the page at 390px. The verification gate passed locally (757 unit and component tests, 571 integration tests, 14 Worker tests, typecheck, lint with no new warnings, production build). The browser journeys pass; in two full-suite runs one Calls-page step of the lifecycle journey timed out under load at a different viewport each time and passed when the file ran alone. Two journey assertions changed: Home's stat strip shows two, three, then four Call stats per row instead of one, two, then four, and the Monthly Cost is read from its line rather than a tile. M26 remains In Progress until the Product Owner accepts Home on Staging at 1440px and 390px.
- **Completion (2026-11-19):** the Product Owner accepted Home on Staging at 1440px and 390px.

#### Vertical slices

1. Home header with the date range and Generate Report on one row, and the stat strip that merges the KPI row and the Operator-only Money row.
2. Leads generated beside a Recent Calls feed of one-line rows, and Workspace performance as a list that opens each Workspace Overview.
3. Loading, Empty, Retry, and 390px states in the new layout, and removal of the Home prototype and its sample data.

#### Test-first behaviors

- A Client Viewer's stat strip never contains cost, revenue, or profit.
- A failed analytics region shows Retry while Recent Calls stays readable, and the reverse.
- An Operator with no Workspaces still sees the Create Workspace explanation.

#### Verification gate

- Component, integration (the Home page budget is unchanged), typecheck, lint, and build gates pass.
- The Home browser journeys pass with their assertions updated for the new layout, each change stated.

#### Exit criteria

- The Product Owner accepts Home on Staging at 1440px and 390px, and nothing named `prototype` remains in the repository.

### M27 - Calls Absorbs Activity

- **Status:** Complete
- **Outcome:** One Calls page serves both browsing history and watching what just happened, and every table in the application reads in single-line rows.
- **Depends on:** M26
- **Target environment:** Preview and Staging
- **Execution note:** The Product Owner decided on 2026-11-18 to fold Activity into Calls because Activity showed the same Calls in a taller layout. The per-Call processing steps Activity expanded stay available on Call Detail's Processing timeline.
- **Started:** 2026-11-19, after the Product Owner accepted M26.
- **Progress (2026-11-19):** all four slices landed locally. Calls rows are one line of Started (short time, full timestamp on hover), Caller, Workspace, Outcome, Duration, and Lead; the Lead Score, Recording availability, Play Recording, and Download MP3 sit behind the row on Call Detail, and below `md` only Started, Caller, and Outcome show. Calls refreshes every 30 seconds while the tab is visible, keeping the page, sort, search, filters, and row elements; a failed refresh keeps the rows silently and the next one retries, so Calls shows no freshness label. Activity left the Sidebar and `/activity` redirects to `/calls` without parameters. Removed: the Activity view, page loader, `GET /api/activity`, `data/activity*.ts`, the Activity filter mode, the No Activity line art and its motion, the caller-only search Activity needed, and `/activity` as a Call Detail back source, with their tests (`activity-view`, `activity-query`, the Activity integration suite, the Activity page budget, and the caller-only neighbors case); their refresh behaviors moved to the Calls component tests. Calls, Users, Reports, Forms, and Workspaces use `PageHeader` and `Panel`. Decisions taken in the slices: Reports drops the Requested By column because the history lists only the requester's own jobs, and its downloads show an icon and file label; Forms keeps UTC times because its list carries no Workspace timezone; Workspaces shows the Destination Number on the Tracking Number's hover title instead of a second line; Users shows times in the Operator's account timezone. Browser journey changes: the lifecycle journey reaches Calls through `/activity` and no longer reads Activity, the Calls and Reports grid checks expect no grid scroll at 1440px (and at 390px for Calls), and the Client Viewer journey checks `/activity` lands on Calls without an ungranted Workspace. The verification gate passed locally (753 unit and component tests, 556 integration tests, 14 Worker tests, 22 browser journeys, typecheck, lint with no new warnings, production build). M27 remains In Progress until the Product Owner accepts Calls and the four rebuilt tables on Staging at 1440px and 390px.
- **Completion (2026-11-20):** the Product Owner directed on 2026-11-20 that M27 close on its local gate and that its Staging acceptance of Calls and the four rebuilt tables ride with M28's Staging review, as M25's Preview rode with M26's.

#### Vertical slices

1. Calls rows fit one line with six columns (Started, Caller, Workspace, Outcome, Duration, Lead) and plain labels; the remaining columns move behind the row.
2. Calls refreshes every 30 seconds while the tab is visible, the behavior Activity had, without resetting filters, sort, or page.
3. Activity leaves the Sidebar and `/activity` redirects to Calls sorted by newest; the Activity view, its loader, and its tests are removed or moved to Calls with each move stated.
4. Users, Reports, Forms, and Workspaces adopt the same table treatment and panel header.

#### Test-first behaviors

- `/activity` redirects to Calls for an Operator and a Client Viewer and never widens the readable Workspace scope.
- A background refresh keeps the current filters, sort, page, and scroll position.
- Calls at 390px shows Caller, Outcome, and Started without horizontal scrolling.

#### Verification gate

- Component, integration, browser, typecheck, lint, and build gates pass.
- `DESIGN.md`, `docs/SPECIFICATION.md`, and the README no longer describe Activity as a page.

#### Exit criteria

- The Sidebar has no Activity item and no table row in the application wraps a timestamp at 1440px.

### M28 - Workspace Overview Briefing

- **Status:** In Progress
- **Outcome:** Workspace Overview is the Briefing layout scoped to one Workspace, ordered by what an Operator checks first.
- **Depends on:** M27
- **Target environment:** Preview and Staging
- **Execution note:** The order of the lower panels is a judgement call, so this milestone begins with a `?variant=` prototype like Home's and the Product Owner picks before the build.
- **Started:** 2026-11-20, after M27 closed on its local gate. The Staging review covers M27's Calls and four rebuilt tables alongside Workspace Overview.
- **Decision (2026-11-20):** the Product Owner chose the Side rail layout from a three-way prototype (Briefing, Health first, Side rail): Leads generated and Recent Calls fill the main column, and Routing health, Site, Call Flow, and Business stack in a right rail. The stat strip holds Total Calls, Answer Rate, Good Leads, Average Duration, Visit-to-Call when a Site is linked, and Profit for Operators, with the Monthly Cost and Deal on one line beneath it; Visits and Search Visibility move into the Site panel. The prototype is removed in the same change that builds the layout and remains in Git history as the record of the comparison.
- **Progress (2026-11-20):** all three slices landed locally. Workspace Overview uses `PageHeader`, `StatStrip`, `Panel`, `FactList`, and `ListRow`: the header names the state, range, and reporting timezone beside the date controls and actions; Recent Calls show the short start time with the full timestamp on hover; Routing health shows its webhook Badge in the panel header, four facts, and the Recording, Spam gate, and Whisper settings on one line; an unlinked Site is one line with Link Site; the Business panel keeps the name, contact, niche, and city above a smaller map; and the Setup Required checklist shows a check or an empty circle with the state as screen-reader text. Removed from the Overview: the Scorecard, the KPI row, the Call Flow publication time and Whisper message in Routing health (the Call Flow panel carries the version), and the Business email and website (both remain in Site settings). The verification gate passed locally (757 unit and component tests, 556 integration tests with the Overview page budget unchanged, 14 Worker tests, 22 browser journeys, typecheck, lint with no new warnings, production build). Browser journey changes: the lifecycle journey expects the Overview stat strip to show two, three, then four Call stats per row like Home's instead of one, two, then four; the cost journey reads the Overview's Profit from the strip and the Deal from the Monthly Cost line, scoped to `main` because the dev server keeps a hidden streamed copy of the page that text queries also match; the search journey reads `73 of 100` from the Site panel instead of a Search Visibility tile. M28 remains In Progress until the Product Owner accepts Workspace Overview on Staging for an Active, a Setup Required, and an Archived Workspace, together with M27's Calls and four rebuilt tables.

#### Vertical slices

1. One stat strip merging the scorecard, the KPI row, and the Operator-only cost and profit.
2. Leads generated beside Recent Calls; Site, Call Flow, Routing health, and Business as compact panels, with an unlinked Site reduced to one line and its Link Site action.
3. The Setup Required checklist shows each requirement's state as an icon with accessible text.

#### Test-first behaviors

- A Client Viewer sees no cost, profit, Deal, Business, or hosting detail.
- A Setup Required Workspace shows the checklist and no analytics.
- An Archived Workspace keeps its history readable and offers Restore only to an Operator.

#### Verification gate

- Component, integration (the Overview page budget is unchanged), browser, typecheck, lint, and build gates pass.

#### Exit criteria

- The Product Owner accepts Workspace Overview on Staging for an Active, a Setup Required, and an Archived Workspace.

### M29 - Forms, Settings, and Action Feedback

- **Status:** Not Started
- **Outcome:** Every form looks like the same form, and every action visibly starts, succeeds, or fails where the user pressed.
- **Depends on:** M28
- **Target environment:** Preview and Staging

#### Vertical slices

1. One settings form pattern applied to Workspace Settings and Account Settings: small labels, a description under each switch, read-only values as a fact list.
2. Each action shows its own pending state and disables only itself; the single shared busy flag in Workspace Settings is removed.
3. Every failure renders in the destructive style beside its action, and every confirmation appears beside the action that caused it.
4. The Create Workspace wizard and the Users and Integrations dialogs adopt the same form pattern.

#### Test-first behaviors

- Saving one settings section leaves the other sections' actions enabled.
- A failed save names the failure beside its button and keeps the entered values.
- A disabled action states why it is unavailable, such as an Archived Workspace.

#### Verification gate

- Component, browser, typecheck, lint, and build gates pass.

#### Exit criteria

- No action in the application completes or fails without visible feedback at the point of action.

### M30 - Detail Pages and Experience Acceptance

- **Status:** Not Started
- **Outcome:** The remaining pages match the rest, loading states match the pages they stand in for, and the Product Owner accepts the whole interface.
- **Depends on:** M29
- **Target environment:** Staging

#### Vertical slices

1. Call Detail header in two rows and its facts as the shared fact list; Site and Integrations adopt the shared panel and fact list.
2. Each route group's loading state matches the layout of the page it precedes.
3. A pass at 390px across every page, fixing anything that scrolls sideways or hides an action.
4. `DESIGN.md` per-page sections state the priority of each page's regions, and implementation detail that duplicates the code is removed.

#### Test-first behaviors

- Each loading state renders the same regions as its loaded page.
- Every page keeps each action reachable at 390px.

#### Verification gate

- The full verification boundary passes: complete test suite, browser journeys, typecheck, lint, and production build.
- The Product Owner walks every page on Staging as an Operator and as a Client Viewer.

#### Exit criteria

- The Product Owner accepts the interface, and M18 resumes.

## Phase 8 - Deployment and operation

### M18 - Production Hardening and Acceptance

- **Status:** Deferred
- **Deferral note (2026-11-18):** The Product Owner deferred M18 so the Experience Overhaul (M25 through M30) could run first. Slice 5 (Database module), the eight acceptance slices, the required acceptance, and every open finding below are unchanged and resume after M30. Interface polish no longer enters M18 as added scope; it belongs to Phase 9.
- **Earlier deferral note:** The Product Owner deferred M18 on 2026-10-25 so M24 could start once the four 2026-10-24 slices had merged to `main`, and resumed it the same day for the Database module (slice 5 below) after Production kept hanging; M24's code is merged and only its Staging gate remains. The eight acceptance slices and the required acceptance below resume after slice 5; the Staging deployment of the four slices and the provider reconnects it needs are tracked in the Changelog.
- **Outcome:** The complete first release passes security, reliability, accessibility, cost, and operational acceptance in Staging.
- **Depends on:** M23
- **Target environment:** Staging
- **Entry criteria carried from M17:** the Product Owner's Staging retention demonstration with `pnpm fixtures:retention`, and confirmation that the M16 Staging report artifacts expired through the `report-artifacts` rule.
- **Execution note:** The Product Owner started M18 on 2026-10-21 and had Staging reset to an empty state so acceptance starts from a fresh install, the same path Production takes: every object in `tracer-recordings-staging` was deleted, and the Staging database is dropped and rebuilt from migration 0000 by the `Bootstrap Authentication` workflow. The reset deleted the M16 Staging report artifacts, so the second M17 entry criterion is met instead by confirming the `report-artifacts` rule on `tracer-recordings-staging` (confirmed with `wrangler r2 bucket lifecycle list` on 2026-10-21) and by a report generated on the reset Staging whose files are gone 7 days later. The retention demonstration needs a new Workspace with a Number Assignment and a published Call Flow first. The README now carries setup, environment variables, and deployment, and the former README specification moved to `docs/SPECIFICATION.md`.
- **Scope added by the Product Owner on 2026-10-22:** the Recording Disclosure text is editable per Call Flow like other prompts, with no required wording, and the voice list grows from 4 to 16 English Amazon Polly voices, 8 female and 8 male, each rendered with its language. Disclosures published earlier keep the default sentence.
- **Scope added by the Product Owner on 2026-11-04:** the Workspace Overview shows Operators the Business from Site settings with its city's location map below Leads generated. The Business read became one query, and the Overview's page budget rose from 33 to 34 queries with the Product Owner's approval.
- **Scope added by the Product Owner on 2026-11-18:** Tracer gets its own mark in place of the Spurlock Labs ibex shield. The Waveform mark, a T drawn in call audio bars, is drawn inline by `BrandMark` in the current foreground color, the favicon becomes its three-bar cut on the zinc-950 ground, and the logo kit and usage rules live in `docs/brand`. The PDF report cover is unchanged.
- **Scope added by the Product Owner on 2026-11-18 (save confirmation):** every save confirmation line replays a short reveal, so a second save with the same message still visibly confirms. `StatusMessage` in `components/tracer/status-message.tsx` renders the line for Workspace Settings, Workspaces, Users, Integrations, and the Site page, and remounts it on each confirmation.
- **Scope added by the Product Owner on 2026-11-18 (section expand):** sections that open and close, the Activity Call steps and the Call Detail rail sections and lead details, grow and shrink over 200ms instead of snapping open, through `CollapsibleContent` in `components/ui/collapsible.tsx`.
- **Scope added by the Product Owner on 2026-11-18 (press feedback):** a pressed Button shrinks to 97% over 150ms and returns on release, replacing the 1px nudge that snapped with no transition.
- **Scope added by the Product Owner on 2026-11-18 (wizard steps):** each Create Workspace wizard step after the first slides 8px in from its direction of travel over 200ms, through `data-step-direction` on the step, instead of replacing the previous step instantly.
- **Scope added by the Product Owner on 2026-11-18 (overlay motion):** the installed overlays never animated because `tw-animate-css`, which defines the `animate-in`, `fade-in`, `zoom-in`, and `slide-in` utilities they use, was not installed. It is now a pinned dev dependency imported in `app/globals.css`, with a reduced-motion rule that keeps only the fade.
- **Scope added by the Product Owner on 2026-10-24** after an architecture review of the Production failures (Detach Number answering 502, Twilio Disconnect waiting out the connection timeout, Site previews never captured, Search positions with no explanation, and pages that felt frozen). The review found that `TWILIO_CREDENTIAL_MASTER_KEY` had changed in Production between 2026-10-22 and 2026-10-23, so the Twilio and Cloudflare credentials stored under the earlier key could not be decrypted by the Worker or the Trigger.dev tasks while the Integrations page still showed them as Connected, and that the request pool's single connection serialized every query, so a Workspace Overview paid 54 round trips. Four slices were added, worked in this order:
  1. **Request Runtime and page speed:** one request-scoped runtime shared by the actor, layouts, and page with a pool of six connections; pages grouped into `(everyone)`, `(operator)`, `(viewer)` route groups whose layouts decide authorization before streaming, with a `loading.tsx` boundary per group so a denied URL keeps its real 404; Sidebar prefetch limited to the shell; the Workspaces and Calls views stop re-fetching on mount and the report jobs provider fetches on demand; Better Auth's session cookie cache enabled for 60 seconds; one Workspace lookup per request; the Integrations page loaded in one parallel pass and refreshed with one call; and a performance budget enforced by tests: `observePool` counts sequential waves, every page's loader is tested against a wave and query ceiling (Home 4 waves and 20 queries, Workspaces 3 and 10, Overview 4 and 20, Site 4 and 18, Integrations 2 and 12, Calls and Activity 3 and 8), and a Playwright timing journey reports second-visit server time for the main pages against a 1500 ms dev-mode ceiling, informational until its baseline is steady. The Neon Production compute was set to never suspend the same day (Launch plan).
  2. **Provider Credential module:** one module owns encryption, decryption, the master key fingerprint stored on each connection row (replacing the unused `master_key_version`), the `Unreadable` connection state, and failure recording; Twilio, Cloudflare, and DataForSEO become adapters that only verify credentials and call their provider. The Integrations page shows Needs re-entry with Re-enter credential and Disconnect; Disconnect anyway with an acknowledgement ends open Number Assignments, moves Workspaces to Setup Required, and records that the Twilio voice URL was not restored; Detach Number on an Unreadable credential succeeds with the same record. Twilio Disconnect counts Active Workspaces on the transaction's own connection. ADR 0006 records the module and amends ADR 0005's pure-count disconnect decision. Landed 2026-10-24 with migration 0027; connections sealed before it read as unreadable, so Staging reconnects its three providers after deployment.
  3. **Site sync outcomes:** the sync returns a per-Site report stored on the Site (last sync time, stage, and error); the connection's synced time is stamped only when a Site synced; an unreadable credential is recorded on the connection; the Site page shows the failing stage and reason instead of Preview pending. Landed 2026-10-24.
  4. **Search adapters that say why:** the DataForSEO adapter surfaces the task status and message; Rank Check uses the `advanced` SERP endpoint so local pack and map results count, and stores the matched item type and a check status per rank day; the Service Area becomes a picked DataForSEO location stored by `location_code`, searched through a `search_location` table imported once per country; the Search panel distinguishes Not ranking, Check failed, and Local pack. Landed 2026-10-24 with migration 0028; a Site whose Service Area was typed before the picker keeps checking by its concatenated name until an Operator picks a location.
  5. **Database module:** one module, `data/database.ts`, is the only way application code reaches PostgreSQL: `query`, `transaction` (a callback on a handle that can only query, holding the named advisory lock when asked), `stats`, and `close`, with the 10-second connect and 30-second query timeouts, the Worker request socket, the `DatabaseUnavailableError`, and the close deadline inside it. The Worker request runtime, every Trigger.dev task run, and the integration suite open it the same way, so tests cross the Production seam. Delivered in four parts, each keeping the app runnable: (a) the module replaces the request, task, and test pools while repositories that still take a pool receive the module's own, and the actor, avatar, and Organization reads leave Drizzle, which stays only behind the Better Auth adapter; (b) Workspace routing, Workspaces, and Provider Credential take the Database; (c) Calls, Recordings, Reports, and media retention; (d) the rest, then the pool handle, the nine copied transaction helpers, and `lockOrganization` are deleted. ADR 0008 records the decision. Part (a) landed 2026-10-25. Part (b) landed 2026-10-25: Workspaces, Workspace routing, Provider Credential and its Twilio, Cloudflare, and DataForSEO adapters, Search locations, Site sync, Rank Check, Keyword Discovery, and Site previews take the Database; every transaction in them runs through `transaction` with the Organization lock as an option, three of the nine copied helpers and `lockOrganization` are gone, and Workspace reads are a separate factory over `Queryable` so read-only callers keep what they hold. Parts (c) and (d) landed together 2026-10-25 because the Report modules read through Analytics: every remaining repository, handler, page, Trigger.dev task, and the script-side bootstrap, retention fixture, runtime role, and call smoke modules take the Database or `Queryable`; the last six copied transaction helpers and every hand-rolled begin and commit block are gone; the request runtime, the page runtime, and the handlers no longer carry a pool; `pool` left the `Database` interface and survives only on `openDatabase`'s own result for the module's tests; and the integration suite opens the module through `createTestDatabase`, with `createTestPool` deleted. Slice 5 is complete.
- **Open findings:**
  - `AUTH_EMAIL_ALLOWED_RECIPIENTS` is enforced in every environment. On 2026-10-21 the Product Owner decided Production keeps it: provisioning an Operator or Client Viewer includes adding their email to the `tracer` Worker secret, or they receive no sign-in code.
  - `.github/workflows/deploy-production.yml` (added 2026-10-21, guarded by `tests/harness/deploy-production-workflow.test.ts`) is the Production path: a manual run in the `Production` GitHub Environment that runs `pnpm test`, typecheck, and lint, applies migrations and runtime grants, deploys the `tracer` Worker, deploys the matching Trigger.dev task version with `TRIGGER_ACCESS_TOKEN`, and checks `/health`. Before its first run, `TRIGGER_ACCESS_TOKEN` must be added to the `Production` environment, and the environment needs a required reviewer and a `main`-only deployment branch rule, which it does not have yet. Slice 8 rehearses it.
  - `tracer-recordings-production` has only Cloudflare's default multipart rule; M19 step 3 applies `report-artifacts`.
  - `tests/components/report-notifications.test.tsx` "polls every 30 seconds while a job is Generating and the tab is visible" failed once in the 2026-10-21 `Bootstrap Authentication` run on `main` (expected 2 history requests, got 1) and passed on rerun and 5 of 5 local runs. Slice 2 makes it deterministic so required checks stay trustworthy.
  - On 2026-10-22 Production pages intermittently hung for minutes while PostgreSQL showed no connection from the Worker. Neither node-postgres nor the Cloudflare socket adapter sets a connection or query timeout, so a stalled Hyperdrive connection held the request forever. The request pool now fails after 10 seconds to connect or 30 seconds to query, which turns a hang into a logged error and a retryable page; if Production still logs connection timeouts, the next step is the Hyperdrive and Neon connection path itself (both Neon computes scale to zero after 5 minutes, which adds about 2 seconds to the first request after idle). On 2026-10-25 Workers Logs showed those timeouts had never fired: 22 page requests in 7 days ran 30 seconds to 100 minutes with under 100 ms of CPU and no PostgreSQL query, because pg reports a connect timeout only through the socket's close and pg-cloudflare's close waits for Hyperdrive to confirm, which a stalled socket never does; the contract test proved the timeout with a Node socket, so it stayed green. The pool now drives `data/request-socket.ts`, whose end and destroy report to pg at once, a timed-out page renders the failure page "The database did not answer" with Retry through a `DatabaseUnavailableError` digest, and the contract test hands the pool a Cloudflare socket that never answers. ADR 0007 records the decision. A stall is now a 10-second error with a `tracer.request` line naming it; if Production keeps logging them, the Hyperdrive and Neon path is the next lever. On 2026-11-04 Production, running that fix, still hung: seven page loads between 20:06 and 20:21 UTC ran 34 seconds to 6 minutes with 10 to 65 ms of CPU, the Neon compute was active throughout, PostgreSQL received no query after 20:09:53, and no request logged a timeout or rendered the failure page, so the 10-second timeout still never fired. Because a request the browser gives up on never writes its `tracer.request` line, the request runtime now writes a `tracer.request.stalled` line during the request at 8, 20, and 60 seconds with the Worker sockets opened and connected, the first connection time, and each statement still waiting, so the next hang names the step it is stuck in. A hang with no stalled line is stuck before the request runtime opens. Between 2026-11-13 and 2026-11-15 the stalled line logged four clusters of hangs in Production, each with no socket opened and no query sent, so every one stopped inside Better Auth's session check before it reached the database; each cluster began with a burst of concurrent prefetches in one Worker isolate, after which every request in that isolate hung. The stalled line now names the step (`auth.context`, `auth.session`, `auth.handler`, and the steps after), and a session check that has not answered in 5 seconds fails as `SessionCheckTimeoutError` with the failure page and Retry instead of a page that never loads.
  - The `tracer` and `Production` GitHub Environments hold `STAGING_DATABASE_MIGRATION_URL` and `PRODUCTION_DATABASE_MIGRATION_URL`, which nothing reads; remove them once confirmed unneeded.

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

### M24 - Keyword Discovery

- **Status:** Deferred
- **Deferral note:** Deferred by the Product Owner on 2026-10-25 so M18 could resume with the Database module; all three slices are merged to `main` and only the Staging verification gate remains.
- **Outcome:** An Operator editing a Site's Keywords can ask Tracer to suggest city-qualified search phrases for the Business's niche and Service Area, see each suggestion's monthly search volume, and add the ones worth tracking, instead of guessing the Keyword list by hand.
- **Depends on:** M18 (the validated Service Area and the DataForSEO adapter that reports task status)
- **Target environment:** Preview and Staging
- **Execution note:** Added by the Product Owner on 2026-10-24 and started on 2026-10-25 on `feat/keyword-discovery`. One Keyword Discovery module with one interface, `suggest(siteId)`, returning ranked suggestions with phrase, monthly volume, and intent. Inside it, the OpenAI adapter (`gpt-5-mini` through the existing structured-output client) proposes about 30 phrases from the Business niche, the Service Area, and the existing Keywords, and the DataForSEO Labs `keyword_overview` endpoint (about $0.018 per 50 phrases) adds search volume, difficulty, and intent for the Service Area's location; the module dedupes against existing Keywords and ranks by volume. Nothing is saved until the Operator ticks suggestions, which are added as Keywords at weight 3. The last suggestion set is cached per Site in one jsonb column so reopening the panel does not bill again. The run happens inside the request with a visible Finding keywords state. A Site whose Business has no niche gets a message pointing at Business settings rather than a run. OpenAI proposes, DataForSEO measures: OpenAI alone would invent popularity and DataForSEO alone needs seed phrases, and both adapters already exist in the codebase.

#### Vertical slices

1. Keyword Discovery module: prompt, structured candidate schema, volume lookup, dedupe, ranking, and the cached suggestion set. Landed 2026-10-25 with migration 0029 (`site.keyword_suggestions`) and the Labs `keyword_overview` call on the DataForSEO client.
2. Operator route and Site settings panel: Suggest Keywords, Finding keywords, tick to add with weight 3, and the no-niche message. Landed 2026-10-25 as `POST site/keywords/suggest`, the suggestion set on the Keywords read, the Suggested Keywords panel, and an `E2E_OPENAI_FAKE` responder for local and browser runs.
3. Lookup counting on the DataForSEO connection and the cost line in the Pricing guide. Landed 2026-10-25: one lookup per measured run through the counter Rank Check uses, and the Labs prices ($0.012 per request, $0.00012 per measured phrase) in the rate table.

#### Test-first behaviors

- Suggestions never repeat an existing live Keyword and are ranked by monthly volume with ties broken by phrase.
- A Site without a Business niche returns no suggestions and the panel explains why.
- A cached suggestion set is served without calling either provider until the Operator asks again.
- Adding ticked suggestions creates Keywords at weight 3 and refuses beyond the 25-Keyword limit with the existing error.
- A Client Viewer cannot reach the suggest route.

#### Deliverables

- `data/keyword-discovery.ts`, the structured-output prompt and schema, and the Labs volume call on the DataForSEO adapter
- `site.keyword_suggestions` jsonb column with its migration and runtime grant
- Suggest Keywords on Site settings with contract fixtures for the OpenAI and DataForSEO responses

#### Verification gate

- Domain, contract, integration, component, typecheck, lint, and build gates pass.
- Staging shows suggestions for the Pocatello Site with real credentials and the lookup appears in the DataForSEO count.

#### Exit criteria

- An Operator can go from an empty Keyword list to a tracked, volume-ranked list in one sitting without leaving Site settings.

### M19 - Production Deployment and Stabilization

- **Status:** Not Started
- **Outcome:** Tracer is deployed to Production through a controlled promotion and remains stable through the initial observation period.
- **Depends on:** M24
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
  - The Workspaces DataGrid renders a Base UI `Button` with `nativeButton` on a non-button element. This logs 34 accessibility warnings during the Playwright run. Scheduled in M25 slice 1.

## Post-launch roadmap intake

New work after M19 does not enter implementation directly.

1. Describe the user or operational problem.
2. Resolve domain terminology in `CONTEXT.md` when needed.
3. Resolve page or interaction impact in `DESIGN.md` when needed.
4. Resolve architecture and testing impact in `docs/SPECIFICATION.md`.
5. Add a new vertical milestone with dependencies, test-first behaviors, verification gate, and exit criteria.
6. Record the addition under `Unreleased` in `docs/CHANGELOG.md`.
7. Start it only when no other milestone is In Progress.

Examples of post-launch candidates currently outside first-release scope include multiple Organizations in the UI, customer-owned Twilio accounts, international numbers, multilingual processing, audio prompt uploads, scheduled report email, configurable retention, and additional Call Flow node types.
