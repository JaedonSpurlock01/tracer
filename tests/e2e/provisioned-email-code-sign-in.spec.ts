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

import { signInAsOperator } from "./helpers";

test("provisioned identity signs in with an email code", async ({ page, request }) => {
  await signInAsOperator(page, request);
  await expect(page.getByRole("button", { name: "Profile", exact: true })).toBeVisible();
  await page.goto("/users");
  await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Integrations" })).toBeVisible();
});

test("unauthenticated shell routes redirect to Sign In", async ({ request }) => {
  const response = await request.get("/users", { maxRedirects: 0 });
  expect(response.status()).toBeGreaterThanOrEqual(300);
  expect(response.status()).toBeLessThan(400);
  expect(response.headers().location).toContain("/sign-in");
});
