/**
 * -------------------------------------------------------------------------
 * @file   page.tsx
 * @brief  Renders Tracer's passwordless sign-in surface.
 *
 * @description
 *  Provides email-code entry without exposing identity admission results or
 *  placing an email address in the URL.
 *
 * @remarks
 *  The pending normalized email is kept only in sessionStorage for verification.
 *
 * @see
 *  DESIGN.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
"use client";

import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { normalizeIdentityEmail } from "@/data/auth-policy";

const pendingEmailKey = "tracer.pending-email";
const genericMessage = "If this identity is eligible, a sign-in code has been sent.";

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function requestCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = normalizeIdentityEmail(email);
    setError("");
    setMessage("");
    if (!normalized) {
      setError("Enter your email address.");
      return;
    }

    setBusy(true);
    try {
      await fetch("/api/auth/email-otp/send-verification-otp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: normalized, type: "sign-in" }),
      });
    } catch {
      setMessage(genericMessage);
    } finally {
      window.sessionStorage.setItem(pendingEmailKey, normalized);
      setMessage(genericMessage);
      setBusy(false);
      router.push("/verify-email");
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center gap-6 px-6 py-12">
      <Card className="auth-card-reveal w-full max-w-sm">
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>Enter your email to receive a sign-in code.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <form className="flex flex-col gap-4" action="/verify-email" onSubmit={requestCode}>
            <Field data-invalid={Boolean(error)}>
              <FieldLabel htmlFor="email">Email address</FieldLabel>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                aria-invalid={Boolean(error)}
              />
              {error ? <FieldError>{error}</FieldError> : null}
            </Field>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Sending..." : "Send sign-in code"}
            </Button>
          </form>
          <FieldDescription>Use a provisioned Spurlock Labs identity.</FieldDescription>
          {message ? <p className="text-sm text-muted-foreground" role="status">{message}</p> : null}
        </CardContent>
      </Card>
    </main>
  );
}
