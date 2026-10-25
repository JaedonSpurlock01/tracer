/**
 * -------------------------------------------------------------------------
 * @file   workspace-activation-and-flow.spec.ts
 * @brief  Verifies Workspace activation and Flow publication journeys.
 *
 * @description
 *  Crosses the Operator UI, Workspace routing API, and fake Twilio boundary.
 *
 * @remarks
 *  The suite is serial because Journey 3 publishes the Workspace created by
 *  Journey 2.
 *
 * @see
 *  components/tracer/workspaces-view.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { expect, test } from "@playwright/test";

import { archiveActiveWorkspaces, createActiveWorkspace, ensureTwilioNumbers, signInAsOperator } from "./helpers";

let workspaceId = "";
let workspaceName = "";

test.describe.serial("Workspace activation and Flow publication", () => {
  test("an Operator creates and activates a Workspace through fake provider boundaries", async ({ page, request }) => {
    test.setTimeout(90_000);
    await signInAsOperator(page, request);
    await ensureTwilioNumbers(page);
    workspaceName = `E2E Workspace ${Date.now()}`;
    await page.goto("/workspaces");
    await page.evaluate(async () => {
      const response = await fetch("/api/workspaces?search=E2E%20Workspace&pageSize=50");
      if (!response.ok) return;
      const body = (await response.json()) as { workspaces: Array<{ id: string; name: string; state: string }> };
      for (const item of body.workspaces) {
        if (item.name.startsWith("E2E Workspace") && item.state === "Active") {
          await fetch(`/api/workspaces/${item.id}/archive`, { method: "POST" });
        }
      }
    });
    await page.reload();
    await page.getByRole("button", { name: "Create Workspace" }).first().click();
    await page.getByLabel("Workspace name").fill(workspaceName);
    await page.getByRole("button", { name: "Create Workspace" }).last().click();
    await page.getByRole("button", { name: "Skip" }).click();
    const selectedNumber = page.getByRole("radio", { disabled: false }).first();
    const selectedTrackingNumber = await selectedNumber.getAttribute("aria-label");
    await selectedNumber.check();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await page.getByLabel("Destination Number").fill("+14155550199");
    await page.getByRole("switch", { name: "Recording enabled" }).click();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByText("Incoming Call")).toBeVisible();
    await expect(page.getByText("Recording Disclosure")).toBeVisible();
    await page.getByRole("button", { name: "Create and Activate" }).click();
    await expect(page.getByRole("status")).toHaveText(`${workspaceName} is Active.`);
    await page.getByLabel("Search workspaces").fill(workspaceName);
    const row = page.getByRole("row", { name: new RegExp(workspaceName) });
    await expect(row).toBeVisible();
    const workspaceLink = row.getByRole("link", { name: workspaceName });
    workspaceId = new URL((await workspaceLink.getAttribute("href")) ?? "", "http://127.0.0.1:3000").pathname.split("/")[2] ?? "";
    await expect(row).toContainText("Active");
    await expect(row).toContainText(selectedTrackingNumber ?? "");
  });

  test("an Operator publishes a valid Call Flow and an invalid flow is rejected", async ({ page, request }) => {
    test.setTimeout(90_000);
    expect(workspaceId).not.toBe("");
    await signInAsOperator(page, request);
    await page.goto(`/workspaces/${workspaceId}/flow`);
    await expect(page.getByRole("main").getByText("Published v1")).toBeVisible();
    await page.getByRole("button", { name: "Edit Flow" }).click();
    await page.getByTestId("flow-node-forward").click();
    await page.getByRole("combobox", { name: "missed" }).selectOption("none");
    await expect(page.getByRole("alert").first()).toBeVisible();
    await expect(page.getByText(/^\d+ issues?$/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Publish" })).toBeDisabled();
    const saved = page.waitForResponse((response) => response.request().method() === "PUT" && response.url().includes(`/workspaces/${workspaceId}/flow`) && (response.request().postData() ?? "").includes("outcome-missed"));
    await page.getByRole("combobox", { name: "missed" }).selectOption("outcome-missed");
    await saved;
    await expect(page.getByText("Publishable", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Publish" }).click();
    await expect(page.getByText("Version 2 published")).toBeVisible();
    const versions = await page.evaluate(async (id) => {
      const responses = await Promise.all([fetch(`/api/workspaces/${id}/flow/versions/1`), fetch(`/api/workspaces/${id}/flow/versions/2`)]);
      return { firstOk: responses[0].ok, secondOk: responses[1].ok, first: await responses[0].json(), second: await responses[1].json() };
    }, workspaceId);
    expect(versions.firstOk).toBeTruthy();
    expect(versions.secondOk).toBeTruthy();
    const firstGraph = (versions.first as { graph: { edges: Array<{ sourceHandle: string }> } }).graph;
    expect(firstGraph.edges.some((edge) => edge.sourceHandle === "missed")).toBeTruthy();
  });

  test("an Operator moves between Workspace Settings pages and detaches the Tracking Number", async ({ page, request }) => {
    test.setTimeout(90_000);
    await signInAsOperator(page, request);
    await ensureTwilioNumbers(page);
    await page.goto("/workspaces");
    await archiveActiveWorkspaces(page, "E2E");
    const workspaceId = await createActiveWorkspace(page, `E2E Detach ${Date.now()}`);
    await page.goto(`/workspaces/${workspaceId}/settings`);
    await expect(page).toHaveURL(new RegExp(`/workspaces/${workspaceId}/settings/general$`));
    await expect(page.getByLabel("Workspace name")).toBeVisible();
    await page.getByRole("navigation", { name: "Workspace settings sections" }).getByRole("link", { name: "Number" }).click();
    await expect(page).toHaveURL(new RegExp(`/workspaces/${workspaceId}/settings/number$`));
    await expect(page.getByLabel("Workspace name")).toHaveCount(0);
    await page.getByRole("button", { name: "Detach Number" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Detach Number" }).click();
    await expect(page.getByText("Tracking Number detached. Activate the Workspace on a number to resume routing.")).toBeVisible();
    await expect(page.getByText("No Tracking Number")).toBeVisible();
  });
});
