# Tracer

Tracer is Spurlock Labs' internal call-tracking context for operating lead-generation phone numbers and giving Operator-provisioned business clients scoped reporting access.

## Language

**Organization**:
The top-level Tracer tenant that owns users, Workspaces, and the Twilio connection; the first release contains only Spurlock Labs.
_Avoid_: Client business, Workspace

**Workspace**:
An Operator-defined operational container for call routing, history, analytics, and access, with one active Tracking Number at a time.
_Avoid_: Customer account, Tracking Number

**Workspace State**:
The lifecycle position of a Workspace: Setup Required, Active, or Archived.
_Avoid_: Call Outcome, integration health

**Tracking Number**:
A Twilio-owned phone number published on a lead-generation website and routed to a Destination Number.
_Avoid_: Workspace, business number

**Number Assignment**:
The period during which one Tracking Number is active in one Workspace.
_Avoid_: Workspace

**Destination Number**:
The business phone number to which eligible inbound calls are forwarded.
_Avoid_: Tracking Number

**Operator**:
A Spurlock Labs user with full Organization access to create Workspaces, manage users, and attach or configure Tracking Numbers imported from Twilio.
_Avoid_: Customer, client

**Client Viewer**:
An Operator-provisioned business user with read-only access to explicitly authorized Workspaces and their reports.
_Avoid_: Operator, admin

**User State**:
The access lifecycle of an Operator or Client Viewer: Provisioned, Active, or Disabled.
_Avoid_: Role

**Access Grant**:
The explicit authorization connecting one Client Viewer to one Workspace.
_Avoid_: Workspace membership, customer account

**Call Flow**:
A validated graph of approved steps and branches that governs how inbound Calls are handled in one Workspace.
_Avoid_: Arbitrary TwiML, script

**Flow Version**:
An immutable published snapshot of a Call Flow that is pinned to every Call started while it is active.
_Avoid_: Draft

**Recording**:
Captured audio from a connected conversation or voicemail, retained in private object storage with separate Caller and Business channels when available.
_Avoid_: Call

**Call**:
An inbound attempt placed to a Tracking Number, including its routing outcome and any resulting media or analysis.
_Avoid_: Lead

**Call Outcome**:
The canonical final routing result of a Call: Answered, Voicemail, Missed, Abandoned, Blocked, or Failed.
_Avoid_: Raw Twilio status

**Transcript**:
The time-aligned text derived from an analysis-eligible Recording.
_Avoid_: Recording

**Lead Assessment**:
An advisory evaluation of a Call's lead quality, supported by a score, classification, and rationale.
_Avoid_: Call outcome

**Lead Review**:
An Operator's Good Lead, Not Good Lead, or Uncertain classification with an optional note, stored separately from and taking reporting precedence over its Lead Assessment.
_Avoid_: Edited AI result

**Lead**:
A Call judged by automated analysis or human review to represent a potential business opportunity.
_Avoid_: Call

## Relationships

- The first release exposes exactly one **Organization**, Spurlock Labs
- Every **Workspace**, **Operator**, and **Client Viewer** belongs to exactly one **Organization**
- An **Organization** owns at most one Twilio connection in the first release
- A **Workspace** has exactly one **Workspace State** and one reporting timezone
- An Active **Workspace** has exactly one active **Number Assignment**
- A **Number Assignment** connects one **Tracking Number** to one **Workspace** for a bounded period and preserves the number's prior Twilio voice configuration for restoration
- An Active **Workspace** has exactly one published **Flow Version**; any Workspace has at most one editable **Call Flow** draft
- A **Call Flow** routes eligible **Calls** from the active **Tracking Number** to a **Destination Number** or voicemail
- Every **Call** pins the published **Flow Version** active when it starts
- A recording-enabled **Workspace** requires a disclosure step in every publishable **Call Flow**
- Every completed **Call** has exactly one **Call Outcome**
- A connected conversation or captured voicemail may produce one **Recording** when recording is enabled
- A **Recording** is analysis-eligible when its **Call** passed any enabled spam gate and contains at least 15 seconds of connected talk time or captured voicemail speech
- An analysis-eligible **Recording** may produce one **Transcript** and one immutable **Lead Assessment**
- **Recording** audio, **Transcript** content, waveform data, and Transcript-derived evidence expire 12 months after the **Call**, while Call metadata and aggregate analytics remain
- An **Operator** may purge Recording audio, waveform data, Transcript content, and Transcript-derived evidence before expiry without deleting the **Call**
- A **Call** may have one current **Lead Review**, which takes reporting precedence over its **Lead Assessment**
- A **Call** retains the **Tracking Number** dialed even after its **Number Assignment** ends
- An **Operator** can manage multiple **Workspaces**
- Each **Access Grant** connects exactly one **Client Viewer** to exactly one **Workspace**
- A **Client Viewer** can hold one or more **Access Grants**
- A **Call** may be classified as a **Lead**, but the terms are not interchangeable

## Example dialogue

> **Dev:** "Can a Client Viewer change where the Tracking Number forwards calls?"
> **Domain expert:** "No. An Operator configures the Workspace and its Destination Number. A Client Viewer can only inspect calls, analytics, recordings, and reports for an authorized Workspace."

## Flagged ambiguities

- "Business owner" is a real-world relationship, while **Client Viewer** is the product role granted to that person.
- "Number" could mean either a **Tracking Number** or **Destination Number**. Use the precise term.
- An **Organization** is the Tracer tenant, not a client grouping; Client Viewer authorization still uses direct **Access Grants**.
- A **Workspace** is an operational grouping with no required mapping to a customer, website, or campaign.
- "One number per Workspace" means one active **Number Assignment** at a time, not one immutable number for the Workspace's lifetime.
