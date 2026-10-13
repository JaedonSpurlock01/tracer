/**
 * -------------------------------------------------------------------------
 * @file   page.tsx
 * @brief  Renders Tracer's email-code verification surface.
 *
 * @description
 *  Reads the normalized pending identity from sessionStorage, masks its
 *  destination, and handles verification, resend cooldown, and return flow.
 *
 * @remarks
 *  Verification never receives an email address through the URL.
 *
 * @see
 *  app/sign-in/page.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
"use client";

import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from "@/components/ui/input-otp";

const pendingEmailKey = "tracer.pending-email";
const genericMessage = "We could not verify that code.";

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) {
    return "your email address";
  }
  return `${local.slice(0, 1)}${"*".repeat(Math.max(1, local.length - 1))}@${domain}`;
}

export default function VerifyEmailPage() {
  const router = useRouter();
  const [email] = useState(() =>
    typeof window === "undefined" ? "" : window.sessionStorage.getItem(pendingEmailKey) ?? "",
  );
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (!cooldown) return;
    const timer = window.setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/sign-in/email-otp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, otp: code }),
      });
      if (!response.ok) throw new Error(genericMessage);
      window.sessionStorage.removeItem(pendingEmailKey);
      router.push("/account/settings");
    } catch {
      setError(genericMessage);
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    if (!email || cooldown) return;
    setStatus("A new code is on its way.");
    setCooldown(30);
    await fetch("/api/auth/email-otp/send-verification-otp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, type: "sign-in" }),
    }).catch(() => undefined);
  }

  function changeEmail() {
    window.sessionStorage.removeItem(pendingEmailKey);
    router.push("/sign-in");
  }

  return (
    <main className="flex min-h-screen items-center justify-center gap-6 px-6 py-12">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Verify email</CardTitle>
          <CardDescription>
            Enter the 6-digit code sent to {email ? maskEmail(email) : "your email address"}.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <form className="flex flex-col gap-5" onSubmit={verify}>
            <Field data-invalid={Boolean(error)}>
              <div className="flex items-center justify-between gap-3">
                <FieldLabel htmlFor="otp-verification">Verification code</FieldLabel>
                <Button type="button" variant="outline" size="xs" onClick={resend} disabled={Boolean(cooldown) || !email}>
                  {cooldown ? `Resend in ${cooldown}s` : "Resend"}
                </Button>
              </div>
              <InputOTP
                id="otp-verification"
                maxLength={6}
                value={code}
                onChange={(value) => setCode(value.replace(/\D/g, ""))}
                required
                aria-invalid={Boolean(error)}
              >
                <InputOTPGroup>
                  <InputOTPSlot index={0} aria-invalid={Boolean(error)} />
                  <InputOTPSlot index={1} aria-invalid={Boolean(error)} />
                  <InputOTPSlot index={2} aria-invalid={Boolean(error)} />
                </InputOTPGroup>
                <InputOTPSeparator />
                <InputOTPGroup>
                  <InputOTPSlot index={3} aria-invalid={Boolean(error)} />
                  <InputOTPSlot index={4} aria-invalid={Boolean(error)} />
                  <InputOTPSlot index={5} aria-invalid={Boolean(error)} />
                </InputOTPGroup>
              </InputOTP>
              {error ? <FieldError>{error}</FieldError> : null}
            </Field>
            <Button type="submit" className="w-full" disabled={busy || code.length !== 6 || !email}>
              {busy ? "Verifying..." : "Verify"}
            </Button>
            {status ? <p className="text-sm text-muted-foreground" role="status">{status}</p> : null}
          </form>
          <Button type="button" variant="link" className="self-start px-0" onClick={changeEmail}>
            Change email
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
