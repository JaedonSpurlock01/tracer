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

Tracer follows a call from first contact through routing, recording, transcription, and lead judgment. The visual identity is a terminal-styled, minimalist interface: flat matte surfaces, hairline borders, monospace identifiers, and a soft gradient orb as the mark, representing a call moving through the system. It should feel technical without stopping being customer-facing.

### Mark

- The mark is a gradient orb: a radial highlight from zinc-50 through zinc-400 to zinc-700, drawn by `BrandMark` in `components/tracer/brand.tsx`.
- The lockup pairs the orb with the `Tracer` wordmark in Geist Semibold on authentication screens and report covers.
- The orb alone appears in the Sidebar account menu trigger and as the favicon (`app/icon.svg`).
- Use at most one orb per view, never behind tables, charts, transcripts, forms, or other data-heavy regions.
- Treat the orb as decorative, hidden from assistive technology, with no perpetual animation.
- Do not place a tagline in application chrome.

### Line art

Empty states use single-weight vector line art drawn in `components/tracer/line-art.tsx`: dashed isometric orbits with one small subject, stroked in the muted foreground at reduced opacity. Scenes are decorative, hidden from assistive technology, and sit only in Empty states, never behind data. The scenes are No Activity (a listening tracking line), No Calls (an empty call log card), No Transcript (a recording strip at 0:00, used when a Transcript was skipped or never existed), No Reports (a report page with empty bars), No Workspaces (an open slot), and No Results (a lens over the field). Other Empty states use the shared `EmptyState` without art until a scene is approved for them.

Three scenes carry slow ambient motion, defined in `globals.css` under `.line-art-motion`: the Activity sweep circles its orbit with a ping once per pass, the Reports page drifts up and down, and the Calls row markers spin now and then. Motion only moves elements the static drawing already has, is skipped for viewers who prefer reduced motion, and switches off everywhere through the `lineArtMotion` constant in `line-art.tsx`, which restores the static scenes exactly.

### Color

Colors are implemented through shadcn-compatible semantic tokens rather than raw values in components. Tracer ships five themes, Dark (the default), Light, and three experiments: Midnight (deep navy), Blossom (rose light), and Blossom Dark (plum); the two Blossom themes use their rose primary as the key chart series. They are chosen in Account Settings under Preferences. A theme is one token block in `app/globals.css` selected by `data-theme`, plus an entry in `data/theme.ts`; adding a theme needs nothing else. The choice is kept in a cookie per browser, so the server renders the chosen theme on the first response. The palette is shadcn zinc with the three darkest steps redefined; the table below is the Dark theme. Light inverts the layering on near-white: zinc-100 root and Sidebar, white panels, zinc-900 primary.

| Role | Color | Intended use |
| --- | --- | --- |
| zinc-950 | `#09090a` | App root, Sidebar, and page background |
| zinc-900 | `#121213` | Cards, panels, popovers, and dialogs |
| zinc-800 | `#1a1a1b` | Hover and active rows, secondary controls, Skeletons |
| zinc-400 | Tailwind default | Muted text and focus ring |
| zinc-50 | Tailwind default | Foreground text and primary controls |
| Brand orange | `#f79d71` | The warm accent for the key chart series and nothing else |

Surfaces layer from dark to light: the root is darkest, panels sit one step lighter, and raised controls one step lighter again. Every layer boundary is a 1px `border-border` hairline at 10% white. There are no drop shadows on in-flow surfaces; floating menus and popovers may use `shadow-sm` at most.

Content regions (the Sidebar inset and authentication pages) carry the `bg-grain` utility, a faint monochrome noise that gives surfaces a matte-paper finish. The Sidebar and panels stay flat.

Status meaning uses ReUI semantic success, warning, info, and destructive tokens through Badge and Alert variants. The Tracer palette expresses brand and chart-series identity, not success or failure.

Chart identities are Brand orange for Good Leads, zinc-50 for Answered Calls, and zinc-400 for Total Calls. Series must also differ by labels, markers, or line styles so color is not the only distinction.

### Geometry

- `--radius` is `0.25rem`. Panels, Cards, and Dialogs use `rounded-lg` (4px); controls and menus use `rounded-md` (2px) or `rounded-lg`. Nothing in application chrome is rounder than 8px.
- Panels are flat: one background, one hairline, inner padding, no inner ring and no shadow. A Frame is a chrome-free column that spaces its panels; a FramePanel is the surface.
- The Sidebar sits flush on the root color with a single hairline on its content edge; it is never inset or floating.

