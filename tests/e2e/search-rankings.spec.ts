/**
 * -------------------------------------------------------------------------
 * @file   search-rankings.spec.ts
 * @brief  Covers Keywords, the daily rank check, and the Search panel.
 *
 * @description
 *  Connects the fake DataForSEO account on Integrations, links a Site to
 *  a new Workspace, sets the Site's Service Area and two Keywords in Site
 *  settings, runs the rank check through the E2E-only check route, and
 *  reads the Search Visibility score with both positions on the Site page
 *  and the score tile on the Workspace Overview.
 *
 * @remarks
 *  Runs against the application booted with the E2E DataForSEO,
 *  Cloudflare, Twilio, and Trigger.dev fakes. The fake ranks a phrase
 *  whose length is a multiple of three first and otherwise at its length
 *  modulo 12 plus 2, so the two phrases below land at 1 and 3 for a score
 *  of 73. Keywords belong to the Site, so any left by an earlier run are
 *  removed first.
 *
 * @see
 *  tests/e2e/helpers.ts
 *  data/e2e-dataforseo-fake.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { expect, test } from "@playwright/test";

import { archiveActiveWorkspaces, createActiveWorkspace, ensureCloudflareSites, ensureDataForSeo, ensureTwilioNumbers, releaseSite, signInAsOperator } from "./helpers";

const hostname = "pocatelloasphaltpaving.com";
const phrases = ["asphalt paving pocatello", "driveway paving pocatello"];

test.describe.serial("Search rankings", () => {
  let workspaceId = "";
  let workspaceName = "";

  test("an Operator sets a Service Area and Keywords, runs the check, and sees the Search Visibility score", async ({ page, request }) => {
    test.setTimeout(240_000);
    await signInAsOperator(page, request);
    await ensureTwilioNumbers(page);
    await ensureCloudflareSites(page);
    await ensureDataForSeo(page);
    await page.goto("/workspaces");
    await archiveActiveWorkspaces(page, "E2E Search");
    await releaseSite(page, hostname);
    workspaceName = `E2E Search ${Date.now()}`;
    workspaceId = await createActiveWorkspace(page, workspaceName, { site: hostname });
    expect(workspaceId).not.toBe("");

    await page.evaluate(async (id) => {
      const body = (await (await fetch(`/api/workspaces/${id}/site/keywords`)).json()) as { keywords: Array<{ id: string }> };
      for (const keyword of body.keywords) await fetch(`/api/workspaces/${id}/site/keywords/${keyword.id}`, { method: "DELETE" });
    }, workspaceId);

    await page.goto(`/workspaces/${workspaceId}/settings/site`);
    const area = page.getByRole("region", { name: "Service Area" });
    await area.getByRole("combobox", { name: "Search locations" }).fill("Pocatello");
    await area.getByRole("option", { name: /^Pocatello, Idaho, United States/ }).click();
    await area.getByRole("button", { name: "Save Service Area" }).click();
    await expect(page.getByRole("status")).toHaveText("Service Area saved.");
    const keywords = page.getByRole("region", { name: "Keywords" });
    for (const phrase of phrases) {
      await keywords.getByLabel("Keyword phrase").fill(phrase);
      await keywords.getByRole("button", { name: "Add Keyword" }).click();
      await expect(keywords.getByText(phrase)).toBeVisible();
    }
    await expect(keywords.getByText("2 of 25 Keywords")).toBeVisible();

    const result = await page.evaluate(async () => {
      const response = await fetch("/api/integrations/dataforseo/check", { method: "POST" });
      return { status: response.status, body: (await response.json()) as { checked: number; failed: number } };
    });
    expect(result.status).toBe(200);
    expect(result.body.failed).toBe(0);
    expect(result.body.checked).toBeGreaterThanOrEqual(2);

    await page.goto(`/workspaces/${workspaceId}/site`);
    const search = page.getByRole("region", { name: "Search" });
    await expect(search.getByText("73", { exact: true }).first()).toBeVisible();
    await expect(search.getByText("/100")).toBeVisible();
    const table = search.getByRole("table", { name: "Keywords" });
    await expect(table.getByRole("row", { name: /asphalt paving pocatello/ })).toContainText("1");
    await expect(table.getByRole("row", { name: /driveway paving pocatello/ })).toContainText("3");

    await page.goto(`/workspaces/${workspaceId}`);
    await expect(page.getByRole("group", { name: "Search Visibility" })).toContainText("73");
  });

  test.afterAll(async ({ browser, request }) => {
    const page = await browser.newPage();
    await signInAsOperator(page, request);
    await page.goto("/workspaces");
    await archiveActiveWorkspaces(page, "E2E Search");
    await page.close();
  });
});
