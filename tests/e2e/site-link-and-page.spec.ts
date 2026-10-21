/**
 * -------------------------------------------------------------------------
 * @file   site-link-and-page.spec.ts
 * @brief  Covers linking a Site in the wizard and opening the Site page.
 *
 * @description
 *  Connects the fake Cloudflare account on Integrations, syncs its Sites,
 *  creates a Workspace through the wizard choosing a Site at the Site
 *  step, and opens the Site page as the Operator to see the hostname, the
 *  KPI tiles, and the Hosting panel. A Client Viewer with an Access Grant
 *  then opens the same Site page and sees the hostname without Hosting.
 *
 * @remarks
 *  Runs against the application booted with the E2E Cloudflare, Twilio,
 *  and Trigger.dev fakes. The chosen Site is released from any earlier run
 *  first so it reads Available in the picker.
 *
 * @see
 *  tests/e2e/helpers.ts
 *  components/tracer/site-view.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { expect, test, type Page } from "@playwright/test";

import { archiveActiveWorkspaces, createActiveWorkspace, ensureCloudflareSites, ensureTwilioNumbers, releaseSite, signIn, signInAsOperator } from "./helpers";

const clientEmail = "client@example.com";
const hostname = "pocatelloasphaltpaving.com";
let workspaceId = "";
let workspaceName = "";

async function grantClientViewer(page: Page, grantedId: string, grantedName: string): Promise<void> {
  await page.goto("/users");
  const existing = await page.evaluate(async (email) => {
    const body = (await (await fetch("/api/users")).json()) as { users: Array<{ id: string; email: string }> };
    return body.users.find((user) => user.email === email) ?? null;
  }, clientEmail);
  if (existing) {
    const status = await page.evaluate(
      async ({ userId, workspace }) =>
        (await fetch(`/api/users/${userId}/access-grants`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceId: workspace }) })).status,
      { userId: existing.id, workspace: grantedId },
    );
    expect([200, 201, 409]).toContain(status);
    return;
  }
  await page.getByRole("button", { name: "Provision User" }).click();
  await page.getByRole("textbox", { name: "Email" }).fill(clientEmail);
  await page.getByRole("combobox", { name: "Role" }).click();
  await page.getByRole("option", { name: "Client Viewer" }).click();
  await page.getByRole("checkbox", { name: grantedName }).click();
  await page.getByRole("button", { name: "Provision" }).click();
  await expect(page.getByRole("status")).toHaveText("Client Viewer provisioned.");
}

test.describe.serial("Site link and Site page", () => {
  test("an Operator connects Cloudflare, links a Site in the wizard, and opens the Site page", async ({ page, request }) => {
    test.setTimeout(180_000);
    await signInAsOperator(page, request);
    await ensureTwilioNumbers(page);
    await ensureCloudflareSites(page);
    await page.goto("/workspaces");
    await archiveActiveWorkspaces(page, "E2E Site");
    await releaseSite(page, hostname);
    workspaceName = `E2E Site ${Date.now()}`;
    workspaceId = await createActiveWorkspace(page, workspaceName, { site: hostname });
    expect(workspaceId).not.toBe("");

    await page.goto(`/workspaces/${workspaceId}/site`);
    await expect(page.getByRole("heading", { level: 1, name: workspaceName })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open Site" })).toHaveAttribute("href", `https://${hostname}`);
    for (const tile of ["Visits", "Page Views", "Calls", "Visit-to-Call"]) {
      await expect(page.getByRole("group", { name: tile })).toBeVisible();
    }
    await expect(page.getByRole("region", { name: "Hosting" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Replace Site" })).toBeVisible();
    await grantClientViewer(page, workspaceId, workspaceName);
  });

  test("a Client Viewer with an Access Grant sees the Site page without Hosting", async ({ browser, request }) => {
    test.setTimeout(120_000);
    expect(workspaceId).not.toBe("");
    const clientContext = await browser.newContext();
    const clientPage = await clientContext.newPage();
    await signIn(clientPage, request, clientEmail);
    await clientPage.goto(`/workspaces/${workspaceId}/site`);
    await expect(clientPage.getByRole("heading", { level: 1, name: workspaceName })).toBeVisible();
    await expect(clientPage.getByText(hostname).first()).toBeVisible();
    await expect(clientPage.getByRole("group", { name: "Visits" })).toBeVisible();
    await expect(clientPage.getByRole("region", { name: "Hosting" })).toHaveCount(0);
    await expect(clientPage.getByRole("button", { name: "Replace Site" })).toHaveCount(0);
    await expect(clientPage.getByRole("button", { name: "Refresh Preview" })).toHaveCount(0);
    await clientContext.close();
  });

  test.afterAll(async ({ browser, request }) => {
    const page = await browser.newPage();
    await signInAsOperator(page, request);
    await page.goto("/workspaces");
    await archiveActiveWorkspaces(page, "E2E Site");
    await page.close();
  });
});