### Typography

- Use Geist throughout the product and generated reports.
- Use Geist Semibold for the wordmark and page headings.
- Use Geist Mono (`font-mono`) for identifiers: phone numbers, Organization slugs, timestamps, durations, scores, and KPI values. Body copy, labels, headings, and navigation stay in Geist Sans.
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
- Use the shadcn Sidebar as the application shell, with the account menu at the top and no Workspace switcher. The content header holds the Sidebar trigger, route breadcrumbs (every segment linked but the current page, with Workspace and Call segments named by their records), and the notification popover.
- Prefer Frame-led pages and dense controls. Each FramePanel is one flat surface; headings live inside the panel.
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

The top of the Sidebar holds the account menu, replacing a separate brand row and footer card. Its trigger shows the Tracer orb, the user's name, and the current Organization slug in Geist Mono. The menu contains:

1. **Organizations:** the current Organization with its name, slug, and a check, then a disabled New organization action until multiple Organizations are supported
2. **User:** a DiceBear Gaze avatar seeded by the user id, the name, the email, and an outline role Badge
3. **Account Settings**
4. **Sign out**, styled as destructive

The Sidebar has no Workspace switcher; the Workspaces page owns Workspace selection. Account Settings is reached from the account menu rather than occupying primary navigation.

### Workspace navigation

