/**
 * -------------------------------------------------------------------------
 * @file   simulated-call-lifecycle.spec.ts
 * @brief  Follows one simulated Twilio Call into Activity, Calls, and Call Detail.
 *
 * @description
 *  An Operator activates a recording Workspace through the fake Twilio
 *  boundary, and signed voice, Forward Call, Recording, and status
 *  callbacks deliver one answered inbound Call through the public webhook
 *  routes. Activity shows one entry for it under Today with its steps, and
 *  redelivering the same webhooks adds no entry or step after a manual
 *  Refresh. Calls shows the row with its outcome and connected duration,
 *  a Call Outcome filter keeps it, a non-matching outcome shows the
 *  no-matches state with Clear Filters, and Call Detail opened from the
 *  filtered list returns to the same URL. The responsive tests check
 *  Calls, Workspace Calls, Activity, and Call Detail at 390px, the md
 *  breakpoint, and a wide viewport for horizontal page scroll, grid
 *  scrolling inside its Frame, the Sidebar Sheet below md, and reachable
 *  search, filter, paging, Refresh, Back, and Previous and Next controls.
 *
 * @remarks
 *  Trigger.dev does not run in the browser suite and no secret key is set,
 *  so the Recording stays Pending: Activity shows Recording processing,
 *  Calls shows Processing, and Call Detail shows the processing player.
 *  tests/e2e/call-detail-playback.spec.ts covers a Stored Recording. The
 *  caller number is unique per run so earlier journeys' Calls never match
 *  the caller search. The responsive tests deliver 25 more short Calls to
 *  the same Workspace once so both Calls scopes have a second page.
 *
 * @see
 *  README.md
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

function todayEntries(page: Page): Locator {
  return page.locator("section").filter({ has: page.getByRole("heading", { level: 2, name: "Today", exact: true }) });
}

async function expectNoHorizontalPageScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, page.url()).toBeLessThanOrEqual(0);
}

async function expectGridScrollsInsideFrame(page: Page): Promise<void> {
  const table = page.getByRole("table");
  await expect(table).toBeVisible();
  const scrolled = await table.evaluate((element) => {
    let node = element.parentElement;
    while (node && node !== document.body) {
      const overflowX = getComputedStyle(node).overflowX;
      if ((overflowX === "auto" || overflowX === "scroll") && node.scrollWidth > node.clientWidth) {
        node.scrollLeft = node.scrollWidth;
        return { overflowing: true, scrollLeft: node.scrollLeft, insideFrame: node.closest("[data-slot=frame]") !== null };
      }
      node = node.parentElement;
    }
    return { overflowing: false, scrollLeft: 0, insideFrame: false };
  });
  expect(scrolled.overflowing).toBe(true);
  expect(scrolled.scrollLeft).toBeGreaterThan(0);
  expect(scrolled.insideFrame).toBe(true);
  await expectNoHorizontalPageScroll(page);
}

async function expectSidebarLayout(page: Page, viewport: { width: number }): Promise<void> {
  const sidebarLink = page.getByRole("link", { name: "Activity", exact: true });
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
  test("a simulated Twilio lifecycle produces Activity, Calls, and Call Detail data", async ({ page, request }) => {
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

      await page.goto("/activity");
      await page.getByRole("searchbox", { name: "Search caller number" }).fill(callerNumber);
      await expect(page).toHaveURL(/\/activity\?q=/);
      const today = todayEntries(page);
      const entryLink = today.getByRole("link", { name: new RegExp(callerNumber.replace("+", "\\+")) });
      await expect(entryLink).toHaveCount(1);
      await expect(page.getByText("1 Call in view")).toBeVisible();
      await expect(today.getByText("Answered", { exact: true })).toBeVisible();
      await today.getByRole("button", { name: new RegExp(workspaceName) }).click();
      const steps = today.locator("[data-step-label]");
      const expectedSteps = ["Call received", "Forwarding attempted", "Call answered", "Recording processing"];
      await expect(steps).toHaveText(expectedSteps);

      await deliverAnsweredCall(request, assignment.id, callSid, callerNumber);
      await page.getByRole("button", { name: "Refresh" }).click();
      await expect(page.getByText("Updated just now")).toBeVisible();
      await expect(page.getByRole("button", { name: "Refresh" })).toBeEnabled();
      await expect(entryLink).toHaveCount(1);
      await expect(steps).toHaveText(expectedSteps);
      expect((await pool.query("select 1 from call where twilio_call_sid = $1", [callSid])).rowCount).toBe(1);

      await page.goto("/calls");
      await page.getByRole("searchbox", { name: "Search Calls" }).fill(callerNumber);
      const row = page.getByRole("row", { name: new RegExp(callerNumber.replace("+", "\\+")) });
      await expect(row).toHaveCount(1);
      await expect(row.getByText("Answered", { exact: true })).toBeVisible();
      await expect(row.getByText("0:42", { exact: true })).toBeVisible();
      await expect(row.getByText("Processing", { exact: true })).toBeVisible();

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

      await page.goto(`/calls?q=${encodeURIComponent(callerNumber)}&outcome=Missed`);
      const table = page.getByRole("table");
      await expect(table.getByText("No Calls match these filters.")).toBeVisible();
      await table.getByRole("button", { name: "Clear Filters" }).click();
      await expect(page.getByRole("searchbox", { name: "Search Calls" })).toHaveValue("");
      await expect(table.getByText("No Calls match these filters.")).toBeHidden();

      await page.goto(filteredPath);
      await expect(row).toHaveCount(1);
      await row.getByRole("link", { name: "Open Call" }).click();
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
    test(`Calls, Activity, and Call Detail fit a ${viewport.width}px viewport`, async ({ page, request }) => {
      test.setTimeout(120_000);
      expect(simulated).toBeDefined();
      const { assignmentId, workspaceId, callId, callerNumber } = simulated!;
      await deliverPagedCalls(request, assignmentId);
      await page.setViewportSize(viewport);
      await signInAsOperator(page, request);

      for (const path of ["/calls", `/workspaces/${workspaceId}/calls`]) {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1, name: "Calls" })).toBeVisible();
        await expectNoHorizontalPageScroll(page);
        await expectSidebarLayout(page, viewport);
        await expectReachable(page.getByRole("searchbox", { name: "Search Calls" }));
        await expectReachable(page.getByRole("button", { name: "Add Filter" }));
        await expectReachable(page.getByRole("button", { name: /Advanced Filters/ }));
        await expectReachable(page.getByRole("button", { name: "Go to next page" }));
        await expectReachable(page.getByRole("button", { name: "Go to previous page" }));
        await expectGridScrollsInsideFrame(page);
        await page.getByRole("button", { name: "Go to next page" }).click();
        await expect(page).toHaveURL(/[?&]page=2/);
        await expectReachable(page.getByRole("button", { name: "Go to previous page" }));
        await page.getByRole("searchbox", { name: "Search Calls" }).fill(callerNumber);
        await expectReachable(page.getByRole("row", { name: new RegExp(callerNumber.replace("+", "\\+")) }).getByRole("link", { name: "Open Call" }));
        await expectNoHorizontalPageScroll(page);
      }

      await page.goto("/activity");
      await expect(page.getByRole("heading", { level: 1, name: "Activity" })).toBeVisible();
      await expectNoHorizontalPageScroll(page);
      await expectSidebarLayout(page, viewport);
      await expectReachable(page.getByRole("button", { name: "Refresh" }));
      await expectReachable(page.getByRole("searchbox", { name: "Search caller number" }));
      await expectReachable(page.getByRole("button", { name: "Add Filter" }));
      const entry = todayEntries(page).getByRole("button").first();
      await expectReachable(entry);
      await entry.click();
      await expect(todayEntries(page).locator("[data-step-label]").first()).toBeVisible();
      await expectNoHorizontalPageScroll(page);

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
