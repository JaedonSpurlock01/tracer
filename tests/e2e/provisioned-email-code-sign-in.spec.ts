/**
 * -------------------------------------------------------------------------
 * @file   provisioned-email-code-sign-in.spec.ts
 * @brief  Verifies the provisioned email-code browser journey.
 *
 * @description
 *  Crosses the sign-in page, Better Auth route, fake email boundary, and
 *  verification page without intercepting application routes.
 *
 * @remarks
 *  The dedicated E2E PostgreSQL prerequisite must be migrated and bootstrapped
 *  before this journey can run.
 *
 * @see
 *  app/sign-in/page.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { expect, test } from "@playwright/test";

test("provisioned identity signs in with an email code", async ({ page, request }) => {
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
  await expect(page.getByRole("button", { name: "Profile", exact: true })).toBeVisible();
});
