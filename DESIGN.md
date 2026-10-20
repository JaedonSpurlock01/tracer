# Tracer Design Specification

This document defines Tracer's product experience, page architecture, visual system, and reusable interface patterns. It is a living specification and is updated as product decisions are resolved.

## Experience principles

- **Operational clarity:** Prioritize call outcomes, lead quality, and next actions over decoration.
- **Progressive detail:** Start with fleet-level signals, then let users move into a Workspace and an individual Call.
- **Trustworthy status:** Distinguish completed, pending, failed, and unavailable processing states explicitly.
- **Role-aware simplicity:** Show Client Viewers only the Workspaces and read-only actions they can use.
- **Cost visibility:** Make failed processing and expired media understandable without exposing infrastructure details.

## Brand suite

### Brand idea

Tracer follows a call from first contact through routing, recording, transcription, and lead judgment. The visual identity pairs a precise operational interface with soft gradient orbs that represent calls moving through the system.

### Mark

- The primary lockup combines a compact gradient orb with the `Tracer` wordmark in Geist Semibold.
- Use the full lockup on authentication screens, report covers, and the expanded application sidebar.
- Use the orb alone for the favicon and collapsed sidebar.
- Do not place a tagline in application chrome.
- Maintain clear space around the mark equal to at least half the orb diameter.

### Gradient orb mascot

- Use at most one static orb per view.
- Place orbs in page headers, authentication artwork, empty states, onboarding, and report covers.
- Do not place an orb behind tables, charts, transcripts, forms, or other data-heavy regions.
- Use low contrast in application views and stronger contrast only in isolated brand moments.
- Treat orbs as decorative imagery with empty alternative text.
- Do not use perpetual orb animation.

### Color

Tracer is dark-mode only. Colors are implemented through shadcn-compatible semantic tokens rather than raw values in components.

| Role | Color | Intended use |
| --- | --- | --- |
| Deep slate | `#253237` | Page background and deepest surfaces |
| Slate | `#5c6b73` | Secondary surfaces, borders, and subdued controls |
| Steel blue | `#9db4c0` | Muted text, chart identity, and focus support |
| Pale blue | `#c2dfe3` | Primary controls and emphasized data |
| Ice | `#e0fbfc` | Foreground text and highest-contrast accents |

Status meaning uses ReUI semantic success, warning, info, and destructive tokens through Badge and Alert variants. The Tracer palette expresses brand and chart-series identity, not success or failure.

Recommended chart identities are Ice, Pale Blue, and Steel Blue. Series must also differ by labels, markers, or line styles so color is not the only distinction.

### Typography

- Use Geist throughout the product and generated reports.
- Use Geist Semibold for the wordmark and page headings.
- Use `text-sm` for body content and `text-xs` for metadata, never smaller.
- Use tabular numerals for phone numbers, durations, dates, scores, and KPIs.
- Keep page and panel titles to one to three words where possible.

### Voice

- Calm, concise, and factual.
- Prefer `Recording unavailable` over infrastructure-specific errors.
- Prefer `Analysis pending` over anthropomorphic AI language.
- State destructive consequences precisely.
- Never present an AI Lead Assessment as certain or final when no Lead Review exists.

## ReUI composition rules

