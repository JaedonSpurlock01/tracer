/**
 * -------------------------------------------------------------------------
 * @file   e2e-auth-fake.ts
 * @brief  Stores the explicit end-to-end authentication email fake state.
 *
 * @description
 *  Captures the latest test-only OTP in memory when the E2E flag is enabled.
 *
 * @remarks
 *  Production callers cannot read this value because the endpoint gate also
 *  requires the explicit E2E flag and a non-production environment.
 *
 * @see
 *  tests/e2e/provisioned-email-code-sign-in.spec.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
let lastOtp: string | null = null;

export function rememberE2eOtp(text: string): void {
  const code = text.match(/\b\d{6}\b/)?.[0];
  lastOtp = code ?? null;
}

export function readE2eOtp(): string | null {
  return lastOtp;
}
