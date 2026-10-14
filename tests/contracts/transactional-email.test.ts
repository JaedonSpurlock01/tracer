/**
 * -------------------------------------------------------------------------
 * @file   transactional-email.test.ts
 * @brief  Verifies Cloudflare Email Service request mapping.
 *
 * @description
 *  Confirms structured sends and recipient allowlist decisions at the
 *  provider boundary without exposing sign-in codes through logs.
 *
 * @remarks
 *  The binding is a provider fake, not an internal application mock.
 *
 * @see
 *  data/transactional-email.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { describe, expect, it, vi } from "vitest";

import { isAllowedRecipient } from "@/data/transactional-email";
import { createCloudflareTransactionalEmail, sendAccessCreatedNotice, sendSignInCode } from "@/data/transactional-email";

describe("Cloudflare transactional email", () => {
  it("maps a sign-in code to the structured EMAIL.send payload", async () => {
    const send = vi.fn().mockResolvedValue({ messageId: "email-1" });
    const email = createCloudflareTransactionalEmail({ send });

    await sendSignInCode(email, {
      to: " Operator@Example.com ",
      from: "auth@example.com",
      code: "123456",
    });

    expect(send).toHaveBeenCalledWith({
      to: "operator@example.com",
      from: "auth@example.com",
      subject: "Your Tracer sign-in code",
      text: "Your Tracer sign-in code is 123456. It expires in 5 minutes.",
      html: "<p>Your Tracer sign-in code is <strong>123456</strong>.</p><p>It expires in 5 minutes.</p>",
    });
  });

  it("sends access-created notices without an access secret", async () => {
    const send = vi.fn().mockResolvedValue({ messageId: "email-2" });
    const email = createCloudflareTransactionalEmail({ send });

    await sendAccessCreatedNotice(email, {
      to: " Operator@Example.com ",
      from: "auth@example.com",
      signInUrl: "https://tracer.example.com/sign-in",
    });

    const message = send.mock.calls[0][0];
    expect(message.to).toBe("operator@example.com");
    expect(message.text).toContain("https://tracer.example.com/sign-in");
    expect(message.html).toContain("https://tracer.example.com/sign-in");
    expect(`${message.text} ${message.html}`).not.toMatch(/\d{6}/);
  });

  it("enforces the configured recipient allowlist", () => {
    const recipients = new Set(["operator@example.com"]);
    expect(isAllowedRecipient(recipients, " OPERATOR@example.com ")).toBe(true);
    expect(isAllowedRecipient(recipients, "other@example.com")).toBe(false);
    expect(isAllowedRecipient(new Set(), "operator@example.com")).toBe(false);
  });
});