- Treat every application page as an operational surface.
- Use the shadcn Sidebar as the application shell, with the account menu at the top and no Workspace switcher.
- Prefer Frame-led pages and dense controls.
- Use ReUI Data Grid and Filters for record management. The server-backed starting pattern is [c-data-grid-34](https://reui.io/preview/base/components/c-data-grid-34?ref=mcp).
- Use ReUI Timeline for Activity. The closest starting composition is [c-timeline-6](https://reui.io/preview/base/components/c-timeline-6?ref=mcp).
- Use shadcn Chart with Recharts inside a Frame when no strong ReUI example matches the required multi-series line chart.
- Use semantic Badge variants for state and neutral outline badges for identifiers.
- Render a page's first data on the server and prefetch its primary navigation links in full, so frequently used pages open without Skeletons; each view then revalidates quietly in the background. Use Skeletons in the final region layout only for data that loads after the page renders, such as a new filter, page, or deferred region, together with an action-oriented Empty state and an inline Retry state for every data region.
- Clear the browser's client cache after every successful write, so a prefetched or previously visited page never shows data from before the change; a reload is never required to see it.
- Keep server-paginated list state (search, filters, and page) in the URL so a refresh, a shared link, or a prefetch renders the same page.
- Use no page-load motion on operational screens. Keep installed ReUI motion unchanged and use `transition-colors` for custom hover feedback.
- Never nest a Card inside a Frame or a Frame inside a Card.

## Application shell

### Global navigation

1. Home
2. Activity
3. Calls
4. Workspaces
5. Reports
6. Users, Operator only
7. Integrations, Operator only

### Account menu

The top of the Sidebar holds the account menu, replacing a separate brand row and footer card. Its trigger shows the Tracer orb, the user's name, and the current Organization slug. The menu contains:

1. **Organizations:** the current Organization with its name, slug, and a check, then a disabled New organization action until multiple Organizations are supported
2. **User:** a DiceBear Gaze avatar seeded by the user id, the name, the email, and an outline role Badge
3. **Account Settings**
4. **Sign out**, styled as destructive

The Sidebar has no Workspace switcher; the Workspaces page owns Workspace selection. Account Settings is reached from the account menu rather than occupying primary navigation.

### Workspace navigation

Workspace detail uses horizontally scrollable tabs below its header:

1. Overview
2. Calls
3. Flow, Operator only
4. Reports
5. Settings

Client Viewers do not see Flow or Workspace Settings. A one-Workspace Client Viewer lands on that Workspace Overview. A multi-Workspace Client Viewer lands on a Home dashboard scoped to granted Workspaces. Operators land on the global Home dashboard.

### Responsive behavior

- At widths below `md`, the Sidebar becomes a Sheet.
- KPI grids collapse to one column, then two columns, before reaching four columns at wide sizes.
- Record-detail side columns stack below the main content.
- Data grids scroll within their Frame and never create horizontal page scrolling.
- Every action remains reachable at 390px; actions removed from a toolbar move into an overflow menu.

## Page inventory

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
- Flow
- Reports
- Settings

### Record detail

- Call Detail

Workspace creation, user provisioning, report generation, and export requests use dialogs or focused wizards. Export progress and completed downloads appear in a notification popover rather than a separate page.

## Home

### Composition plan

1. **Surface:** Operational
2. **Archetype:** Dashboard grid
3. **Container family:** Frame-led
4. **Density:** Dense
5. **Regions:** Header and date controls, KPI row, trend chart, Workspace performance, recent Calls
6. **States:** Region-level Skeleton, Empty, and Retry states
7. **Motion:** None

### Header

- Title: `Home`
- Description: one clause describing the active scope
- Scope indicator: All Workspaces or the accessible Workspace count
- Date controls: 7 Days, 30 Days, 90 Days, All Time, and Custom
- Primary action: Generate Report

### KPI row

1. **Total Calls:** Count in the selected period
2. **Answer Rate:** Answered Calls divided by eligible forwarding attempts
3. **Good Leads:** Calls classified as Good Lead, using Lead Review before Lead Assessment
4. **Average Duration:** Average connected talk time, excluding prompts and ringing

Each KPI includes a comparison with the immediately preceding period of equal length. The value is the focal point; comparison and definition remain secondary.

### Call trends

- Three line series: Total Calls, Answered Calls, and Good Leads
- Daily points for 7-day and 30-day ranges
- Weekly points for the 90-day range
- Monthly points for All Time
- Custom ranges select the coarsest interval that remains readable
- Tooltip values always include the period label and explicit series name
- Legend remains visible and does not rely on color alone

### Workspace performance

Show this region only when the user can access more than one Workspace.

Columns:

- Workspace
- Tracking Number
- Total Calls
- Answer Rate
- Good Leads
- Lead Rate

Rows sort by Total Calls by default. Selecting a row opens that Workspace Overview.

### Recent Calls

Show the five newest Calls in scope with:

- Outcome
- Caller number
- Workspace
- Start time
- Connected duration
- Effective lead classification

Selecting a row opens Call Detail. A `View Calls` secondary action opens the Calls page with the current scope and date range preserved.

### States

- **No Workspaces, Operator:** Explain that Tracer needs an imported Twilio number and offer `Create Workspace`.
- **No Calls:** Keep KPI values at zero and explain that activity appears after the first inbound Call.
- **Loading:** Use KPI, chart, and row Skeletons in their final layouts.
- **Partial error:** Fail only the affected region and show Retry without blanking the page.

## Activity

### Composition plan

1. **Surface:** Operational
2. **Archetype:** Frame stack
3. **Container family:** Frame-led
4. **Density:** Dense
5. **Regions:** Header and freshness status, filter toolbar, day-grouped Call timeline
6. **States:** Timeline Skeletons, no-results Empty state, and inline Retry
7. **Motion:** No entrance; changed data appears without positional animation

### Header and filters

- Title: `Activity`
- Description: count of Calls currently in view
- Freshness label: `Updated just now` or the elapsed time since the last successful refresh
- Manual action: Refresh
- Search: caller phone number
- Filters: Workspace, call outcome, effective lead classification, processing state, and date
- Refresh every 30 seconds while the browser tab is visible and pause while it is hidden

### Timeline

Use the ReUI Timeline API and adapt the collapsible pipeline composition from [c-timeline-6](https://reui.io/preview/base/components/c-timeline-6?ref=mcp). Group entries under Today, Yesterday, or a calendar date.

Each top-level entry represents one Call and shows:

- Start time
- Caller number
- Workspace
- Current or final call outcome
- Effective lead classification when available
- Connected duration
- Expand control

Expanding an entry reveals only lifecycle events that occurred:

1. Call received
2. Spam gate passed or failed, when enabled
3. Forwarding attempted
4. Answered, missed, rejected, or failed
5. Recording transferred or transfer failed
6. Transcript completed, skipped, expired, or failed
7. Lead Assessment completed or failed
8. Lead Review added

Outcome and processing states use one semantic Badge per row. Infrastructure details remain behind concise user-facing status copy. Selecting the entry header opens Call Detail.

### States

- **No Activity:** Explain that call events appear after the first inbound Call.
- **No results:** Preserve active filters and offer `Clear Filters`.
- **Loading:** Render timeline-shaped Skeletons under the current day labels.
- **Refresh error:** Keep existing entries visible, mark freshness as unavailable, and offer Retry.
- **Processing:** Show pending nested steps with neutral status rather than a page-level loader.

## Calls

### Composition plan

1. **Surface:** Operational
2. **Archetype:** Table-backed management
3. **Container family:** One Frame around toolbar, grid, and pagination
4. **Density:** Dense
5. **Regions:** Header and export actions, search and filters, server-backed Calls grid
6. **States:** Data Grid Skeleton rows, filter-aware Empty state, and inline Retry
7. **Motion:** None

### Header and actions

- Title: `Calls`
- Description: matched Call count in the active scope
- Primary action: Export Recordings
- Secondary action: Export CSV
- Global page includes a Workspace filter; Workspace Calls fixes the scope and omits that filter

Both exports operate on the current scope, date range, search, and filters. Tracer does not use row-selection checkboxes in the first release. Before creating an export, a confirmation shows matched Calls, retained Recordings, expired media, and calls without recordings. A Recording export is limited to 500 retained Recordings; above that, the confirmation blocks the export and asks the user to narrow the filters.

### Search and filters

Use ReUI Filters with the server-backed Data Grid pattern. Start from [c-data-grid-34](https://reui.io/preview/base/components/c-data-grid-34?ref=mcp) and adapt the advanced popover behavior from [c-filters-10](https://reui.io/preview/base/components/c-filters-10?ref=mcp).

- Search: caller phone number or Workspace name
- Date range
- Workspace
- Call Outcome
- Effective lead classification
- Lead-score range
- Recording availability
- Analysis status
- Minimum and maximum connected duration

Basic filters remain visible in the toolbar. Less common combinations open in the advanced filter popover. Both edit the same filter query.

### Data grid

Columns:

1. Started
2. Caller
3. Workspace
4. Call Outcome
5. Connected Duration
6. Effective Lead Classification
7. Lead Score
8. Recording Availability
9. Row actions

Rows use server-side pagination and sorting. Started sorts descending by default. Selecting a row opens Call Detail. Row actions offer Play Recording when available, Open Call, and Download MP3 when retained.

### Call Outcomes

Use one canonical outcome everywhere:

- **Answered:** The destination connected
- **Voicemail:** Tracer successfully captured a voicemail instead of connecting the destination
- **Missed:** The destination was reached but did not answer, including busy or declined, and no voicemail was captured
- **Abandoned:** The caller ended before destination connection or voicemail capture
- **Blocked:** The caller failed or did not complete the spam gate
- **Failed:** Tracer or Twilio could not execute the Call Flow

Provider-specific status remains diagnostic metadata and does not appear as a competing top-level outcome.

### States

- **No Calls:** Explain that Calls appear after inbound traffic reaches an assigned Tracking Number.
- **No matches:** Preserve filters and offer `Clear Filters`.
- **Loading:** Use Data Grid Skeleton rows with stable column widths.
- **Fetch error:** Render the error and Retry inside the grid without removing the toolbar.
- **Expired Recording:** Keep the Call row and show recording availability as Expired.

## Call Detail

### Composition plan

1. **Surface:** Operational
2. **Archetype:** Frame stack
3. **Container family:** Frame-led
4. **Density:** Default for reading, dense for metadata and controls
5. **Regions:** Header, waveform player, Transcript, Lead Assessment and Review, call facts, processing timeline
6. **States:** Independent media, Transcript, analysis, and timeline states
7. **Motion:** No entrance; only playhead, seek, zoom, and installed control feedback

### Header

- Primary identity: caller phone number
- Context: Workspace and Tracking Number
- Badges: Call Outcome and effective lead classification
- Previous and next Call navigation preserves the source list's filters
- Actions: Download MP3, Export Call, and an overflow menu
- Operator-only actions: Add or Update Lead Review and Purge Media

### Interactive waveform

Use a sticky Frame below the header so playback remains available while reading the page.

- Aligned Caller and Business waveform lanes when dual-channel audio exists
- Shared playhead, time scale, and zoom
- Single mixed lane fallback when separate channels are unavailable
- Play and pause
- Click or keyboard seek
- Elapsed and total time
- Playback speed
- Volume and mute
- Download MP3
- Clear speaker labels that match the Transcript

Generate waveform peaks in Trigger.dev after a verified R2 Recording upload, using its Audio Waveform build extension. Store derived peak data in R2. Peaks are not authoritative audio and expire or are purged with the Recording. The player must expose equivalent keyboard controls and text labels; the waveform is not the only way to seek.

### Transcript

The Transcript appears immediately below the player.

- Group text into timestamped speaker turns labeled Caller or Business
- Selecting a timestamp or turn seeks playback to its start
- Highlight the active turn during playback
- Auto-scroll while following playback within a bounded Transcript region, so following never scrolls the page, but stop forced scrolling after the user manually moves away
- Offer a `Resume Follow` action when follow mode is paused
- Search within Transcript text
- Evidence snippets referenced by the Lead Assessment link to and emphasize the matching turn
- Do not expose full Transcript content after its 12-month retention period

### Lead Assessment

Show the immutable AI result after the Transcript:

- Good Lead, Not Good Lead, or Uncertain
- Lead score from 0 to 100
- Concise summary
- Rationale
- Timestamp-linked evidence snippets
- Model-processing timestamp

State clearly that the assessment is automated. Pending, failed, skipped, and unavailable are processing states, not lead classifications.

### Lead Review

When present, place Lead Review directly above the AI assessment and label it as the reporting result.

- Classification: Good Lead, Not Good Lead, or Uncertain
- Optional Operator note
- Reviewer and review time
- No replacement human numeric score
- Operator action to update the current review
- Client Viewers can read but cannot edit

### Call facts

Use a dense definition layout for:

- Call start and end
- Total and connected duration
- Tracking Number dialed
- Destination Number used
- Workspace
- Call Outcome
- Spam-gate result
- Recording and retention status
- Twilio call identifier, Operator only

### Processing timeline

Use a compact ReUI Timeline for webhook receipt, routing, Recording transfer, waveform generation, transcription, Lead Assessment, and Lead Review. Failures show a concise error and an Operator-only Retry when the operation is recoverable.

### States

- **Recording processing:** Player-shaped Skeleton with processing status.
- **Recording unavailable:** Explain whether recording was disabled, failed, or expired.
- **Transcript processing:** Preserve the player and show Transcript Skeleton rows.
- **Transcript failed:** Show Retry to Operators and a neutral unavailable message to Client Viewers.
- **Analysis pending or failed:** Keep the Transcript usable and isolate the analysis state.
- **Single-channel fallback:** Label the waveform `Mixed audio` and retain Transcript speaker labels when provided by transcription.
- **Purged media:** Keep Call facts and assessment summary, remove audio, waveform, Transcript text, and Transcript-derived evidence, and label the purge time.

### Purge Media

Purge Media is Operator only and uses an AlertDialog with explicit irreversible confirmation. It deletes Recording audio, waveform peaks, Transcript content, and evidence snippets that reproduce Transcript text. It preserves Call metadata, Call Outcome, non-content Lead Assessment fields, Lead Review, and aggregate analytics. Client Viewers cannot purge content.

## Workspaces

### Composition plan

1. **Surface:** Operational
2. **Archetype:** Table-backed management
3. **Container family:** One Frame around toolbar, grid, and pagination
4. **Density:** Dense
5. **Regions:** Header, lifecycle filters, server-backed Workspace grid
6. **States:** Server-rendered first page, in-place refresh after each action, Data Grid Skeleton rows for later filter or page changes, first-Workspace Empty state, and inline Retry
7. **Motion:** None

### Header and filters

- Title: `Workspaces`
- Description: Active and Setup Required Workspace count
- Primary action: Create Workspace
- Search: Workspace name, Tracking Number, or Destination Number
- Filters: Workspace State and integration health

### Data grid

Columns:

1. Workspace
2. Workspace State
3. Tracking Number
4. Destination Number
5. Calls, last 30 days
6. Good Leads, last 30 days
7. Last Call
8. Integration health
9. Row actions

Workspace State and integration health are separate. State describes lifecycle; health reports whether Twilio, routing, or processing needs attention. Selecting a row opens Workspace Overview.

### Workspace States

- **Setup Required:** Creation or Twilio configuration is incomplete
- **Active:** One active Number Assignment and one publishable Call Flow are in service
- **Archived:** Routing configuration is read-only and historical data remains available

Tracer has no Paused state in the first release.

### Create Workspace wizard

Use a focused wizard Dialog with ReUI Stepper. The visual direction starts from [c-stepper-17](https://reui.io/preview/base/components/c-stepper-17?ref=mcp), adapted to four labeled steps.

#### Step 1: Basics

- Workspace name
- Reporting timezone

#### Step 2: Number

- Refresh United States and Canadian numbers from the connected Twilio account
- Select one number not actively assigned to another Workspace
- Store and display numbers from canonical E.164 values
- Show locality and capabilities when available
- Explain that Tracer will manage the selected number's voice webhook
- Snapshot the number's existing voice configuration for later restoration

#### Step 3: Routing

- Destination Number
- Recording enabled or disabled
- Mandatory disclosure preview when recording is enabled
- Spam gate enabled or disabled
- Whisper enabled or disabled, with message when enabled

These options generate the initial constrained Call Flow. The visual Flow canvas is not embedded in the wizard.

When Resume Setup reopens a Workspace that already has a published Flow Version, such as after Detach Number, the wizard keeps that Flow. A new Destination Number is written into its Forward Call step in a draft, so activation dials the new number and keeps the rest of the Flow. Spam gate and whisper show the Flow's state read-only with an Edit Flow link, as in Workspace Settings.

#### Step 4: Review

- Summarize all settings and the generated Call Flow
- Validate number assignment, Destination Number, and publishability
- Primary action: Create and Activate
- Show progress while Tracer saves the Workspace and updates the Twilio webhook

If the Workspace record is created but external configuration does not complete, preserve it in Setup Required with a clear Retry path. Do not hide partial setup or claim activation succeeded.

### Archive and number replacement

- Both actions require explicit confirmation and are Operator only.
- Tracer never releases a Twilio number.
- Tracer restores the voice configuration captured when the number was attached.
- Number replacement ends the current Number Assignment and starts a new one without deleting Workspace history.
- New attachment failure leaves the Workspace Setup Required with no Number Assignment and provides a Retry path.
- Any Twilio failure during number replacement aborts the replacement and keeps the current Number Assignment Active, for the same reason.
- Restoration failure during archive aborts the archive: the Workspace stays Active with its Number Assignment intact, and the Operator sees the provider error with Retry. Tracer never ends an assignment while Twilio still points at it.

### States

- **No Workspaces:** Explain the Twilio prerequisite and offer Create Workspace.
- **No matches:** Preserve filters and offer Clear Filters.
- **Twilio unavailable:** Keep known Workspaces visible and disable new attachment with an integration error.
- **Setup Required:** Emphasize Resume Setup as the row's primary action.

## Workspace Overview

### Composition plan

1. **Surface:** Operational
2. **Archetype:** Dashboard grid
3. **Container family:** Frame-led
4. **Density:** Dense
5. **Regions:** Workspace header, KPI row, trend chart, routing health and Call Flow summary, recent Calls
6. **States:** Region-level Skeleton, Empty, and Retry states
7. **Motion:** None

### Header

- Workspace name
- Workspace State Badge
- Tracking Number
- Destination Number
- Reporting timezone
- Date controls: 7 Days, 30 Days, 90 Days, All Time, and Custom
- Operator primary action: Edit Flow
- Client Viewer primary action: Generate Report
- Secondary action: Workspace Settings for Operators or Reports for Client Viewers

### Analytics

Use the same definitions and visual order as Home:

1. Total Calls
2. Answer Rate
3. Good Leads
4. Average Connected Duration

The three-series chart shows Total Calls, Answered Calls, and Good Leads. Workspace Overview does not include the fleet-level Workspace performance grid.

### Routing health

Show one compact Frame with:

- Current Tracking Number and Number Assignment start
- Destination Number
- Twilio webhook health
- Last successful inbound Call
- Recording setting
- Spam gate setting
- Whisper setting
- Active Call Flow publication time

Lifecycle state and health remain separate. An Active Workspace can still show an integration warning that needs attention.

### Call Flow summary

Render a read-only linearized summary of the active validated graph rather than the editable React Flow canvas. Show enabled steps and branch outcomes in execution order. Operators use Edit Flow to open the Flow page.

### Recent Calls

Show the five newest Calls with Call Outcome, caller, start time, connected duration, and effective lead classification. Selecting a row opens Call Detail. `View Calls` opens Workspace Calls with the active date range preserved.

### States

- **Setup Required:** Replace live analytics emphasis with a Resume Setup action and a checklist of incomplete requirements.
- **No Calls:** Keep configuration visible and show zero-value analytics with an explanatory Empty state.
- **Routing warning:** Keep analytics usable and isolate the warning in routing health with an Operator-only recovery action.
- **Archived:** Keep historical analytics and Calls readable, label the archived period, and remove live-routing actions.

## Workspace Flow

### Composition plan

1. **Surface:** Operational tool
2. **Archetype:** Three-pane builder
3. **Container family:** Frame-led controls around a React Flow canvas
4. **Density:** Dense
5. **Regions:** Publish toolbar, node palette, canvas, node inspector, validation results
6. **States:** Canvas Skeleton, empty draft guidance, validation errors, and save or publish Retry
7. **Motion:** React Flow pan and node drag only; no entrance animation

### Permissions and versions

- Operator only
- One immutable published Flow Version per Active Workspace
- At most one editable draft based on the published version
- Saving a draft does not affect live calls
- Publishing is atomic and disabled until validation passes
- A Call pins the Flow Version active when the Call begins
- Prior published versions remain read-only for historical diagnosis

### Layout

#### Publish toolbar

- Draft or Published status
- Last saved time and saving state
- Validation action
- Discard Draft
- Version history
- Primary action: Publish

#### Node palette

The left Frame lists only supported nodes and explains when each can be used. Nodes unavailable because of graph constraints remain visible but disabled with a reason.

#### Canvas

The center React Flow canvas supports pan, zoom, fit view, keyboard selection, connection creation, and node movement. It does not permit loops or arbitrary handles. Outcome edges carry explicit labels.

#### Inspector

Selecting a node opens its configuration in the right Frame. Changes save to the draft. The inspector shows field-level validation and the node's expected branches.

### Node catalog

1. **Incoming Call:** Fixed start node; exactly one
2. **Recording Disclosure:** System-managed and required when Workspace recording is enabled
3. **Business Hours:** Optional Open and Closed branches
4. **Keypad Gate:** Optional Pass and Blocked branches; a wrong digit or timeout replays the prompt once, then follows Blocked, and a caller hang-up during the gate is Blocked
5. **Forward Call:** Required destination routing with Answered, Missed, and Failed paths
6. **Whisper:** Optional text-to-speech message for the business before caller connection; it must lead directly to a Forward Call and is heard only by the business after it answers
7. **Voicemail:** Optional terminal capture reached from Closed or Missed paths
8. **Outcome:** Fixed terminal nodes for Answered, Voicemail, Missed, Abandoned, Blocked, and Failed

### Business Hours

- Use the Workspace reporting timezone
- Support recurring weekly open windows
- Use English text-to-speech prompts in the first release
- Support explicit date overrides for one-off open or closed periods
- Enter overnight windows as segments on their respective calendar days; a window may end at 24:00 so an overnight segment reaches midnight
- Choose window and override times in 15-minute steps; a window includes its start and excludes its end
- A date override replaces that date's weekly windows: a Closed override closes the whole day, and several Open overrides on one date combine
- Evaluate open or closed once, when the Call starts
- Do not integrate external calendars or recurring holiday libraries in the first release

### Text-to-speech prompts

Disclosure, keypad instructions, whisper, and voicemail greeting use text-to-speech.

- Editable text with concise character guidance
- Small supported voice list
- Preview action using the browser's speech synthesis, labeled as an approximation of the selected Twilio voice
- No uploaded prompt audio in the first release
- Recording disclosure includes required compliance wording whenever recording is enabled

### Voicemail

- Configurable English text-to-speech greeting
- Caller-only Recording with a single waveform lane
- Maximum capture length of 120 seconds
- Stop after 5 seconds of detectable silence or when the caller presses `#`
- Successful capture, a completed recording with at least 1 second of audio, produces the Voicemail Call Outcome
- Without a usable capture the Call is Missed after a Forward Call Missed branch and Abandoned after Business Hours Closed; a Twilio recording error is Failed
- At least 15 seconds of captured speech makes it eligible for Transcript and Lead Assessment
- Recording, Transcript, and derived waveform peaks follow the same 12-month retention policy

### Publish validation

A draft is publishable only when:

- It has exactly one Incoming Call start
- Every possible path reaches exactly one valid Outcome
- It contains no cycles
- Recording Disclosure is present when recording is enabled
- Every Whisper leads directly to a Forward Call
- Business Hours has both Open and Closed paths
- Keypad Gate has both Pass and Blocked paths
- Forward Call has Answered, Missed, and Failed handling
- Required prompt text and node settings are valid
- The active Number Assignment and Destination Number are valid
- Voicemail is reachable only from supported paths

Validation results appear in a dedicated Frame and link to the affected node. The first release does not include branch simulation or real test calls.

### States

- **No draft:** Show the published graph read-only with Edit Flow.
- **Unsaved changes:** Show saving status without blocking canvas work.
- **Invalid draft:** Preserve the draft and disable Publish; never discard invalid work automatically.
- **Publish failure:** Keep the published version active and the draft intact with Retry.
- **Archived Workspace:** Show historical Flow Versions read-only.

## Reports

### Composition plan

1. **Surface:** Operational
2. **Archetype:** Frame stack with a table-backed history region
3. **Container family:** Frame-led
4. **Density:** Dense
5. **Regions:** Header, report generator, report history Data Grid
6. **States:** Generator validation, history Skeleton rows, Empty state, and inline Retry
7. **Motion:** None

### Scope

- Global Reports allows one or more Workspaces selected from the user's accessible set.
- Workspace Reports fixes scope to the current Workspace.
- A multi-Workspace PDF contains a combined summary followed by clearly separated Workspace sections.
- CSV detail includes a Workspace column.
- Revoking an Access Grant immediately prevents future report access even when a download link has not expired.

### Report periods

- Previous Week, Monday through Sunday in the selected reporting timezone
- Previous Month, using a completed calendar month
- All Time
- Custom Range

Single-Workspace reports use the Workspace reporting timezone. Multi-Workspace reports require one document timezone and default to the requesting user's account timezone. The selected timezone appears in the report.

### Generate Report

Use a focused Dialog with:

- Workspace multi-select when global
- Period preset or custom date range
- Document timezone when multiple Workspaces are selected
- PDF enabled by default
- Optional CSV detail
- Matched Call count preview
- Primary action: Generate Report

Generation is asynchronous. Closing the Dialog does not cancel the job. Completion or failure appears in the notification popover and report history.

### PDF content

1. Tracer orb and wordmark cover
2. Generated time, report period, timezone, and Workspace scope
3. Total Calls
4. Answer Rate
5. Good Leads
6. Lead Rate
7. Average Connected Duration
8. Three-series call trend
9. Call Outcome distribution
10. Effective lead classification distribution
11. Per-Workspace comparison when applicable
12. Concise notable Good Lead list

The PDF does not append every Call row. It labels automated Lead Assessments as estimates and applies Lead Review precedence in reported classifications.

### CSV content

The CSV contains every matching Call with:

- Call identifier
- Workspace
- Tracking Number dialed
- Caller number
- Start time in report timezone
- Call Outcome
- Total duration
- Connected duration
- Effective lead classification
- AI lead score when available
- Lead Review presence
- Recording availability
- Transcript availability

### Report history

Columns:

1. Requested
2. Requested By
3. Scope
4. Period
5. Files
6. Status
7. Expires
8. Row actions

Rows support Download, Regenerate, and View Parameters while authorization remains valid. Generated PDF, CSV, and ZIP artifacts remain in R2 for 7 days. Job metadata and parameters remain for 90 days.

### States

- **No reports:** Explain on-demand generation and offer Generate Report.
- **Generating:** Show job status in history without blocking the page.
- **Failed:** Show a concise reason and Retry when recoverable.
- **Expired:** Keep the history row during metadata retention and offer Regenerate.
- **No matching Calls:** Prevent generation and explain how to change scope or period.

## Users

### Composition plan

1. **Surface:** Operational
2. **Archetype:** Table-backed management
3. **Container family:** One Frame around toolbar, grid, and pagination
4. **Density:** Dense
5. **Regions:** Header, role and state filters, server-backed user grid
6. **States:** Server-rendered user list, in-place refresh after each action, Data Grid Skeleton rows only while reloading after a Retry, first-user protection, and inline Retry
7. **Motion:** None

### Access

Users is visible to Operators only. Client Viewers cannot discover other users or Access Grants.

### Header and filters

- Title: `Users`
- Description: Active Operator and Client Viewer counts
- Primary action: Provision User
- Search: name or email
- Filters: Role, User State, and Workspace access

### Data grid

Columns:

1. User
2. Role
3. User State
4. Workspace Access
5. Last Sign-In
6. Provisioned By
7. Row actions

Use state Badges for Provisioned, Active, and Disabled. Selecting a row opens the management Dialog rather than a permanent detail page.

### Provision User

Fields:

- Email, required and unique after normalization
- Display name, optional until first sign-in
- Role: Operator or Client Viewer
- Workspace Access, required with at least one Workspace for Client Viewer
- Send access-created email, enabled by default

The email contains the Tracer sign-in URL and granted Workspace summary but no password, verification code, or activation token. Provisioning remains successful if delivery fails; show a warning and Resend action.

### Manage User

Operators can:

- Change role
- Add or remove Access Grants
- Resend access instructions while Provisioned
- Disable or re-enable the user
- Review last sign-in and provisioning metadata

Safeguards:

- Never disable or demote the last Active Operator
- Converting an Operator to Client Viewer requires at least one Access Grant
- Removing a Client Viewer's last remaining Access Grant is refused; disable the user to end all access
- New Access Grants target only Active Workspaces
- Converting a Client Viewer to Operator preserves grants for possible later demotion but global Operator access takes precedence
- Disabling a user immediately invalidates active sessions
- Access Grant removal immediately blocks new page loads and generated-file downloads for that Workspace

### User States

- **Provisioned:** Identity and permissions exist, but no successful sign-in has occurred
- **Active:** At least one successful sign-in has occurred and access is enabled
- **Disabled:** Authentication and all access are blocked while history remains

### States

- **No matching users:** Preserve filters and offer Clear Filters.
- **Delivery failure:** Keep the user Provisioned and show Resend Instructions.
- **Last Operator:** Disable destructive role and state actions with a concise explanation.
- **Update error:** Keep the management Dialog open with current edits and Retry.

## Authentication

### Composition plan

1. **Surface:** Flow
2. **Archetype:** Auth card
3. **Container family:** One centered Card
4. **Density:** Default
5. **Regions:** Brand, email-code action, support copy
6. **States:** Inline field errors, busy actions, and recoverable provider errors
7. **Motion:** One subtle Card reveal with reduced-motion fade; no animated orb

### Sign In

Use one centered Card at `max-w-sm` with a restrained gradient orb above the full Tracer lockup.

Order:

1. `Sign in to Tracer`
2. One-clause description
3. Email field
4. Send Code
5. Access support copy

Only provisioned, non-disabled identities may continue. Email-code authentication never creates a Tracer user. The email-code send response remains generic so it does not disclose whether an address is provisioned.

### Verify Email Code

Adapt [c-input-otp-6](https://reui.io/preview/base/components/c-input-otp-6?ref=mcp).

- Six-digit code
- Five-minute expiration
- Three verification attempts before requiring a new code
- Full paste support
- Resend cooldown
- Change Email action returns to Sign In
- Display the normalized destination email in masked form
- Successful verification marks a Provisioned user Active and creates a session

### Authentication rules

- Better Auth Email OTP plugin
- Email OTP sign-up disabled
- Email OTP never creates a user
- Disabled users cannot authenticate
- No passwords, password reset, or password settings
- Authentication verifies identity; application role and Access Grants authorize resources
- Generic user-facing errors do not expose provisioning status

## Account Settings

### Composition plan

1. **Surface:** Operational
2. **Archetype:** Vertical rail settings
3. **Container family:** Frame-led
4. **Density:** Default
5. **Regions:** Section rail and one active settings section
6. **States:** Field Skeletons, inline validation, save success, and Retry
7. **Motion:** Installed section control behavior only

The rail becomes horizontally scrollable below `md`. Use [c-field-7](https://reui.io/preview/base/components/c-field-7?ref=mcp) as the form-composition reference, with working submit behavior and dynamic validation.

### Profile

- Display name
- Read-only sign-in email
- Read-only role
- Read-only User State
- Save action

Users cannot change their own sign-in email. Operators replace it through Users with verification and uniqueness checks.

### Preferences

- User timezone
- Date and time preview
- Save action

Global dashboards, Activity grouping, and multi-Workspace report defaults use this timezone. Workspace views and single-Workspace reports use the Workspace reporting timezone.

### Security

- Available email-code sign-in
- Current session details
- Other active sessions with last activity and approximate device information
- Revoke individual session
- Sign Out All Other Sessions

There is no password section. Revoking the current session redirects to Sign In. Disabled users have all sessions invalidated by the Operator action.

### States

- **No other sessions:** Show the current session only.
- **Save success:** Use a concise toast.
- **Session revoke failure:** Keep the session visible and offer Retry.

## Integrations

### Composition plan

1. **Surface:** Operational
2. **Archetype:** Frame stack
3. **Container family:** Frame-led
4. **Density:** Dense
5. **Regions:** Header, provider health summary, one Frame per integration
6. **States:** Server-rendered provider health, configured or missing state, test progress, and an inline Retry when a background refresh fails
7. **Motion:** None

### Access and secrets

Integrations is visible to Operators only. R2, Hyperdrive, OpenAI, Trigger.dev, and Cloudflare Email Service credentials are deployment secrets or bindings. Twilio is the exception: its API key is an encrypted Organization credential entered and rotated in this page. Tracer never reveals a stored secret value.

Each provider Frame shows:

- Connection state
- Non-secret account or resource identifier
- Last successful operation
- Last failed operation with concise detail
- Test Connection action
- Link or instruction for external configuration

### Twilio

- Account SID
- API key SID
- API key secret entry shown only when connecting or rotating
- Encrypted Organization credential status
- Webhook Auth Token status, Configured or Not configured, with a Set Auth Token dialog; Workspace activation requires it because Tracer validates every Twilio webhook signature with it
- Number inventory sync state and last sync time
- Active Number Assignment count
- Recent webhook health
- Connect, Test Connection, Rotate Key, Set Auth Token, and Disconnect actions
- Never purchase or release numbers from Tracer

The API key secret is encrypted with a deployment-held master key and never displayed again. Disconnect is blocked while Active Workspaces depend on the connection.

### Cloudflare R2

- Bucket name
- Binding status
- Last successful Recording upload
- Recent transfer failures
- Test a temporary write, read, and cleanup cycle

### OpenAI

- Configured transcription model
- Configured lead-analysis model
- Last successful Transcript and Lead Assessment
- Recent processing failures
- Test authentication with a minimal request that does not send customer audio

### Trigger.dev

- Managed Trigger.dev Cloud project status
- Task deployment version
- Recording-processing queue health
- Report and export queue health
- Recent failed runs with links to Trigger.dev observability
- Test a minimal no-customer-data task

Trigger.dev owns durable background work: verified Recording transfer, Twilio media cleanup, waveform generation, OpenAI transcription and Lead Assessment, report generation, bulk audio export, retries, and concurrency limits. Every run uses an idempotency key derived from the Tracer job or provider event.

### Cloudflare Email Service

Cloudflare Email Service is the transactional provider for verification codes and access notices.

- Sending domain and verification state
- Workers binding status
- Monthly usage and included-quota visibility when available
- Recent delivered, queued, and permanent-bounce outcomes
- Send Test Email action to the current Operator
- Public-beta dependency label with a link to operational documentation

Cloudflare Email Service requires Cloudflare DNS and Workers Paid for arbitrary recipients. The current pricing model includes 3,000 outbound emails per month and charges for usage above that allowance.

### States

- **Not configured:** Explain the missing deployment binding or secret without exposing values.
- **Degraded:** Keep unaffected providers usable and show the failing capability.
- **Test running:** Show progress only inside the tested provider Frame.
- **Test failed:** Preserve the last successful check and show Retry.

## Workspace Settings

### Composition plan

1. **Surface:** Operational
2. **Archetype:** Vertical rail settings
3. **Container family:** Frame-led
4. **Density:** Default forms with dense metadata
5. **Regions:** General, Number, Recording and AI, Access, Danger
6. **States:** Server-rendered section data, inline validation, save success, and Retry
7. **Motion:** Installed section control behavior only

Workspace Settings is Operator only. Client Viewers do not see the tab. Each section is its own page at `/workspaces/[id]/settings/[section]` (`general`, `number`, `recording`, `access`, `danger`), selected from the vertical rail; `/workspaces/[id]/settings` opens General.

### General

- Workspace name
- Reporting timezone
- Read-only Workspace State
- Save action

Changing timezone affects future date grouping and report interpretation. Stored timestamps remain UTC.

### Number

- Active Tracking Number
- Number Assignment start time
- Masked prior Twilio voice configuration status
- Read-only Destination Number with `Edit Flow` link
- Replace Number action
- Detach Number action

Replace Number is available for any Active Workspace. Its confirmation dialog selects an unassigned Twilio number, ends the current Number Assignment, starts a new one, attaches Tracer to the new number, and then restores the old number's saved voice configuration, so at least one number always routes to Tracer. Historical Calls retain the number dialed. Any Twilio failure aborts the replacement: the new number's captured configuration is restored, the Workspace stays Active on its current Tracking Number, and the Operator sees the provider error.

Detach Number is available for any Active Workspace when no replacement number is wanted. After confirmation it restores the number's saved voice configuration, ends the Number Assignment as detached, and returns the Workspace to Setup Required with its Calls and Flow Versions intact. The number stays in the Twilio account; Tracer never releases a number from Twilio. Client Viewers lose access until the Workspace is activated on a number again. A Twilio failure aborts the detach and keeps the Workspace Active on its current Tracking Number.

### Recording and AI

- Recording enabled or disabled
- Fixed disclosure preview: `This call may be recorded for quality purposes.`
- Supported text-to-speech voice selection
- Automatic transcription and Lead Assessment enabled or disabled
- Read-only 15-second eligibility threshold
- Read-only 12-month Recording and Transcript retention policy

Recording may be enabled while automatic analysis is disabled. Analysis cannot be enabled while recording is disabled. The disclosure sentence cannot be edited or removed while recording is enabled. The recording setting governs connected conversations only; a Voicemail step captures the caller's message whether or not recording is enabled.

### Access

- Client Viewer list with User State
- Add Access action
- Remove Access action
- Link to provision a new Client Viewer

Access Grants are explicit per Workspace. Removing a grant immediately blocks page access and generated-file downloads for that Workspace. Operators have global access and do not appear as Access Grants. Existing grants keep read-only access after archive and authorize nothing while a restored Workspace is Setup Required.

### Danger

#### Archive Workspace

- Explain that Tracer routing will stop
- Restore the current Tracking Number's prior Twilio voice configuration
- Preserve Calls, analytics, reports, Number Assignment history, and Flow Versions
- Require explicit confirmation

#### Restore Workspace

Restore changes Archived to Setup Required. It never silently reattaches the former number. An Operator must confirm or select a Tracking Number, validate routing, and activate the Workspace again.

Tracer does not permanently delete a Workspace in the first release.

### States

- **Setup Required:** Emphasize incomplete number or routing configuration and Resume Setup.
- **Number replacement failure:** Keep the current Tracking Number and Number Assignment, and explain that the replacement did not complete.
- **Access removal conflict:** Keep the current list and explain why the grant was not removed.
- **Archived:** General information remains readable; Number, Recording and AI, and Access controls are disabled until Restore.

## Workspace Calls and Reports

Workspace Calls reuses the global Calls page with Workspace scope fixed and the Workspace filter removed. Workspace Reports reuses Reports with Workspace selection fixed. Both preserve the Workspace tab shell and use its reporting timezone.
