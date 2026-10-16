/**
 * -------------------------------------------------------------------------
 * @file   workspace-access-grants.spec.ts
 * @brief  Browser journey for Client Viewer Access Grants.
 *
 * @description
 *  An Operator activates two Workspaces, grants a Client Viewer one of them,
 *  and the Client Viewer lands on that Workspace while every ungranted
 *  Workspace and Operator surface is denied through pages and the server
 *  interface. Moving the grant revokes access for the already signed-in
 *  Client Viewer on the next request.
 *
 * @remarks
 *  The fake Twilio boundary exposes two numbers, so the journey archives its
 *  own Workspaces before and after running to keep numbers free for the
 *  activation journey. The local e2e database persists between runs, so the
 *  Client Viewer is provisioned once and its grants are reset afterwards.
 *
 * @see
 *  tests/e2e/helpers.ts
 *  data/workspace-authorization.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { expect, test, type Page } from "@playwright/test";

import { archiveActiveWorkspaces, createActiveWorkspace, ensureTwilioNumbers, signIn, signInAsOperator } from "./helpers";

const clientEmail = "client@example.com";
let grantedId = "";
let grantedName = "";
let ungrantedId = "";
let ungrantedName = "";

async function findClientViewer(page: Page) {
  return page.evaluate(async (email) => {
    const body = (await (await fetch("/api/users")).json()) as {
      users: Array<{ id: string; email: string; accessGrants: Array<{ workspaceId: string }> }>;
    };
    return body.users.find((user) => user.email === email) ?? null;
  }, clientEmail);
}

test.describe.serial("Workspace Access Grants", () => {
  test("an Operator grants a Client Viewer one Active Workspace", async ({ page, request }) => {
    test.setTimeout(120_000);
    await signInAsOperator(page, request);
    await ensureTwilioNumbers(page);
    await page.goto("/workspaces");
    await archiveActiveWorkspaces(page, "E2E");
    const suffix = Date.now();
    grantedName = `E2E Access Granted ${suffix}`;
    ungrantedName = `E2E Access Ungranted ${suffix}`;
    grantedId = await createActiveWorkspace(page, grantedName);
    ungrantedId = await createActiveWorkspace(page, ungrantedName);

    await page.goto("/users");
    const existing = await findClientViewer(page);
    if (existing) {
      await page.getByRole("row", { name: new RegExp(clientEmail) }).getByRole("button", { name: /^Manage / }).click();
      await page.getByRole("combobox", { name: "Add Workspace Access" }).click();
      await page.getByRole("option", { name: grantedName }).click();
      await page.getByRole("button", { name: "Add Access" }).click();
      await expect(page.getByRole("button", { name: `Remove ${grantedName}` })).toBeVisible();
      await page.evaluate(async ({ userId, keep, grants }) => {
        for (const grant of grants) {
          if (grant.workspaceId !== keep) await fetch(`/api/users/${userId}/access-grants/${grant.workspaceId}`, { method: "DELETE" });
        }
      }, { userId: existing.id, keep: grantedId, grants: existing.accessGrants });
    } else {
      await page.getByRole("button", { name: "Provision User" }).click();
      await page.getByRole("textbox", { name: "Email" }).fill(clientEmail);
      await page.getByRole("combobox", { name: "Role" }).click();
      await page.getByRole("option", { name: "Client Viewer" }).click();
      await page.getByRole("checkbox", { name: grantedName }).click();
      await page.getByRole("button", { name: "Provision" }).click();
      await expect(page.getByRole("status")).toHaveText("Client Viewer provisioned.");
    }
    const client = await findClientViewer(page);
    expect(client?.accessGrants.map((grant) => grant.workspaceId)).toEqual([grantedId]);
  });

  test("a Client Viewer opens only the granted Workspace and loses it after revocation", async ({ browser, page, request }) => {
    test.setTimeout(120_000);
    expect(grantedId).not.toBe("");
    const clientContext = await browser.newContext();
    const clientPage = await clientContext.newPage();
    await signIn(clientPage, request, clientEmail);

    await clientPage.goto("/");
    await expect(clientPage).toHaveURL(new RegExp(`/workspaces/${grantedId}$`));
    await expect(clientPage.getByRole("heading", { name: grantedName })).toBeVisible();
    await expect(clientPage.getByRole("link", { name: "Edit Flow" })).toHaveCount(0);
    await expect(clientPage.getByRole("link", { name: "Workspace Settings" })).toHaveCount(0);
    await expect(clientPage.getByRole("link", { name: "Users" })).toHaveCount(0);

    expect((await clientPage.goto(`/workspaces/${ungrantedId}`))?.status()).toBe(404);
    expect((await clientPage.goto(`/workspaces/${grantedId}/settings`))?.status()).toBe(404);
    expect((await clientPage.goto(`/workspaces/${grantedId}/flow`))?.status()).toBe(404);
    expect((await clientPage.goto("/users"))?.status()).toBe(404);
    const api = await clientPage.evaluate(async ({ granted, ungranted }) => ({
      ungranted: (await fetch(`/api/workspaces/${ungranted}`)).status,
      mutate: (await fetch(`/api/workspaces/${granted}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Renamed" }) })).status,
      users: (await fetch("/api/users")).status,
    }), { granted: grantedId, ungranted: ungrantedId });
    expect(api).toEqual({ ungranted: 404, mutate: 403, users: 403 });

    await signInAsOperator(page, request);
    await page.goto("/workspaces");
    const client = await findClientViewer(page);
    const moved = await page.evaluate(async ({ userId, add, remove }) => {
      const added = await fetch(`/api/users/${userId}/access-grants`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceId: add }) });
      const removed = await fetch(`/api/users/${userId}/access-grants/${remove}`, { method: "DELETE" });
      return [added.status, removed.status];
    }, { userId: client!.id, add: ungrantedId, remove: grantedId });
    expect(moved).toEqual([200, 200]);

    expect((await clientPage.goto(`/workspaces/${grantedId}`))?.status()).toBe(404);
    expect((await clientPage.goto(`/workspaces/${ungrantedId}`))?.status()).toBe(200);
    await clientContext.close();
  });

  test.afterAll(async ({ browser, request }) => {
    const page = await browser.newPage();
    await signInAsOperator(page, request);
    await page.goto("/workspaces");
    await archiveActiveWorkspaces(page, "E2E Access");
    await page.close();
  });
});
