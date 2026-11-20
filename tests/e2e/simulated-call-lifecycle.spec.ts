/**
 * -------------------------------------------------------------------------
 * @file   simulated-call-lifecycle.spec.ts
 * @brief  Follows one simulated Twilio Call into Calls and Call Detail.
 *
 * @description
 *  An Operator activates a recording Workspace through the fake Twilio
 *  boundary, and signed voice, Forward Call, Recording, and status
 *  callbacks deliver one answered inbound Call through the public webhook
 *  routes. The retired `/activity` address lands on Calls, which shows the
 *  Call once by caller search, and redelivering the same webhooks adds no
 *  row. The row shows its outcome and connected duration, a Call Outcome
 *  filter keeps it, a non-matching outcome shows the no-matches state with
 *  Clear Filters, and Call Detail opened from the filtered list returns to
 *  the same URL. The responsive tests check Calls, Workspace Calls, Home,
 *  Workspace Overview, and Call Detail at 390px, the md breakpoint, and a
 *  wide viewport for horizontal page scroll, Started, Caller, and Outcome
 *  fitting the grid at 390px, the grid scrolling inside its Panel at the
 *  md breakpoint, no wrapped Started time at 1440px, the Sidebar Sheet
 *  below md, the KPI grid at one, two, then four columns, a visible chart
 *  legend, and reachable search, filter, paging, date range, View Calls,
 *  Back, and Previous and Next controls.
 *
 * @remarks
 *  Trigger.dev does not run in the browser suite and no secret key is set,
 *  so the Recording stays Pending and Call Detail shows the processing
 *  player. tests/e2e/call-detail-playback.spec.ts covers a Stored
 *  Recording. The caller number is unique per run so earlier journeys'
 *  Calls never match the caller search. The responsive tests deliver 25
 *  more short Calls to the same Workspace once so both Calls scopes have a
 *  second page.
 *
 * @see
 *  docs/SPECIFICATION.md
 *  DESIGN.md
 *  tests/e2e/helpers.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { createHash } from "node:crypto";

import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { Pool } from "pg";

import { archiveActiveWorkspaces, createActiveWorkspace, ensureTwilioNumbers, signInAsOperator, twilioCallback } from "./helpers";

const databaseUrl = "postgresql://postgres:postgres@127.0.0.1:5433/tracer_e2e";
const connectedSeconds = 42;
const viewports = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
];

interface SimulatedCall {
  assignmentId: string;
  workspaceId: string;
  callId: string;
  callerNumber: string;
}

let simulated: SimulatedCall | undefined;
let pagedCallsDelivered = false;

async function deliverAnsweredCall(request: APIRequestContext, assignmentId: string, callSid: string, callerNumber: string): Promise<void> {
  const common = { AccountSid: `AC${"a".repeat(32)}` };
  const child = { ...common, CallSid: `${callSid}child`, ParentCallSid: callSid };
  await twilioCallback(request, `/api/twilio/voice/${assignmentId}`, { ...common, CallSid: callSid, From: callerNumber, To: "+14155550100", CallStatus: "ringing", Direction: "inbound" });
  for (const CallStatus of ["initiated", "ringing", "in-progress"]) {
    await twilioCallback(request, `/api/twilio/forward-status/${assignmentId}?node=forward`, { ...child, CallStatus });
  }
  await twilioCallback(request, `/api/twilio/forward-status/${assignmentId}?node=forward`, { ...child, CallStatus: "completed", CallDuration: String(connectedSeconds) });
  await twilioCallback(request, `/api/twilio/recording-status/${assignmentId}?node=forward`, {
    ...common,
    CallSid: callSid,
    RecordingSid: `RE${createHash("sha256").update(`${callSid}:recording`).digest("hex").slice(0, 32)}`,
    RecordingStatus: "completed",
    RecordingDuration: String(connectedSeconds),
    RecordingChannels: "2",
    RecordingSource: "DialVerb",
  });
  await twilioCallback(request, `/api/twilio/forward/${assignmentId}?node=forward`, { ...common, CallSid: callSid, DialCallStatus: "completed", DialCallDuration: String(connectedSeconds) });
  await twilioCallback(request, `/api/twilio/status/${assignmentId}`, { ...common, CallSid: callSid, CallStatus: "completed", CallDuration: String(connectedSeconds + 8) });
}

async function deliverPagedCalls(request: APIRequestContext, assignmentId: string): Promise<void> {
  if (pagedCallsDelivered) return;
  const common = { AccountSid: `AC${"a".repeat(32)}` };
  const prefix = createHash("sha256").update(`${assignmentId}:paged`).digest("hex").slice(0, 28);
  for (let index = 0; index < 25; index += 1) {
    const CallSid = `CA${prefix}${String(index).padStart(4, "0")}`;
    await twilioCallback(request, `/api/twilio/voice/${assignmentId}`, { ...common, CallSid, From: `+1773555${String(index).padStart(4, "0")}`, To: "+14155550100", CallStatus: "ringing", Direction: "inbound" });
    await twilioCallback(request, `/api/twilio/status/${assignmentId}`, { ...common, CallSid, CallStatus: "completed", CallDuration: "3" });
  }
  pagedCallsDelivered = true;
}

// Calls fetches its list once hydrated, so waiting for that request keeps a click from landing on inert server HTML.
async function gotoHydrated(page: Page, path: string): Promise<void> {
  const hydrated = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/calls");
  await page.goto(path);
  await hydrated;
}

async function expectNoHorizontalPageScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, page.url()).toBeLessThanOrEqual(0);
}

async function gridOverflow(page: Page): Promise<number> {
  const table = page.getByRole("table");
  await expect(table).toBeVisible();
  return table.evaluate((element) => {
    let node = element.parentElement;
    while (node && node !== document.body) {
      const overflowX = getComputedStyle(node).overflowX;
      if (overflowX === "auto" || overflowX === "scroll") return node.scrollWidth - node.clientWidth;
      node = node.parentElement;
    }
    return 0;
  });
}

async function expectGridLayout(page: Page, viewport: { width: number }): Promise<void> {
  if (viewport.width < 768) {
    expect(await gridOverflow(page)).toBeLessThanOrEqual(0);
    for (const name of ["Started", "Caller", "Outcome"]) await expectReachable(page.getByRole("columnheader", { name }));
  } else if (viewport.width < 1440) {
    expect(await gridOverflow(page)).toBeGreaterThan(0);
  } else {
    expect(await gridOverflow(page)).toBeLessThanOrEqual(0);
    const startedLines = await page.getByRole("table").locator("tbody tr td:first-child a").evaluateAll((links) => links.map((link) => link.getClientRects().length));
    expect(startedLines.length).toBeGreaterThan(0);
    expect(startedLines.every((lines) => lines === 1)).toBe(true);
  }
  await expectNoHorizontalPageScroll(page);
}

async function expectSidebarLayout(page: Page, viewport: { width: number }): Promise<void> {
  // Scope to the desktop Sidebar: the header breadcrumbs also name the
  // current page, and on phones the Sidebar lives only in the Sheet. Inside
  // a Workspace the Sidebar swaps to that Workspace's pages, so the link
  // that proves the desktop Sidebar is All Workspaces there and Home
  // elsewhere; Calls exists in both.
  const name = /\/workspaces\/[^/?#]+/.test(new URL(page.url()).pathname) ? "All Workspaces" : "Home";
  const sidebarLink = page.locator('[data-slot="sidebar-container"]').getByRole("link", { name, exact: true });
  if (viewport.width < 768) {
    await expect(sidebarLink).toBeHidden();
    const sheet = page.getByRole("dialog", { name: "Sidebar" });
    await expect(async () => {
      await page.locator("header").first().getByRole("button", { name: "Toggle Sidebar" }).click();
      await expect(sheet).toBeVisible({ timeout: 2_000 });
    }).toPass();
    await expect(sheet.getByRole("link", { name: "Calls", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
  } else {
    await expect(sidebarLink).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Sidebar" })).toHaveCount(0);
  }
}

async function expectReachable(locator: Locator): Promise<void> {
  await expect(locator).toBeVisible();
  await locator.scrollIntoViewIfNeeded();
  await expect(locator).toBeInViewport();
}

test.describe.serial("simulated Twilio lifecycle", () => {
  test("a simulated Twilio lifecycle produces Calls and Call Detail data", async ({ page, request }) => {
    test.setTimeout(180_000);
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await signInAsOperator(page, request);
      await ensureTwilioNumbers(page);
      await page.goto("/workspaces");
      await archiveActiveWorkspaces(page, "E2E");
      const workspaceName = `E2E Lifecycle ${Date.now()}`;
      const workspaceId = await createActiveWorkspace(page, workspaceName, { recording: true });
      const assignment = (await pool.query<{ id: string }>("select id from number_assignment where workspace_id = $1 and ended_at is null", [workspaceId])).rows[0];
      const callerNumber = `+1312555${String(Date.now()).slice(-4)}`;
      const callSid = `CA${createHash("sha256").update(workspaceName).digest("hex").slice(0, 32)}`;
      await deliverAnsweredCall(request, assignment.id, callSid, callerNumber);
      const callId = (await pool.query<{ id: string }>("select id from call where twilio_call_sid = $1", [callSid])).rows[0].id;
      simulated = { assignmentId: assignment.id, workspaceId, callId, callerNumber };

      await gotoHydrated(page, "/activity");
      await expect(page).toHaveURL((url) => url.pathname === "/calls" && url.search === "");
      await expect(page.getByRole("heading", { level: 1, name: "Calls" })).toBeVisible();
      await page.getByRole("searchbox", { name: "Search Calls" }).fill(callerNumber);
      const row = page.getByRole("row", { name: new RegExp(callerNumber.replace("+", "\\+")) });
      await expect(row).toHaveCount(1);
      await expect(row.getByText("Answered", { exact: true })).toBeVisible();
      await expect(row.getByText("0:42", { exact: true })).toBeVisible();

      await deliverAnsweredCall(request, assignment.id, callSid, callerNumber);
      await gotoHydrated(page, `/calls?q=${encodeURIComponent(callerNumber)}`);
      await expect(row).toHaveCount(1);
      expect((await pool.query("select 1 from call where twilio_call_sid = $1", [callSid])).rowCount).toBe(1);

      const toolbar = page.getByRole("toolbar", { name: "Filters" });
      await page.getByRole("button", { name: "Add Filter" }).click();
      await page.getByRole("option", { name: /Call Outcome/ }).click();
      await page.getByRole("option", { name: "is any of" }).click();
      await page.getByRole("option", { name: /Answered/ }).click();
      await page.keyboard.press("Escape");
      const filteredPath = `/calls?q=${encodeURIComponent(callerNumber)}&outcome=Answered`;
      await expect(page).toHaveURL((url) => `${url.pathname}${url.search}` === filteredPath);
      await expect(toolbar.getByText("Answered")).toBeVisible();
      await expect(row).toHaveCount(1);

      await gotoHydrated(page, `/calls?q=${encodeURIComponent(callerNumber)}&outcome=Missed`);
      const table = page.getByRole("table");
      await expect(table.getByText("No Calls match these filters.")).toBeVisible();
      await table.getByRole("button", { name: "Clear Filters" }).click();
      await expect(page.getByRole("searchbox", { name: "Search Calls" })).toHaveValue("");
      await expect(table.getByText("No Calls match these filters.")).toBeHidden();

      await page.goto(filteredPath);
      await page.waitForLoadState("networkidle");
      await expect(row).toHaveCount(1);
      await row.getByRole("link").click();
      await expect(page).toHaveURL(new RegExp(`/workspaces/${workspaceId}/calls/${callId}\\?`));
      await expect(page.getByRole("heading", { level: 1, name: callerNumber })).toBeVisible();
      await expect(page.getByText("Recording processing")).toBeVisible();
      await page.getByRole("link", { name: "Back to Calls" }).click();
      await expect(page).toHaveURL((url) => `${url.pathname}${url.search}` === filteredPath);
      await expect(row).toHaveCount(1);
    } finally {
      await pool.end();
    }
  });

  for (const viewport of viewports) {
    test(`Calls, Home, Workspace Overview, and Call Detail fit a ${viewport.width}px viewport`, async ({ page, request }) => {
      test.setTimeout(120_000);
      expect(simulated).toBeDefined();
      const { assignmentId, workspaceId, callId, callerNumber } = simulated!;
      await deliverPagedCalls(request, assignmentId);
      await page.setViewportSize(viewport);
      await signInAsOperator(page, request);

      for (const path of ["/calls", `/workspaces/${workspaceId}/calls`]) {
        await gotoHydrated(page, path);
        await expect(page.getByRole("heading", { level: 1, name: "Calls" })).toBeVisible();
        await expectNoHorizontalPageScroll(page);
        await expectSidebarLayout(page, viewport);
        await expectReachable(page.getByRole("searchbox", { name: "Search Calls" }));
        await expectReachable(page.getByRole("button", { name: "Add Filter" }));
        await expectReachable(page.getByRole("button", { name: /Advanced Filters/ }));
        await expectReachable(page.getByRole("button", { name: "Go to next page" }));
        await expectReachable(page.getByRole("button", { name: "Go to previous page" }));
        await expectGridLayout(page, viewport);
        await page.getByRole("button", { name: "Go to next page" }).click();
        await expect(page).toHaveURL(/[?&]page=2/);
        await expectReachable(page.getByRole("button", { name: "Go to previous page" }));
        await page.getByRole("searchbox", { name: "Search Calls" }).fill(callerNumber);
        await expectReachable(page.getByRole("row", { name: new RegExp(callerNumber.replace("+", "\\+")) }).getByRole("link"));
        await expectNoHorizontalPageScroll(page);
      }

      for (const path of ["/", `/workspaces/${workspaceId}`]) {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await expectNoHorizontalPageScroll(page);
        await expectSidebarLayout(page, viewport);
        for (const range of ["7 Days", "30 Days", "90 Days", "All Time", "Custom"]) {
          await expectReachable(page.getByRole("group", { name: "Date range" }).getByRole("button", { name: range }));
        }
        const tiles = ["Total Calls", "Answer Rate", "Good Leads", "Average Duration"].map((name) => page.getByRole("group", { name }));
        for (const tile of tiles) await expect(tile).toBeVisible();
        const tops = await Promise.all(tiles.map(async (tile) => (await tile.boundingBox())!.y));
        const columns = tops.filter((top) => Math.abs(top - tops[0]) < 1).length;
        expect(columns).toBe(viewport.width < 640 ? 2 : viewport.width < 1280 ? 3 : 4);
        await expect(page.getByRole("region", { name: "Leads generated" }).getByRole("list", { name: "Chart legend" })).toBeVisible();
        await expectReachable(page.getByRole("link", { name: "View Calls" }));
        await expectNoHorizontalPageScroll(page);
      }
      await page.getByRole("group", { name: "Date range" }).getByRole("button", { name: "7 Days" }).click();
      await expect(page).toHaveURL(/[?&]range=7d/);
      await expect(page.getByRole("link", { name: "View Calls" })).toHaveAttribute("href", /\/calls\?from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}$/);

      await page.goto(`/workspaces/${workspaceId}/calls/${callId}?back=${encodeURIComponent("/calls")}`);
      await expect(page.getByRole("heading", { level: 1, name: callerNumber })).toBeVisible();
      await expectNoHorizontalPageScroll(page);
      await expectSidebarLayout(page, viewport);
      await expectReachable(page.getByRole("link", { name: "Back to Calls" }));
      await expectReachable(page.getByRole("group", { name: "Call navigation" }).getByRole("link", { name: "Next Call" }).or(page.getByRole("button", { name: "Next Call" })));
      await expectReachable(page.getByRole("group", { name: "Call navigation" }).getByRole("link", { name: "Previous Call" }).or(page.getByRole("button", { name: "Previous Call" })));
      await expectNoHorizontalPageScroll(page);
    });
  }
});
