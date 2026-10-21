/**
 * -------------------------------------------------------------------------
 * @file   report-generation.spec.ts
 * @brief  Generates and downloads a report through a completed fake Trigger.dev job.
 *
 * @description
 *  An Operator activates a Workspace through the fake Twilio boundary,
 *  signed voice and status callbacks deliver three Calls, and a Client
 *  Viewer is granted only that Workspace. The Client Viewer opens Reports,
 *  opens Generate Report, sees the matched Call count for a Custom Range
 *  around today, and requests a PDF and CSV report, which waits Queued in
 *  Report history and the notification popover until its fake Trigger.dev
 *  run completes. Report history and the popover then show it Completed,
 *  the PDF downloads through the browser, and both files download as
 *  private attachments with the report filename, a `%PDF-` body, and the
 *  CSV header row. The Operator, who did not request the job, gets Not
 *  Found for both files. The Client Viewer then exports CSV from Calls
 *  through its confirmation and downloads the completed Calls CSV. The
 *  responsive tests check Reports and the Generate Report dialog at 390px,
 *  the md breakpoint, and a wide viewport for horizontal page scroll, the
 *  history grid scrolling inside its Frame, and reachable controls.
 *
 * @remarks
 *  Trigger.dev does not run in the browser suite. The E2E_TRIGGER_FAKE
 *  boundary accepts the generation request, and the spec completes the
 *  job as the report generation task would, by running the same
 *  generation function in a separate process against the E2E database and
 *  writing each file to the local R2 bucket with Wrangler, which the dev
 *  server's R2 binding reads. The local e2e database persists between runs, so the Client
 *  Viewer is provisioned once and keeps only this run's Access Grant.
 *
 * @see
 *  docs/SPECIFICATION.md
 *  DESIGN.md
 *  tests/e2e/helpers.ts
 *  data/e2e-trigger-fake.ts
 *  tests/e2e/fake-trigger-report-run.ts
 *  trigger/report-generation.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { Pool } from "pg";

import { archiveActiveWorkspaces, createActiveWorkspace, ensureTwilioNumbers, signIn, signInAsOperator, twilioCallback } from "./helpers";
import { reportCsvHeader } from "../../data/report-csv";

const databaseUrl = "postgresql://postgres:postgres@127.0.0.1:5433/tracer_e2e";
const clientEmail = "client@example.com";
const seededCalls = 3;
const viewports = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
];

let workspaceName = "";

// The fake Trigger.dev boundary only accepted the run; this does what the report generation task does with it.
async function completeFakeTriggerRun(pool: Pool, jobId: string): Promise<void> {
  execFileSync("corepack", ["pnpm", "exec", "tsx", "tests/e2e/fake-trigger-report-run.ts", jobId], { stdio: "pipe" });
  expect((await pool.query<{ status: string }>("select status from report_job where id = $1", [jobId])).rows[0]?.status).toBe("Completed");
}

async function deliverCalls(request: APIRequestContext, assignmentId: string, seed: string): Promise<void> {
  const common = { AccountSid: `AC${"a".repeat(32)}` };
  const prefix = createHash("sha256").update(seed).digest("hex").slice(0, 28);
  for (let index = 0; index < seededCalls; index += 1) {
    const CallSid = `CA${prefix}${String(index).padStart(4, "0")}`;
    await twilioCallback(request, `/api/twilio/voice/${assignmentId}`, { ...common, CallSid, From: `+1630555${String(index).padStart(4, "0")}`, To: "+14155550100", CallStatus: "ringing", Direction: "inbound" });
    await twilioCallback(request, `/api/twilio/status/${assignmentId}`, { ...common, CallSid, CallStatus: "completed", CallDuration: "5" });
  }
}

async function grantClientViewerOnly(page: Page, workspaceId: string): Promise<void> {
  await page.goto("/users");
  const findClient = () =>
    page.evaluate(async (email) => {
      const body = (await (await fetch("/api/users")).json()) as { users: Array<{ id: string; email: string; accessGrants: Array<{ workspaceId: string }> }> };
      return body.users.find((user) => user.email === email) ?? null;
    }, clientEmail);
  const existing = await findClient();
  if (existing) {
    const statuses = await page.evaluate(async ({ userId, keep, grants }) => {
      const results = [(await fetch(`/api/users/${userId}/access-grants`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceId: keep }) })).status];
      for (const grant of grants) {
        if (grant.workspaceId !== keep) results.push((await fetch(`/api/users/${userId}/access-grants/${grant.workspaceId}`, { method: "DELETE" })).status);
      }
      return results;
    }, { userId: existing.id, keep: workspaceId, grants: existing.accessGrants });
    expect(statuses.every((status) => status === 200)).toBe(true);
  } else {
    await page.getByRole("button", { name: "Provision User" }).click();
    await page.getByRole("textbox", { name: "Email" }).fill(clientEmail);
    await page.getByRole("combobox", { name: "Role" }).click();
    await page.getByRole("option", { name: "Client Viewer" }).click();
    await page.getByRole("checkbox", { name: workspaceName }).click();
    await page.getByRole("button", { name: "Provision" }).click();
    await expect(page.getByRole("status")).toHaveText("Client Viewer provisioned.");
  }
  expect((await findClient())?.accessGrants.map((grant) => grant.workspaceId)).toEqual([workspaceId]);
}

// Report history loads once the page hydrates, so waiting for it keeps a click from landing on inert server HTML.
async function gotoReports(page: Page): Promise<void> {
  const hydrated = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/reports" && response.request().method() === "GET");
  await page.goto("/reports");
  await hydrated;
}

function createdJob(page: Page): Promise<string> {
  return page
    .waitForResponse((response) => new URL(response.url()).pathname === "/api/reports" && response.request().method() === "POST")
    .then(async (response) => {
      expect(response.status()).toBe(201);
      return ((await response.json()) as { job: { id: string } }).job.id;
    });
}

async function openNotifications(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: /^Notifications/ }).click();
  const popover = page.getByRole("dialog", { name: "Reports and exports" });
  await expect(popover).toBeVisible();
  return popover;
}

async function expectAttachment(request: APIRequestContext, href: string, contentType: string, filename: RegExp): Promise<Buffer> {
  const response = await request.get(href);
  expect(response.status(), href).toBe(200);
  expect(response.headers()["content-type"]).toBe(contentType);
  expect(response.headers()["cache-control"]).toBe("private, no-store");
  const disposition = response.headers()["content-disposition"] ?? "";
  expect(disposition).toMatch(/^attachment; filename="[^"]+"$/);
  expect(disposition.match(/filename="([^"]+)"/)?.[1]).toMatch(filename);
  return response.body();
}

function expectCsvHeader(body: Buffer): void {
  const lines = body.toString("utf8").split(/\r?\n/).filter(Boolean);
  expect(lines[0]).toBe(reportCsvHeader().replace(/\r?\n$/, ""));
  expect(lines).toHaveLength(seededCalls + 1);
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

async function expectReachable(locator: Locator): Promise<void> {
  await expect(locator).toBeVisible();
  await locator.scrollIntoViewIfNeeded();
  await expect(locator).toBeInViewport();
}

function calendarDate(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

test.describe.serial("report generation", () => {
  test("a Client Viewer generates and downloads a report through a completed fake Trigger.dev job", async ({ browser, page, request }) => {
    test.setTimeout(240_000);
    const pool = new Pool({ connectionString: databaseUrl });
    const clientContext = await browser.newContext();
    try {
      await signInAsOperator(page, request);
      await ensureTwilioNumbers(page);
      await page.goto("/workspaces");
      await archiveActiveWorkspaces(page, "E2E");
      workspaceName = `E2E Reports ${Date.now()}`;
      const workspaceId = await createActiveWorkspace(page, workspaceName);
      const assignment = (await pool.query<{ id: string }>("select id from number_assignment where workspace_id = $1 and ended_at is null", [workspaceId])).rows[0];
      await deliverCalls(request, assignment.id, workspaceName);
      await grantClientViewerOnly(page, workspaceId);

      const client = await clientContext.newPage();
      await signIn(client, request, clientEmail);
      await gotoReports(client);
      await expect(client.getByRole("heading", { level: 1, name: "Reports" })).toBeVisible();
      await client.getByRole("button", { name: "Generate Report" }).first().click();
      const dialog = client.getByRole("dialog", { name: "Generate Report" });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("checkbox", { name: workspaceName })).toBeChecked();
      await expect(dialog.getByRole("checkbox", { name: "PDF report" })).toBeChecked();
      await dialog.getByRole("group", { name: "Report period" }).getByRole("button", { name: "Custom Range" }).click();
      await dialog.getByLabel("From").fill(calendarDate(-1));
      await dialog.getByLabel("To").fill(calendarDate(1));
      await dialog.getByRole("checkbox", { name: "CSV detail" }).click();
      await expect(dialog.getByRole("status")).toHaveText(`${seededCalls} matched Calls`);
      const reportJob = createdJob(client);
      await dialog.getByRole("button", { name: "Generate Report" }).click();
      const reportJobId = await reportJob;
      await expect(dialog.getByText(/^Report requested\./)).toBeVisible();
      await dialog.getByRole("button", { name: "Done" }).click();
      await expect(dialog).toBeHidden();

      const reportRow = client.getByRole("row").filter({ hasText: workspaceName }).filter({ hasText: "PDF, CSV" });
      await expect(reportRow).toHaveCount(1);
      await expect(reportRow.getByText("Queued", { exact: true })).toBeVisible();
      await expect(client.getByRole("button", { name: /^Notifications, \d+ in progress$/ })).toBeVisible();

      await completeFakeTriggerRun(pool, reportJobId);
      const popover = await openNotifications(client);
      const notification = popover.getByRole("listitem").filter({ hasText: workspaceName }).first();
      await expect(notification.getByText("Report", { exact: true })).toBeVisible();
      await expect(notification.getByText("Completed", { exact: true })).toBeVisible();
      await expect(notification.getByRole("link", { name: "Download PDF" })).toHaveAttribute("href", `/api/reports/${reportJobId}/files/pdf`);
      await expect(notification.getByRole("link", { name: "Download CSV" })).toHaveAttribute("href", `/api/reports/${reportJobId}/files/csv`);
      await client.keyboard.press("Escape");
      await expect(popover).toBeHidden();
      await expect(reportRow.getByText("Completed", { exact: true })).toBeVisible();

      const pdfLink = reportRow.getByRole("link", { name: "Download PDF" });
      const csvLink = reportRow.getByRole("link", { name: "Download CSV" });
      const pdfHref = (await pdfLink.getAttribute("href"))!;
      const csvHref = (await csvLink.getAttribute("href"))!;
      expect([pdfHref, csvHref]).toEqual([`/api/reports/${reportJobId}/files/pdf`, `/api/reports/${reportJobId}/files/csv`]);
      const browserDownload = client.waitForEvent("download");
      await pdfLink.click();
      expect((await browserDownload).suggestedFilename()).toMatch(/^tracer-report-\d{4}-\d{2}-\d{2}\.pdf$/);
      const pdf = await expectAttachment(client.request, pdfHref, "application/pdf", /^tracer-report-\d{4}-\d{2}-\d{2}\.pdf$/);
      expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
      expectCsvHeader(await expectAttachment(client.request, csvHref, "text/csv; charset=utf-8", /^tracer-report-\d{4}-\d{2}-\d{2}\.csv$/));

      expect((await page.request.get(pdfHref)).status()).toBe(404);
      expect((await page.request.get(csvHref)).status()).toBe(404);

      const callsLoaded = client.waitForResponse((response) => new URL(response.url()).pathname === "/api/calls");
      await client.goto("/calls");
      await callsLoaded;
      await client.getByRole("button", { name: "Export CSV" }).click();
      const exportDialog = client.getByRole("dialog", { name: "Export CSV" });
      await expect(exportDialog).toBeVisible();
      await expect(exportDialog.locator("div").filter({ has: client.getByText("Matched Calls", { exact: true }) }).locator("dd")).toHaveText(String(seededCalls));
      const exportJob = createdJob(client);
      await exportDialog.getByRole("button", { name: "Export CSV" }).click();
      const exportJobId = await exportJob;
      await expect(exportDialog.getByText(/^Export requested\./)).toBeVisible();
      await exportDialog.getByRole("button", { name: "Done" }).click();
      await completeFakeTriggerRun(pool, exportJobId);
      const exportPopover = await openNotifications(client);
      const exportNotification = exportPopover.getByRole("listitem").filter({ hasText: "Calls CSV export" }).first();
      await expect(exportNotification.getByText("Completed", { exact: true })).toBeVisible();
      const exportHref = (await exportNotification.getByRole("link", { name: "Download CSV" }).getAttribute("href"))!;
      expect(exportHref).toBe(`/api/reports/${exportJobId}/files/csv`);
      expectCsvHeader(await expectAttachment(client.request, exportHref, "text/csv; charset=utf-8", /^tracer-calls-\d{4}-\d{2}-\d{2}\.csv$/));
      expect((await page.request.get(exportHref)).status()).toBe(404);
    } finally {
      await clientContext.close();
      await pool.end();
    }
  });

  for (const viewport of viewports) {
    test(`Reports and the Generate Report dialog fit a ${viewport.width}px viewport`, async ({ page, request }) => {
      test.setTimeout(120_000);
      expect(workspaceName).not.toBe("");
      await page.setViewportSize(viewport);
      await signIn(page, request, clientEmail);
      await gotoReports(page);
      await expect(page.getByRole("heading", { level: 1, name: "Reports" })).toBeVisible();
      await expectNoHorizontalPageScroll(page);
      await expectReachable(page.getByRole("button", { name: /^Notifications/ }));
      const reportRow = page.getByRole("row").filter({ hasText: workspaceName }).filter({ hasText: "PDF, CSV" });
      await expect(reportRow).toHaveCount(1);
      await expectGridScrollsInsideFrame(page);
      await expectReachable(reportRow.getByRole("button", { name: "View Parameters" }));
      await expectNoHorizontalPageScroll(page);

      await page.getByRole("button", { name: "Generate Report" }).first().click();
      const dialog = page.getByRole("dialog", { name: "Generate Report" });
      await expect(dialog).toBeVisible();
      const box = (await dialog.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      expect(await dialog.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(0);
      await expectReachable(dialog.getByRole("checkbox", { name: workspaceName }));
      for (const period of ["Previous Week", "Previous Month", "All Time", "Custom Range"]) {
        await expectReachable(dialog.getByRole("group", { name: "Report period" }).getByRole("button", { name: period }));
      }
      await dialog.getByRole("group", { name: "Report period" }).getByRole("button", { name: "Custom Range" }).click();
      await expectReachable(dialog.getByLabel("From"));
      await expectReachable(dialog.getByLabel("To"));
      await expectReachable(dialog.getByRole("checkbox", { name: "PDF report" }));
      await expectReachable(dialog.getByRole("checkbox", { name: "CSV detail" }));
      await dialog.getByRole("group", { name: "Report period" }).getByRole("button", { name: "All Time" }).click();
      await expect(dialog.getByRole("status")).toHaveText(`${seededCalls} matched Calls`);
      await expectReachable(dialog.getByRole("button", { name: "Generate Report" }));
      await expectReachable(dialog.getByRole("button", { name: "Cancel" }));
      await expectNoHorizontalPageScroll(page);
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await expect(dialog).toBeHidden();
    });
  }

  test.afterAll(async ({ browser, request }) => {
    const page = await browser.newPage();
    await signInAsOperator(page, request);
    await page.goto("/workspaces");
    await archiveActiveWorkspaces(page, "E2E Reports");
    await page.close();
  });
});
