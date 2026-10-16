/**
 * -------------------------------------------------------------------------
 * @file   helpers.ts
 * @brief  Provides reusable Playwright sign-in and Workspace helpers.
 *
 * @description
 *  Signs users in through the visible email-code flow and the gated E2E OTP
 *  endpoint, connects the fake Twilio account, and creates or archives
 *  Active Workspaces through the same pages and server interfaces a browser
 *  journey uses.
 *
 * @remarks
 *  The helper crosses the same public boundaries as a browser journey.
 *
 * @see
 *  tests/e2e/provisioned-email-code-sign-in.spec.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

export async function signInAsOperator(page: Page, request: APIRequestContext): Promise<void> {
  await signIn(page, request, "operator@example.com");
}

export async function signIn(page: Page, request: APIRequestContext, email: string): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Send sign-in code" }).click();
  await expect(page).toHaveURL(/\/verify-email$/);
  const otpResponse = await request.get("/api/test/auth-otp");
  expect(otpResponse.ok()).toBeTruthy();
  const { code } = (await otpResponse.json()) as { code: string | null };
  expect(code).toMatch(/^\d{6}$/);
  await page.getByLabel("Verification code").fill(code!);
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page).toHaveURL(/\/account\/settings$/);
}

export async function ensureTwilioNumbers(page: Page): Promise<void> {
  await page.goto("/integrations");
  await expect(page.getByRole("button", { name: /^(Connect Twilio|Sync Numbers)$/ }).first()).toBeVisible();
  const connectButton = page.getByRole("button", { name: "Connect Twilio" });
  if ((await connectButton.count()) > 0) {
    await connectButton.click();
    await page.getByLabel("Account SID").fill(`AC${"a".repeat(32)}`);
    await page.getByLabel("API Key SID").fill(`SK${"b".repeat(32)}`);
    await page.getByLabel("API Key Secret").fill("e2e-secret");
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await expect(page.getByRole("button", { name: "Sync Numbers" })).toBeVisible();
  }
  await page.getByRole("button", { name: "Set Auth Token" }).click();
  await page.getByLabel("Auth Token", { exact: true }).fill("e2e-auth-token");
  await page.getByRole("button", { name: "Save Auth Token" }).click();
  await expect(page.getByText("Twilio Auth Token saved.")).toBeVisible();
  await page.getByRole("button", { name: "Sync Numbers" }).click();
  await expect(page.getByText(/Synced/).first()).toBeVisible();
}

export async function archiveActiveWorkspaces(page: Page, namePrefix: string): Promise<void> {
  await page.evaluate(async (prefix) => {
    const response = await fetch(`/api/workspaces?search=${encodeURIComponent(prefix)}&state=Active&pageSize=50`);
    if (!response.ok) return;
    const body = (await response.json()) as { workspaces: Array<{ id: string; name: string }> };
    for (const item of body.workspaces) {
      if (item.name.startsWith(prefix)) await fetch(`/api/workspaces/${item.id}/archive`, { method: "POST" });
    }
  }, namePrefix);
}

export async function createActiveWorkspace(page: Page, name: string): Promise<string> {
  await page.goto("/workspaces");
  await page.getByRole("button", { name: "Create Workspace" }).first().click();
  await page.getByLabel("Workspace name").fill(name);
  await page.getByRole("button", { name: "Create Workspace" }).last().click();
  await page.getByRole("radio", { disabled: false }).first().check();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByLabel("Destination Number").fill("+14155550199");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByText("Incoming Call")).toBeVisible();
  await page.getByRole("button", { name: "Create and Activate" }).click();
  await expect(page.getByRole("status")).toHaveText(`${name} is Active.`);
  await page.getByLabel("Search workspaces").fill(name);
  const link = page.getByRole("row", { name: new RegExp(name) }).getByRole("link", { name: new RegExp(name) });
  return new URL((await link.getAttribute("href")) ?? "", "http://127.0.0.1:3000").pathname.split("/")[2] ?? "";
}