Inside a Workspace (any route under `/workspaces/[id]` except Call Detail's breadcrumb context, which also counts) the Sidebar keeps the account menu and swaps its navigation for that Workspace's pages, so the shell scales as Business HQ domains arrive:

1. **All Workspaces**, a muted back link with a left arrow
2. The Workspace name as a group heading, then **Overview**
3. **Website** group: Site, with Forms and Business Profile shown disabled with a `Soon` Badge once those milestones are scheduled, never before
4. **Phone** group: Calls, Flow (Operator only), with Messages disabled the same way
5. **Reports**
6. **Settings**, Operator only

The Workspace Sidebar replaced the Workspace tabs in M20. Every Workspace page marks its own item as current; Workspace Settings sections all mark Settings. Call Detail keeps the Workspace Sidebar with Calls current. The content header breadcrumbs are unchanged. Outside a Workspace the global navigation above applies. The Workspace layout registers the Workspace name, state, and the actor's role for the Sidebar the way it registers the breadcrumb label.

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
- Site
- Calls
- Flow
- Reports
- Settings

### Record detail

- Call Detail

### Reference

- Pricing guide, Operator only

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

### Money row (M22, Operator only)

A second row of three tiles below the KPI row, hidden from Client Viewers:

1. **Monthly Cost:** this calendar month's projected cost across the Workspaces in scope, with the yearly projection beneath
2. **Monthly Revenue:** the projected revenue of open Deals in scope
3. **Profit:** revenue minus cost, shown in the success color when positive and the destructive color when negative

Workspace performance gains Cost and Revenue columns for Operators.

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
9. Media purged

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
3. **Container family:** One Frame around toolbar, ledger, and pagination
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

Both exports operate on the current scope, date range, search, and filters. Tracer does not use row-selection checkboxes in the first release. Before creating an export, a confirmation shows matched Calls, retained Recordings, expired media, purged media, and calls without recordings. A Recording ZIP omits expired and purged media, and its `manifest.csv` names each omitted Recording's reason, with Purged kept distinct from Expired. A Recording export is limited to 500 retained Recordings; above that, the confirmation blocks the export and asks the user to narrow the filters.

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
- **Purged Recording:** Keep the Call row and show recording availability as Purged, ahead of Expired, without Play Recording or Download MP3. The Recording availability filter offers Purged beside Expired.

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

The rationale and evidence reproduce Transcript content, so they are removed with the Transcript when media expires or is purged; the Rationale heading then does not render, while the classification, score, summary, and processing timestamp remain.

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
- **Recording expired:** Keep Call facts and the assessment summary, explain that media is removed 12 months after the Call, and show the expiry date in the Recording fact.
- **Purged media:** Keep Call facts, the assessment summary, classification, and score, and the Lead Review; remove audio, waveform, Download MP3, Transcript text, Transcript-derived evidence, and rationale; label the purge time in the Recording fact and end the processing timeline with Media purged. Stages that can no longer run after a purge do not show as pending. A purge takes precedence over expiry.

### Purge Media

Purge Media is Operator only and uses an AlertDialog with explicit irreversible confirmation: the destructive Purge Media button stays disabled until the Operator ticks the acknowledgement checkbox "I understand this permanently deletes this Call's media", which is cleared each time the dialog opens. It deletes Recording audio, waveform peaks, the MP3, Transcript content, the evidence snippets and rationale that reproduce Transcript text, any copy of the audio still at Twilio, and any unexpired export ZIPs that include the Recording. It preserves Call metadata, Call Outcome, the Lead Assessment summary, classification, and score, Lead Review, and aggregate analytics. Client Viewers cannot purge content and never see the action.

- Placement: a destructive Button in the Call Detail header actions, shown only while a Recording exists whose media has neither expired nor been purged
- Confirmation: the AlertDialog states that the purge cannot be undone, lists what is deleted and what is kept, and purges nothing until the destructive action is confirmed
- Pending: the confirm action shows a Spinner and `Purging...` and both actions are disabled
- Success: the dialog closes and Call Detail shows the purged media state
- Conflict: when the media was already purged, expired, or has no Recording, the dialog explains which and Call Detail refreshes
- Other failures: the dialog stays open with a concise error so the Operator can try again

## Workspaces

### Composition plan

1. **Surface:** Operational
2. **Archetype:** Table-backed management
3. **Container family:** One Frame around toolbar, ledger, and pagination
4. **Density:** Dense
5. **Regions:** Header, Workspace State chips and search, server-backed triage ledger
6. **States:** Server-rendered first page, in-place refresh after each action, Skeleton rows for later filter or page changes, first-Workspace Empty state, and inline Retry
7. **Motion:** None

### Header and filters

- Title: `Workspaces`
- Description: Setup Required, Active, and Archived Workspace counts
- Primary action: Create Workspace
- Search: Workspace name, Tracking Number, or Destination Number
- Filter: Workspace State as chips with counts (All, Setup Required, Active, Archived); Client Viewers see no Setup Required chip

### Triage ledger

One table grouped in triage order, each group with a collapsible heading and count:

1. **Needs attention:** Setup Required Workspaces and Active Workspaces whose attention roll-up asks for an Operator
2. **Running:** the remaining Active Workspaces
3. **Archived:** collapsed unless the Archived chip is selected

Columns:

1. Workspace: name, Workspace State Badge, and the reporting timezone, or `Next: <requirement>` from the setup checklist while Setup Required
2. Routing: Tracking Number over `→ Destination Number`, in Geist Mono
3. Calls, last 30 days
4. Good Leads, last 30 days
5. Lead rate: Good Leads over Calls as a bar and percentage, blank without Calls
6. Last Call, in the reporting timezone
7. Attention: the analytics roll-up (Healthy, Needs attention, or Not applicable) with its reason beneath, such as `Site Down` or `No accepted Twilio webhook yet`
8. Row action: Resume Setup while Setup Required for Operators, otherwise Open

Workspace State and attention are separate. State describes lifecycle; attention reports whether Twilio, routing, or the linked Site needs an Operator, and the analytics module owns that rule so every view agrees. Selecting a row opens Workspace Overview.

### Workspace States

- **Setup Required:** Creation or Twilio configuration is incomplete
- **Active:** One active Number Assignment and one publishable Call Flow are in service
- **Archived:** Routing configuration is read-only and historical data remains available

Tracer has no Paused state in the first release.

### Create Workspace wizard

Use a focused wizard Dialog with ReUI Stepper, owned by `components/tracer/workspace-setup-wizard.tsx` and mounted fresh by the list for each creation or resume. The visual direction starts from [c-stepper-17](https://reui.io/preview/base/components/c-stepper-17?ref=mcp), adapted to five labeled steps: Basics, Site, Number, Routing, Review.

#### Step 1: Basics

- Workspace name
- Reporting timezone

#### Step 2: Site

- List the connected account's Sites with a preview thumbnail, primary hostname, last deployment, and 30-day visits, five per page with Previous and Next and a hostname search
- Each Site is Available or shows `Linked to <Workspace>` and cannot be chosen
- Skip is always available; a Workspace needs no Site to activate
- When Cloudflare is not connected, the step explains that and links Operators to Integrations
- Resume Setup shows the current Site Link read-only with a Change action

#### Step 3: Number

- Refresh United States and Canadian numbers from the connected Twilio account
- Select one number not actively assigned to another Workspace
- Store and display numbers from canonical E.164 values
- Show locality and capabilities when available
- Explain that Tracer will manage the selected number's voice webhook
- Snapshot the number's existing voice configuration for later restoration

#### Step 4: Routing

- Destination Number
- Recording enabled or disabled
- Mandatory disclosure preview when recording is enabled
- Spam gate enabled or disabled
- Whisper enabled or disabled, with message when enabled

These options generate the initial constrained Call Flow. The visual Flow canvas is not embedded in the wizard.

When Resume Setup reopens a Workspace that already has a published Flow Version, such as after Detach Number, the wizard keeps that Flow. A new Destination Number is written into its Forward Call step in a draft, so activation dials the new number and keeps the rest of the Flow. Spam gate and whisper show the Flow's state read-only with an Edit Flow link, as in Workspace Settings.

#### Step 5: Review

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

### Scorecard

Above the Call analytics, one row of six dense tiles summarizes the business (the row the shell prototype settled on). Tiles whose milestone has not shipped are omitted, never shown empty:

1. **Visits** over the range, from the linked Site
2. **Calls**
3. **Visit-to-Call:** Calls divided by Visits, in the brand accent
4. **Search Visibility** (M21), with `of 100`
5. **Monthly Cost** (M22, Operator only), with the yearly projection beneath
6. **Profit** (M22, Operator only), with the Deal beneath

Without a linked Site the row shows only the tiles that need no Site, and the Site summary panel offers Link Site.

### Site summary

One compact panel between the Scorecard and the analytics: the preview thumbnail, primary hostname, Site Health Badge, uptime over 30 days, and last deployment, linking to the Site page. Without a Site Link it is an Empty state with Link Site for Operators and a one-line explanation for Client Viewers.

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

Render the published graph read-only as a spine rather than the editable canvas: the main path (next, Open, Pass, Answered) runs top to bottom, each step with its icon, title, and detail line, and every other branch hangs beneath its step as an exit chip naming the branch in its tone and where it leads (the Outcome, or the steps on the way to it). The panel heading carries the version Badge and, for Operators of an Active Workspace, Open Flow.

### Recent Calls

Show the five newest Calls with Call Outcome, caller, start time, connected duration, and effective lead classification. Selecting a row opens Call Detail. `View Calls` opens Workspace Calls with the active date range preserved.

### States

- **Setup Required:** Replace live analytics emphasis with a Resume Setup action and a checklist of incomplete requirements.
- **No Calls:** Keep configuration visible and show zero-value analytics with an explanatory Empty state.
- **Routing warning:** Keep analytics usable and isolate the warning in routing health with an Operator-only recovery action.
- **Archived:** Keep historical analytics and Calls readable, label the archived period, and remove live-routing actions.

## Site

### Composition plan

1. **Surface:** Operational
2. **Archetype:** Dashboard stack with a hero
3. **Container family:** Frame-led
4. **Density:** Dense
5. **Regions:** Workspace header, hero preview, KPI row, traffic chart, pages and referrers, performance and search, deal and cost, hosting
6. **States:** Region-level Skeleton, Empty, and Retry states; No Site; Preview pending; Syncing; Cloudflare disconnected
7. **Motion:** None

The Site page is `/workspaces/[id]/site`, reachable from the Website group of the Workspace Sidebar and from the Overview Site summary. It shows the linked Site; Workspaces without a Site Link show an Empty state with Link Site for Operators.

### Header

The Workspace header (name, state, Tracking Number, primary hostname, timezone) with Replace Site for Operators and Open Site, which opens the apex URL in a new tab.

### Hero preview

One panel. Left, the preview image at 16:10 inside a hairline rounded-md frame, object-fit cover aligned to the top, linking to the Site in a new tab with an `Open` affordance on hover. Right, a dense definition list: Site Health Badge, Uptime over 30 days with the median response time, Last deploy, Hostnames (apex, then www), and for Operators the Worker name. Beneath, the capture time: `Preview captured 2 hours ago` or `Preview pending` while the first capture runs. Health rules are in the roadmap M20 note and the Warning or Down reason appears as one sentence next to the Badge.

### Date controls and KPI row

The Workspace date controls, then four tiles:

1. **Visits:** sessions on the Site
2. **Page Views**
3. **Calls:** Calls to the Tracking Number over the same range
4. **Visit-to-Call:** Calls divided by Visits, in the brand accent

### Traffic and Calls

One two-series line chart in the Workspace timezone: Visits in the muted series and Calls in the brand accent, dashed, with the same legend, sr-only table, and daily or weekly interval rules as Call trends.

### Pages and referrers

Two panels side by side. Top pages lists up to eight paths with page views as a muted proportional bar behind the mono path; Referrers lists up to eight hosts the same way, with `(direct)` for empty referrers and the device split in one line beneath.

### Performance

Largest Contentful Paint, Interaction to Next Paint, and Cumulative Layout Shift at the 75th percentile over the range, each with a Good or Needs work Badge at the Core Web Vitals thresholds (2.5 s, 200 ms, 0.1).

### Search (M21)

Beside Performance: the Search Visibility score as `42` with a muted `/100`, a 30-day sparkline, and a table of Keywords with weight, position, and 7-day change (green up, red down, muted zero, `Not ranking`). Before M21 ships the panel is omitted, never shown empty.

### Deal and cost (M22, Operator only)

Deal, Cost, and Profit per month in a three-column definition list with Edit Deal, and one line naming what cost includes. Hidden from Client Viewers.

### Hosting (Operator only)

Requests and errors over 7 days, hostname certificates as a count Badge, Refresh Preview, and the last ten deployments with short version, source, time, and a `Live` Badge on the current one. Hidden from Client Viewers.

### States

- **No Site:** Empty state with the No Workspaces line art, Link Site for Operators, and `No Site is linked to this Workspace` for Client Viewers.
- **Syncing:** before the first sync, tiles and chart show Skeletons with `First sync in progress`.
- **Preview pending:** the hero shows a Skeleton at 16:10 with the capture status.
- **Cloudflare disconnected:** keep the last synced data and show a warning line in the hero with a link to Integrations for Operators.
- **Down:** the hero Badge reads Down with the last check time; analytics stay readable.

## Workspace Flow

### Composition plan

1. **Surface:** Operational tool
2. **Archetype:** Three-pane builder
3. **Container family:** Frame-led controls around a React Flow canvas
4. **Density:** Dense
5. **Regions:** Publish toolbar; a canvas with the node palette, the inspector, and validation issues docked inside it
6. **States:** Canvas Skeleton, empty draft guidance, validation errors, and save or publish Retry
7. **Motion:** React Flow pan and zoom only; no entrance animation

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

- Draft (with the version it is based on) or Published status
- Saving state
- Publishable, or the live issue count
- Discard Draft
- Version history
- Primary action: Publish

#### Node palette

A compact chip row docked at the top-left of the canvas lists only supported nodes, each with an icon and a hint on hover. Nodes unavailable because of graph constraints remain visible but disabled with a reason.

#### Canvas

The React Flow canvas lays the flow out as a tree: each step sits one layer below its parent and sibling branches fan out side by side, so positions are derived from the graph and nodes are never dragged. A node shows its icon, title, detail line, Outcome Badge, and issue count; a branch edge is labeled and colored by its tone (Open, Pass, and Answered success; Closed and Missed warning; Blocked and Failed destructive; `next` neutral and unlabeled). The canvas supports pan, zoom, fit view, keyboard selection, and connection creation. It does not permit loops or arbitrary handles. React Flow chrome follows the active theme tokens.

#### Inspector

Selecting a node docks its configuration over the right edge of the canvas, headed by the node's icon and title. Changes save to the draft. The inspector shows field-level validation and the node's expected branches, with targets named by their title and detail.

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

Validation runs on every change. The toolbar shows Publishable or the issue count, and the issues dock at the bottom-left of the canvas, each naming the affected step and selecting it when chosen. The first release does not include branch simulation or real test calls.

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

Rows support Download, Regenerate, and View Parameters while authorization remains valid. Generated PDF, CSV, and ZIP artifacts remain in R2 for 7 days. A Recording ZIP or Export Call that includes a Recording whose media an Operator purges expires at the purge, so its row shows Expired with Regenerate, and the regenerated export omits that Recording as Purged. Job metadata and parameters remain for 90 days.

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
3. **Container family:** One Frame around toolbar, ledger, and pagination
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

Use one centered Card at `max-w-sm` with the Tracer lockup (orb and wordmark) above it on the grained page background.

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
2. **Archetype:** Master-detail
3. **Container family:** Frame-led
4. **Density:** Dense
5. **Regions:** Header with a readiness line, a Needs attention lane, a provider navigation, and one provider's detail Frame
6. **States:** Server-rendered provider health, configured or missing state, test progress, and an inline Retry when a background refresh fails
7. **Motion:** None

### Layout

The header states how many providers are ready beside a status dot that turns to warning while anything needs attention. Below it, a **Needs attention** lane appears only when there is something an Operator can resolve from this page: an Organization credential that can be connected (with its Connect action inline), a connected Twilio account without a webhook Auth Token (Set Auth Token), and any degraded provider with its failure detail and a View link. The lane is omitted when nothing needs attention.

The page then splits into a provider navigation and a detail. The navigation, a 15rem column at `md` and a horizontal chip row below it, groups providers as **Organization connections** (Twilio, Cloudflare, DataForSEO) and **Platform services** (Hyperdrive, Cloudflare Email Service, Cloudflare R2, OpenAI, Trigger.dev). Each item shows the provider's monochrome mark from `components/tracer/provider-logo.tsx`, its name, a one-line summary (account and number count, Sites and linked count, Keywords and lookups, models, bucket, or sending address), and a status dot. The selected provider is kept in the `provider` search parameter, defaulting to Twilio, so other pages link straight to a provider, for example `/integrations?provider=cloudflare` from the Workspace wizard's Site step.

The detail is one Frame. Its first panel carries the mark, the provider name, the state Badge, the summary line, the action toolbar on the right, any error line with Retry, and a three-column fact list. Further panels hold the provider's tables at full width: Numbers for Twilio, Sites for Cloudflare, Recording transfer failures for R2 and Trigger.dev, and Media cleanup for Trigger.dev. Placeholders for data that does not exist yet are not rendered.

### Access and secrets

Integrations is visible to Operators only. R2, Hyperdrive, OpenAI, Trigger.dev, and Cloudflare Email Service credentials are deployment secrets or bindings. Twilio, Cloudflare, and DataForSEO are the exceptions: their credentials are encrypted Organization credentials entered, tested, rotated, and disconnected in this page through a Connect dialog. Tracer never reveals a stored secret value.

### Cloudflare

The Cloudflare Frame holds Connect (Account ID and API token, with a link to Cloudflare's token page and the four permissions the token needs listed), then once connected the account identifier, Connected by and time, Last verified, Test, Rotate Token, Disconnect (blocked while any Site Link is open, with the count), Last sync time with an Operator Sync now action, and a Sites table: preview thumbnail, primary hostname, Site Health Badge, last deployment, 30-day visits, and `Linked to <Workspace>` or `Not linked`. Workers without a custom domain never appear.

### DataForSEO (M21)

Connect (API login and password), the login shown once connected, Test, Rotate, Disconnect, last check time, lookups this month, and Keywords tracked.

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
- Unfinished media cleanup: the count of purged or expired Recordings whose cleanup is still unfinished 26 hours after purge or expiry, or blocked by a missing Twilio connection, and a table of the 5 oldest with a View Call link, Workspace, Purged or Expired, since when, and whether Twilio is not connected or the daily sweep retries it; the card is Degraded while any remain, and shows "No unfinished media cleanup." otherwise
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
5. **Regions:** General, Site, Number, Recording and AI, Access, Danger
6. **States:** Server-rendered section data, inline validation, save success, and Retry
7. **Motion:** Installed section control behavior only

Workspace Settings is Operator only. Client Viewers do not see the tab. Each section is its own page at `/workspaces/[id]/settings/[section]` (`general`, `site`, `number`, `recording`, `access`, `danger`), selected from the vertical rail; `/workspaces/[id]/settings` opens General.

### Site

- Linked Site with preview thumbnail, primary hostname, and Site Link start time, or an Empty state with Link Site
- Replace Site opens the same Site picker as the wizard and ends the current Site Link before starting the new one
- Detach Site ends the Site Link after confirmation and never changes Cloudflare
- Service Area (M21): city, region, and country
- Keywords (M21): phrase and weight from 1 to 5, add and remove, at most 25
- Domain renewal (M22): registrar, annual price, and renewal date
- Deal (M22): Monthly, Weekly, or Per Lead with an amount, start date, and optional end date; ending a Deal keeps it in history

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
