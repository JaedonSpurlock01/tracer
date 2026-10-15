/**
 * -------------------------------------------------------------------------
 * @file   helpers.ts
 * @brief  Provides reusable Playwright sign-in helpers.
 *
 * @description
 *  Signs an Operator in through the visible email-code flow and the gated E2E
 *  OTP endpoint.
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
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill("operator@example.com");
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
