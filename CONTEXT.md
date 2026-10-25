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
The access lifecycle of an Operator or Client Viewer: Provisioned, Active, or Disabled. A successful first sign-in changes Provisioned to Active, while Disabled blocks all sessions; a session already signed in keeps working for at most 60 seconds after the change, the window the signed session cookie is trusted before the database is read again.
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

**Site**:
A lead-generation website hosted on a Cloudflare Worker of the Organization's connected account that serves at least one custom hostname; its primary hostname is the apex domain.
_Avoid_: Worker, deployment, Workspace

**Site Link**:
The period during which one Site is linked to one Workspace; at most one open Site Link per Workspace and per Site.
_Avoid_: Workspace

**Site Health**:
The derived operational condition of a Site: Healthy, Warning, Down, or Unknown, computed from uptime checks, hostname certificates, Worker errors, and recent traffic.
_Avoid_: Workspace State, Integration health

**Service Area**:
The city, region, and country from which a Site's Keywords are checked, representing where its business serves.
_Avoid_: Address, location

**Keyword**:
A search phrase tracked for one Site with a weight from 1 to 5 and a daily position from a SERP provider.
_Avoid_: Query

**Search Visibility**:
A Site's 0 to 100 score summarizing its weighted Keyword positions through a click-through curve.
_Avoid_: Ranking, SEO score

**Form Submission**:
A contact form posted by a linked Site to Tracer, stored under the Site's Workspace with its fields, forwarding result, and optional Lead Review; a Lead by default unless Held or reviewed otherwise.
_Avoid_: Email, Call, Lead

**Forms key**:
The Organization's one secret that every Site's Worker presents with its hostname when posting a Form Submission; Tracer stores only its hash and an Operator generates, rotates, or revokes it on Integrations.
_Avoid_: API key, password, Site key

**Forwarding Recipient**:
An email address in a Workspace's list that receives every forwarded Form Submission from the Site's own address.
_Avoid_: Destination Number, Client Viewer

**Deal**:
A Workspace's agreement with its business: Monthly, Weekly, or Per Lead with an amount, used to project revenue and profit; at most one open Deal per Workspace.
_Avoid_: Subscription, invoice

**Business**:
The client a Workspace serves: its name, the contact's first and last name and email, its niche, its own website, and its city placed on a map through a city lookup; at most one Business per Workspace, and only Operators read it.
_Avoid_: Client Viewer, Site, customer

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
- A connected conversation may produce one **Recording** when recording is enabled; a captured voicemail produces one **Recording** regardless of the recording setting
- A **Recording** is analysis-eligible when its **Call** passed any enabled spam gate and contains at least 15 seconds of connected talk time or captured voicemail speech
- An analysis-eligible **Recording** may produce one **Transcript** and one immutable **Lead Assessment**
- **Recording** audio, **Transcript** content, waveform data, and Transcript-derived evidence expire 12 months after the **Call**, while Call metadata and aggregate analytics remain
- An **Operator** may purge Recording audio, waveform data, Transcript content, and Transcript-derived evidence before expiry without deleting the **Call**
- A **Call** may have one current **Lead Review**, which takes reporting precedence over its **Lead Assessment**
- A **Call** retains the **Tracking Number** dialed even after its **Number Assignment** ends
- An **Operator** can manage multiple **Workspaces**
- Each **Access Grant** connects exactly one **Client Viewer** to exactly one **Workspace**
- A **Client Viewer** can hold one or more **Access Grants** and always holds at least one
- A new **Access Grant** may target only an Active **Workspace**
- An **Access Grant** authorizes reads only while its **Workspace** is Active or Archived
- A **Call** may be classified as a **Lead**, but the terms are not interchangeable
- An **Organization** owns at most one Cloudflare connection and at most one DataForSEO connection
- A **Site** belongs to the **Organization** whose Cloudflare connection discovered it and has one or more hostnames
- A **Site Link** connects one **Site** to one **Workspace** for a bounded period; replacing or detaching ends it and never changes Cloudflare
- A **Site** has one **Service Area** and at most 25 **Keywords**, and its **Search Visibility** exists only when it has at least one checked **Keyword**
- A **Site Health** of Down, Warning, Healthy, or Unknown is derived at read time and is separate from **Workspace State**
- A **Form Submission** names its **Site** by hostname under the **Organization**'s **Forms key**, belongs to one **Workspace** through the **Site Link** open when it was posted, is unique per **Site** and submission id, and is refused when the hostname is not a **Site** or the **Site** has no open **Site Link**
- The third **Form Submission** from one person within 24 hours of the first is Held until an **Operator** approves or rejects it; an approved one is forwarded and counts as a **Lead**, a rejected one never is
- A **Form Submission**'s effective classification is its **Lead Review** when one exists, otherwise Good Lead unless Held
- A **Workspace**'s Leads count Good Lead **Calls** and Good Lead **Form Submissions** together, and Per Lead revenue counts both
- A **Workspace** has at most one open **Deal**; Per Lead revenue counts **Good Leads** with **Lead Review** precedence
- A **Workspace** has at most one **Business**, whose own website is separate from the Tracer-hosted **Site**
- A **Client Viewer** reads a linked **Site**'s traffic, performance, and Search results but never its hosting details, cost, or **Deal**

## Example dialogue

> **Dev:** "Can a Client Viewer change where the Tracking Number forwards calls?"
> **Domain expert:** "No. An Operator configures the Workspace and its Destination Number. A Client Viewer can only inspect calls, analytics, recordings, and reports for an authorized Workspace."

## Flagged ambiguities

- "Business owner" is a real-world relationship, while **Client Viewer** is the product role granted to that person.
- "Number" could mean either a **Tracking Number** or **Destination Number**. Use the precise term.
- An **Organization** is the Tracer tenant, not a client grouping; Client Viewer authorization still uses direct **Access Grants**.
- A **Workspace** is an operational grouping with no required mapping to a customer or campaign; since Phase 7 it may link one **Site**.
- "Website" in conversation means the **Site**; "Worker" is the Cloudflare resource behind it and never appears in the interface.
- "One number per Workspace" means one active **Number Assignment** at a time, not one immutable number for the Workspace's lifetime.
