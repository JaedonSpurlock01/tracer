/**
 * -------------------------------------------------------------------------
 * @file   helpers.ts
 * @brief  Provides reusable Playwright sign-in and Workspace helpers.
 *
 * @description
 *  Signs users in through the visible email-code flow and the gated E2E OTP
 *  endpoint, connects the fake Twilio account, connects the fake Cloudflare
 *  account and syncs its Sites, connects the fake DataForSEO account (each
 *  through its own provider detail on Integrations, since the Needs
 *  attention lane repeats the Connect action),
 *  releases a Site from an earlier run,
 *  creates or archives Active Workspaces through the same pages and server
 *  interfaces a browser journey uses, optionally linking a Site at the
 *  wizard's Site step, and delivers Twilio webhooks signed with the fake
 *  account's Auth Token.
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

import { signTwilioRequest } from "../../data/twilio-signature";

const baseURL = "http://127.0.0.1:3000";
const twilioAuthToken = "e2e-auth-token";

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
  await page.goto("/integrations?provider=twilio");
  const detail = page.getByRole("region", { name: "Twilio" });
  await expect(detail.getByRole("button", { name: /^(Connect Twilio|Sync Numbers)$/ })).toBeVisible();
  const connectButton = detail.getByRole("button", { name: "Connect Twilio" });
  if ((await connectButton.count()) > 0) {
    await connectButton.click();
    await page.getByLabel("Account SID").fill(`AC${"a".repeat(32)}`);
    await page.getByLabel("API Key SID").fill(`SK${"b".repeat(32)}`);
    await page.getByLabel("API Key Secret").fill("e2e-secret");
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await expect(page.getByRole("button", { name: "Sync Numbers" })).toBeVisible();
  }
  await detail.getByRole("button", { name: "Set Auth Token" }).click();
  await page.getByLabel("Auth Token", { exact: true }).fill(twilioAuthToken);
  await page.getByRole("button", { name: "Save Auth Token" }).click();
  await expect(page.getByText("Twilio Auth Token saved.")).toBeVisible();
  await page.getByRole("button", { name: "Sync Numbers" }).click();
  await expect(page.getByText(/Synced/).first()).toBeVisible();
}

export async function ensureCloudflareSites(page: Page): Promise<void> {
  await page.goto("/integrations?provider=cloudflare");
  const detail = page.getByRole("region", { name: "Cloudflare" });
  await expect(detail.getByRole("button", { name: /^(Connect Cloudflare|Sync now)$/ })).toBeVisible();
  const connectButton = detail.getByRole("button", { name: "Connect Cloudflare" });
  if ((await connectButton.count()) > 0) {
    await connectButton.click();
    await page.getByLabel("Account ID").fill("a".repeat(32));
    await page.getByLabel("API Token").fill("e2e-cloudflare-token");
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await expect(page.getByRole("button", { name: "Sync now" })).toBeVisible();
  }
  await page.getByRole("button", { name: "Sync now" }).click();
  await expect(page.getByText(/Synced \d+ Sites\./)).toBeVisible();
}

export async function ensureDataForSeo(page: Page): Promise<void> {
  await page.goto("/integrations?provider=dataforseo");
  const detail = page.getByRole("region", { name: "DataForSEO" });
  await expect(detail.getByRole("button", { name: /^(Connect DataForSEO|Rotate Password)$/ })).toBeVisible();
  const connectButton = detail.getByRole("button", { name: "Connect DataForSEO" });
  if ((await connectButton.count()) > 0) {
    await connectButton.click();
    await page.getByLabel("API login").fill("operator@example.com");
    await page.getByLabel("API password").fill("e2e-dataforseo-password");
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("DataForSEO connected.");
  }
  await expect(page.getByRole("button", { name: "Rotate Password" })).toBeVisible();
}

export async function releaseSite(page: Page, hostname: string): Promise<void> {
  await page.evaluate(async (host) => {
    const response = await fetch(`/api/workspaces/sites?search=${encodeURIComponent(host)}&pageSize=5`);
    if (!response.ok) return;
    const body = (await response.json()) as { sites: Array<{ primaryHostname: string; linkedWorkspace: { id: string } | null }> };
    for (const site of body.sites) {
      if (site.primaryHostname === host && site.linkedWorkspace) await fetch(`/api/workspaces/${site.linkedWorkspace.id}/site/detach`, { method: "POST" });
    }
  }, hostname);
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

export async function createActiveWorkspace(page: Page, name: string, options: { recording?: boolean; site?: string } = {}): Promise<string> {
  await page.goto("/workspaces");
  await page.getByRole("button", { name: "Create Workspace" }).first().click();
  await page.getByLabel("Workspace name").fill(name);
  await page.getByRole("button", { name: "Create Workspace" }).last().click();
  if (options.site) {
    await page.getByRole("searchbox", { name: "Search Sites" }).fill(options.site);
    await page.getByRole("radio", { name: options.site }).check();
    await page.getByRole("button", { name: "Link Site" }).click();
  } else {
    await page.getByRole("button", { name: "Skip" }).click();
  }
  await page.getByRole("radio", { disabled: false }).first().check();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByLabel("Destination Number").fill("+14155550199");
  if (options.recording) await page.getByRole("switch", { name: "Recording enabled" }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByText("Incoming Call")).toBeVisible();
  await page.getByRole("button", { name: "Create and Activate" }).click();
  await expect(page.getByRole("status")).toHaveText(`${name} is Active.`);
  await page.getByLabel("Search workspaces").fill(name);
  const link = page.getByRole("row", { name: new RegExp(name) }).getByRole("link", { name: new RegExp(name) });
  return new URL((await link.getAttribute("href")) ?? "", baseURL).pathname.split("/")[2] ?? "";
}

export async function twilioCallback(request: APIRequestContext, path: string, params: Record<string, string>): Promise<void> {
  const url = `${baseURL}${path}`;
  const signature = await signTwilioRequest({ authToken: twilioAuthToken, url, params });
  const response = await request.post(url, { form: params, headers: { "x-twilio-signature": signature } });
  expect(response.status(), path).toBeLessThan(300);
}
