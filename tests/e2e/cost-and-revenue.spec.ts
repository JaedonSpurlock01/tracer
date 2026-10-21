/**
 * -------------------------------------------------------------------------
 * @file   cost-and-revenue.spec.ts
 * @brief  Covers the Deal editor, the Home Money row, and the Client Viewer boundary.
 *
 * @description
 *  An Operator activates a Workspace, adds a Monthly Deal from Site
 *  settings, and reads Monthly Cost, Monthly Revenue, and Profit on Home,
 *  the Profit tile with the Deal on the Workspace Overview, and the
 *  Pricing guide. A Client Viewer granted that Workspace then sees none
 *  of cost, revenue, or profit, gets 403 from the Deal route, and Not
 *  Found from the Pricing guide.
 *
 * @remarks
 *  The fake Twilio boundary exposes two numbers, so the journey archives
 *  its own Workspaces before and after running. The Client Viewer is
 *  provisioned once and its grants are moved to this journey's Workspace.
 *
 * @see
 *  tests/e2e/helpers.ts
 *  data/cost-revenue.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { expect, test, type Page } from "@playwright/test";

import { archiveActiveWorkspaces, createActiveWorkspace, ensureTwilioNumbers, signIn, signInAsOperator } from "./helpers";

const clientEmail = "client@example.com";
let workspaceId = "";
let workspaceName = "";

async function findClientViewer(page: Page) {
  return page.evaluate(async (email) => {
    const body = (await (await fetch("/api/users")).json()) as { users: Array<{ id: string; email: string; accessGrants: Array<{ workspaceId: string }> }> };
    return body.users.find((user) => user.email === email) ?? null;
  }, clientEmail);
}

test.describe.serial("Cost and revenue", () => {
  test("an Operator adds a Monthly Deal and reads cost, revenue, and profit on Home", async ({ page, request }) => {
    test.setTimeout(180_000);
    await signInAsOperator(page, request);
    await ensureTwilioNumbers(page);
    await page.goto("/workspaces");
    await archiveActiveWorkspaces(page, "E2E Cost");
    workspaceName = `E2E Cost ${Date.now()}`;
    workspaceId = await createActiveWorkspace(page, workspaceName);
    expect(workspaceId).not.toBe("");

    await page.goto(`/workspaces/${workspaceId}/settings/site`);
    const deal = page.getByRole("region", { name: "Deal" });
    await expect(deal.getByText("No Deal")).toBeVisible();
    await deal.getByRole("button", { name: "Add Deal" }).click();
    const dialog = page.getByRole("dialog", { name: "Add Deal" });
    await dialog.getByLabel("Amount").fill("500");
    await dialog.getByLabel("Start date").fill("2026-10-01");
    await dialog.getByRole("button", { name: "Save Deal" }).click();
    await expect(page.getByRole("status")).toHaveText("Deal saved.");
    await expect(deal.getByText("Monthly, $500.00 per month, since Oct 1, 2026")).toBeVisible();

    await page.goto("/");
    const money = /-?\$[\d,]+\.\d{2}/;
    await expect(page.getByRole("group", { name: "Monthly Cost" })).toContainText(money);
    await expect(page.getByRole("group", { name: "Monthly Cost" })).toContainText(/Projected \$[\d,]+\.\d{2} per year/);
    await expect(page.getByRole("group", { name: "Monthly Revenue" })).toContainText(money);
    await expect(page.getByRole("group", { name: "Profit" })).toContainText(money);
    await page.getByRole("link", { name: "Pricing guide" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Pricing" })).toBeVisible();
    await expect(page.getByRole("region", { name: "A two-hour Call" })).toContainText("$4.44");

    await page.goto(`/workspaces/${workspaceId}`);
    await expect(page.getByRole("group", { name: "Profit" })).toContainText("Monthly, $500.00 per month, since Oct 1, 2026");
    await expect(page.getByRole("group", { name: "Monthly Cost" })).toBeVisible();
  });

  test("a Client Viewer never sees cost, revenue, profit, or the Deal", async ({ browser, page, request }) => {
    test.setTimeout(180_000);
    expect(workspaceId).not.toBe("");
    await signInAsOperator(page, request);
    await page.goto("/users");
    const existing = await findClientViewer(page);
    if (existing) {
      if (!existing.accessGrants.some((grant) => grant.workspaceId === workspaceId)) {
        await page.getByRole("row", { name: new RegExp(clientEmail) }).getByRole("button", { name: /^Manage / }).click();
        await page.getByRole("combobox", { name: "Add Workspace Access" }).click();
        await page.getByRole("option", { name: workspaceName }).click();
        await page.getByRole("button", { name: "Add Access" }).click();
        await expect(page.getByRole("button", { name: `Remove ${workspaceName}` })).toBeVisible();
      }
      await page.evaluate(async ({ userId, keep, grants }) => {
        for (const grant of grants) {
          if (grant.workspaceId !== keep) await fetch(`/api/users/${userId}/access-grants/${grant.workspaceId}`, { method: "DELETE" });
        }
      }, { userId: existing.id, keep: workspaceId, grants: existing.accessGrants });
    } else {
      await page.getByRole("button", { name: "Provision User" }).click();
      await page.getByRole("textbox", { name: "Email" }).fill(clientEmail);
      await page.getByRole("combobox", { name: "Role" }).click();
      await page.getByRole("option", { name: "Client Viewer" }).click();
      await page.getByRole("checkbox", { name: workspaceName }).click();
      await page.getByRole("button", { name: "Provision" }).click();
      await expect(page.getByRole("status")).toHaveText("Client Viewer provisioned.");
    }

    const clientContext = await browser.newContext();
    const clientPage = await clientContext.newPage();
    await signIn(clientPage, request, clientEmail);
    await clientPage.goto("/");
    await expect(clientPage).toHaveURL(new RegExp(`/workspaces/${workspaceId}$`));
    await expect(clientPage.getByRole("heading", { name: workspaceName })).toBeVisible();
    await expect(clientPage.getByRole("group", { name: "Monthly Cost" })).toHaveCount(0);
    await expect(clientPage.getByRole("group", { name: "Profit" })).toHaveCount(0);
    await expect(clientPage.getByText("Monthly, $500.00")).toHaveCount(0);
    await clientPage.goto(`/workspaces/${workspaceId}/site`);
    await expect(clientPage.getByRole("region", { name: "Deal and cost" })).toHaveCount(0);
    const api = await clientPage.evaluate(async (id) => ({
      deal: (await fetch(`/api/workspaces/${id}/deal`)).status,
      domain: (await fetch(`/api/workspaces/${id}/site/domain`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ registrar: "x", renewalCents: 1, renewsOn: "2027-01-01" }) })).status,
    }), workspaceId);
    expect(api).toEqual({ deal: 403, domain: 403 });
    expect((await clientPage.goto("/pricing"))?.status()).toBe(404);
    await clientContext.close();
  });

  test.afterAll(async ({ browser, request }) => {
    const page = await browser.newPage();
    await signInAsOperator(page, request);
    await page.goto("/workspaces");
    if (workspaceId) {
      await page.evaluate(async (id) => {
        const body = (await (await fetch(`/api/workspaces/${id}/deal`)).json()) as { deal: { id: string } | null };
        if (body.deal) await fetch(`/api/workspaces/${id}/deal/${body.deal.id}/end`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ endedOn: new Date().toISOString().slice(0, 10) }) });
      }, workspaceId);
    }
    await archiveActiveWorkspaces(page, "E2E Cost");
    await page.close();
  });
});
