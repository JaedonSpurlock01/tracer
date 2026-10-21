/**
 * -------------------------------------------------------------------------
 * @file   forms-view.test.tsx
 * @brief  Verifies the Workspace Forms page view.
 *
 * @description
 *  Covers the ledger rows with their forwarding and Lead badges, the
 *  Operator actions on a Held row and their absence for a Client Viewer,
 *  Resend appearing only for Forward failed and Not forwarded rows, the
 *  full-field details of an expanded row, the mutations through the
 *  Workspace Forms routes, and the Empty states with and without a linked
 *  Site.
 *
 * @remarks
 *  Requests are faked at the public HTTP boundary.
 *
 * @see
 *  components/tracer/forms-view.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import FormsView from "@/components/tracer/forms-view";
import type { FormSubmissionList, FormSubmissionRecord } from "@/data/form-submissions";

function submission(overrides: Partial<FormSubmissionRecord> & { id: string }): FormSubmissionRecord {
  return {
    workspaceId: "workspace-1",
    siteId: "site-1",
    submissionId: `site-${overrides.id}`,
    receivedAt: "2026-10-21T15:04:05.000Z",
    page: "/contact",
    name: "Dana Customer",
    phone: "+12085550123",
    email: "dana@example.com",
    fields: { Name: "Dana Customer", Phone: "+12085550123", Email: "dana@example.com", Service: "Driveway sealing", Message: "Need a quote for a 40 foot driveway before winter." },
    repeatOfId: null,
    held: false,
    forward: { status: "Sent", to: ["owner@example.com"], error: null, forwardedAt: "2026-10-21T15:04:07.000Z" },
    review: null,
    effectiveClassification: { classification: "Good Lead", source: "default" },
    ...overrides,
  };
}

const sent = submission({ id: "sub-sent" });
const failed = submission({
  id: "sub-failed",
  name: "Lee Caller",
  phone: "+12085550199",
  email: null,
  receivedAt: "2026-10-20T10:00:00.000Z",
  forward: { status: "Failed", to: ["owner@example.com"], error: "Domain not onboarded", forwardedAt: null },
  review: { classification: "Uncertain", note: "Asked about pricing only", reviewedAt: "2026-10-20T11:00:00.000Z", reviewer: { id: "operator-1", name: "Example Operator" } },
  effectiveClassification: { classification: "Uncertain", source: "review" },
});
const unconfigured = submission({
  id: "sub-unconfigured",
  name: "Pat Nobody",
  receivedAt: "2026-10-19T10:00:00.000Z",
  forward: { status: "Not configured", to: [], error: null, forwardedAt: null },
});
const held = submission({
  id: "sub-held",
  name: "Repeat Person",
  receivedAt: "2026-10-18T10:00:00.000Z",
  held: true,
  repeatOfId: "sub-sent",
  forward: { status: "Held", to: [], error: null, forwardedAt: null },
  effectiveClassification: null,
});

const list: FormSubmissionList = {
  workspace: { id: "workspace-1", name: "Pocatello Paving" },
  site: { id: "site-1", primaryHostname: "pocatelloasphaltpaving.com" },
  submissions: [sent, failed, unconfigured, held],
  heldCount: 1,
  forwardTo: ["owner@example.com"],
};

function row(name: string): HTMLElement {
  return screen.getByRole("row", { name: new RegExp(name) });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("FormsView", () => {
  it("lists every Form Submission with its forwarding status and effective Lead classification", () => {
    render(<FormsView list={list} />);

    expect(screen.getByRole("heading", { name: "Forms" })).toBeVisible();
    expect(screen.getByText("4 Form Submissions")).toBeVisible();
    expect(screen.getByText("1 held for approval")).toBeVisible();
    expect(within(row("Dana Customer")).getByText("Forwarded")).toBeVisible();
    expect(within(row("Dana Customer")).getByText("Good Lead")).toBeVisible();
    expect(within(row("Dana Customer")).getByText("Service: Driveway sealing")).toBeVisible();
    expect(within(row("Lee Caller")).getByText("Forward failed")).toBeVisible();
    expect(within(row("Lee Caller")).getByText("Domain not onboarded")).toBeVisible();
    expect(within(row("Lee Caller")).getByText("Uncertain")).toBeVisible();
    expect(within(row("Lee Caller")).getByText("Asked about pricing only")).toBeVisible();
    expect(within(row("Pat Nobody")).getByText("Not forwarded")).toBeVisible();
    expect(within(row("Repeat Person")).getByText("Held")).toBeVisible();
    expect(within(row("Repeat Person")).getByText("Awaiting approval")).toBeVisible();
  });

  it("offers an Operator Approve and Reject on a Held row and Resend only on Forward failed and Not forwarded rows", () => {
    render(<FormsView list={list} />);

    expect(within(row("Repeat Person")).getByRole("button", { name: "Approve" })).toBeVisible();
    expect(within(row("Repeat Person")).getByRole("button", { name: "Reject" })).toBeVisible();
    expect(within(row("Repeat Person")).queryByRole("button", { name: "Resend" })).not.toBeInTheDocument();
    expect(within(row("Lee Caller")).getByRole("button", { name: "Resend" })).toBeVisible();
    expect(within(row("Lee Caller")).getByRole("button", { name: "Clear review" })).toBeVisible();
    expect(within(row("Pat Nobody")).getByRole("button", { name: "Resend" })).toBeVisible();
    expect(within(row("Dana Customer")).queryByRole("button", { name: "Resend" })).not.toBeInTheDocument();
    expect(within(row("Dana Customer")).queryByRole("button", { name: "Clear review" })).not.toBeInTheDocument();
    expect(within(row("Dana Customer")).getByRole("button", { name: "Review" })).toBeVisible();
  });

  it("shows a Client Viewer the rows without any actions", () => {
    render(<FormsView list={{ ...list, forwardTo: undefined }} readOnly />);

    expect(row("Repeat Person")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reject" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resend" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Review" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Details" })).toHaveLength(4);
  });

  it("expands a row to show every field in full", () => {
    render(<FormsView list={list} readOnly />);

    fireEvent.click(within(row("Dana Customer")).getByRole("button", { name: "Details" }));
    const details = screen.getByRole("region", { name: "Dana Customer details" });
    expect(within(details).getByText("Need a quote for a 40 foot driveway before winter.")).toBeVisible();
    expect(within(details).getByText("/contact")).toBeVisible();
    expect(within(details).getByText("owner@example.com")).toBeVisible();
  });

  it("approves a Held row and replaces it with the returned submission", async () => {
    const approved = { ...held, held: false, forward: { status: "Sent" as const, to: ["owner@example.com"], error: null, forwardedAt: "2026-10-21T16:00:00.000Z" }, effectiveClassification: { classification: "Good Lead" as const, source: "default" as const } };
    const fetch = vi.fn(async () => new Response(JSON.stringify({ submission: approved }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    render(<FormsView list={list} />);

    fireEvent.click(within(row("Repeat Person")).getByRole("button", { name: "Approve" }));

    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/workspaces/workspace-1/forms/sub-held/approve", expect.objectContaining({ method: "POST" })));
    await waitFor(() => expect(within(row("Repeat Person")).getByText("Forwarded")).toBeVisible());
    expect(within(row("Repeat Person")).queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.getByText("4 Form Submissions")).toBeVisible();
    expect(screen.queryByText("1 held for approval")).not.toBeInTheDocument();
  });

  it("reports a failed Resend without changing the row", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "held" }), { status: 409 })));
    render(<FormsView list={list} />);

    fireEvent.click(within(row("Lee Caller")).getByRole("button", { name: "Resend" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The Form Submission could not be resent because its hold state changed.");
    expect(within(row("Lee Caller")).getByText("Forward failed")).toBeVisible();
  });

  it("explains the Empty state with and without a linked Site", () => {
    const { rerender } = render(<FormsView list={{ ...list, submissions: [], heldCount: 0 }} />);
    expect(screen.getByText("No Form Submissions yet")).toBeVisible();
    expect(screen.getByText(/contact form on pocatelloasphaltpaving.com posts with the Forms key/)).toBeVisible();

    rerender(<FormsView list={{ ...list, site: null, submissions: [], heldCount: 0 }} />);
    expect(screen.getByText("No Form Submissions yet")).toBeVisible();
    expect(screen.getByText(/This Workspace has no linked Site/)).toBeVisible();
  });
});
