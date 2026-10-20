/**
 * -------------------------------------------------------------------------
 * @file   auth-pages.test.tsx
 * @brief  Verifies authentication and settings page interactions.
 *
 * @description
 *  Covers generic sign-in responses, OTP controls, authenticated settings
 *  loading, independent saves, role mapping, provider state, and revocation.
 *
 * @remarks
 *  Network calls are faked only at the public HTTP boundary.
 *
 * @see
 *  app/account/settings/page.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.sessionStorage.clear();
  router.push.mockReset();
});

import AccountSettingsPage from "@/app/(app)/account/settings/page";
import SignInPage from "@/app/sign-in/page";
import VerifyEmailPage from "@/app/verify-email/page";

function response(value: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(value), { status }));
}

describe("authentication pages", () => {
  it("offers email-code sign-in without a Google action", () => {
    render(<SignInPage />);
    expect(screen.getByRole("button", { name: "Send sign-in code" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Continue with Google" })).not.toBeInTheDocument();
  });

  it("stores pending email and navigates generically after a server error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("server error")));
    render(<SignInPage />);
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: " Operator@Example.com " } });
    fireEvent.click(screen.getByRole("button", { name: "Send sign-in code" }));

    expect(await screen.findByRole("status")).toHaveTextContent("If this identity is eligible");
    expect(window.sessionStorage.getItem("tracer.pending-email")).toBe("operator@example.com");
    expect(router.push).toHaveBeenCalledWith("/verify-email");
  });

  it("renders the generic description on the server while the pending email is only read in the browser", () => {
    window.sessionStorage.setItem("tracer.pending-email", "operator@example.com");
    expect(renderToString(<VerifyEmailPage />)).toContain("your email address");
    render(<VerifyEmailPage />);
    expect(screen.getByText(/o\*+@example\.com/)).toBeInTheDocument();
  });

  it("submits pasted six-digit OTP input, resends without form submission, and clears Change Email", async () => {
    window.sessionStorage.setItem("tracer.pending-email", "operator@example.com");
    const fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("send-verification")) return response({ success: true });
      return response({ token: "session-token", user: {} });
    });
    vi.stubGlobal("fetch", fetch);
    render(<VerifyEmailPage />);

    const codeInput = screen.getByLabelText("Verification code");
    fireEvent.change(codeInput, { target: { value: "123456" } });
    expect(screen.getByRole("button", { name: "Verify" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Resend" }));
    expect(screen.getByRole("button", { name: /Resend in/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      "/api/auth/sign-in/email-otp",
      expect.objectContaining({ body: JSON.stringify({ email: "operator@example.com", otp: "123456" }) }),
    ));

    fireEvent.click(screen.getByRole("button", { name: "Change email" }));
    expect(window.sessionStorage.getItem("tracer.pending-email")).toBeNull();
    expect(router.push).toHaveBeenCalledWith("/sign-in");
  });

  it("redirects unauthenticated users without rendering settings data", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(null)));
    render(<AccountSettingsPage />);
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/sign-in"));
    expect(screen.queryByText("Profile")).not.toBeInTheDocument();
  });

  it("rejects an invalid timezone without sending an update request", async () => {
    const fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("get-session")) return response({ user: { id: "user-1", name: "Example Operator", email: "operator@example.com", state: "Active", timezone: "America/Chicago" }, session: { token: "current-token" } });
      if (url.includes("get-full-organization")) return response({ members: [{ user: { id: "user-1" }, role: "owner" }] });
      if (url.includes("list-accounts")) return response([]);
      if (url.includes("list-sessions")) return response([{ id: "current", token: "current-token", expiresAt: new Date().toISOString() }]);
      return response({});
    });
    vi.stubGlobal("fetch", fetch);
    render(<AccountSettingsPage />);
    await screen.findByDisplayValue("Operator");
    fireEvent.click(screen.getByRole("button", { name: "Preferences" }));
    fireEvent.change(screen.getByLabelText("Timezone"), { target: { value: "not-a-timezone" } });
    fireEvent.click(screen.getByRole("button", { name: "Save preferences" }));
    expect(await screen.findByText("Enter a valid IANA timezone.")).toBeVisible();
    expect(fetch).not.toHaveBeenCalledWith("/api/auth/update-user", expect.anything());
  });

  it("confirms current-session revocation with its token and redirects to Sign in", async () => {
    const fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("get-session")) return response({ user: { id: "user-1", name: "Example Operator", email: "operator@example.com", state: "Active", timezone: "America/Chicago" }, session: { token: "current-token" } });
      if (url.includes("get-full-organization")) return response({ members: [{ user: { id: "user-1" }, role: "owner" }] });
      if (url.includes("list-accounts")) return response([]);
      if (url.includes("list-sessions")) return response([{ id: "current", token: "current-token", expiresAt: new Date().toISOString() }]);
      return response({});
    });
    vi.stubGlobal("fetch", fetch);
    render(<AccountSettingsPage />);
    await screen.findByDisplayValue("Operator");
    fireEvent.click(screen.getByRole("button", { name: "Security" }));
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    fireEvent.click(screen.getByRole("button", { name: "Revoke session" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      "/api/auth/revoke-session",
      expect.objectContaining({ body: JSON.stringify({ token: "current-token" }) }),
    ));
    expect(router.push).toHaveBeenCalledWith("/sign-in");
  });

  it("maps persisted membership role while saving profile and preferences separately", async () => {
    const fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("get-session")) return response({ user: { id: "user-1", name: "Example Operator", email: "operator@example.com", state: "Active", timezone: "America/Chicago" }, session: { token: "current-token" } });
      if (url.includes("get-full-organization")) return response({ members: [{ user: { id: "user-1" }, role: "member" }] });
      if (url.includes("list-sessions")) return response([{ id: "current", token: "current-token", expiresAt: new Date().toISOString() }, { id: "other", token: "other-token", userAgent: "Other browser", expiresAt: new Date().toISOString() }]);
      return response({ user: {} });
    });
    vi.stubGlobal("fetch", fetch);
    render(<AccountSettingsPage />);

    expect(await screen.findByDisplayValue("Client Viewer")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Security" }));
    fireEvent.click(screen.getByRole("button", { name: "Profile" }));
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Updated Name" } });
    expect(screen.getAllByRole("radio")).toHaveLength(12);
    expect(screen.getByRole("radio", { name: "Avatar 1" })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Shuffle" }));
    expect(screen.getByRole("radio", { name: "Avatar 1" })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: "Avatar 3" }));
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      "/api/auth/update-user",
      expect.objectContaining({ body: expect.stringMatching(/^\{"name":"Updated Name","image":"dicebear:gaze:[a-z0-9]{10}"\}$/) }),
    ));
    fireEvent.click(screen.getByRole("button", { name: "Preferences" }));
    fireEvent.change(screen.getByLabelText("Timezone"), { target: { value: "America/New_York" } });
    fireEvent.click(screen.getByRole("button", { name: "Save preferences" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      "/api/auth/update-user",
      expect.objectContaining({ body: JSON.stringify({ timezone: "America/New_York" }) }),
    ));
    fireEvent.click(screen.getByRole("button", { name: "Security" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Revoke" })[1]);
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      "/api/auth/revoke-session",
      expect.objectContaining({ body: JSON.stringify({ token: "other-token" }) }),
    ));
  });
});
