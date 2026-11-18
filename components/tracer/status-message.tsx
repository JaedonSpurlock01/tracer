/**
 * -------------------------------------------------------------------------
 * @file   status-message.tsx
 * @brief  Shows the one-line confirmation after a save or other action.
 *
 * @description
 *  useStatusMessage holds the confirmation text with a counter that grows on
 *  every call, and StatusMessage renders it as a live status line keyed by
 *  that counter. Each call mounts a fresh line that plays the short
 *  `.status-reveal` entrance, so saving twice with the same message still
 *  visibly confirms the second save.
 *
 * @remarks
 *  A plain string state ignores a repeated message, which left a second save
 *  with no visible feedback. The setter keeps the `(message: string) => void`
 *  shape of a state setter, so callers and `onMessage` props are unchanged.
 *
 * @see
 *  app/globals.css
 *  DESIGN.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
"use client";

import { cn } from "cn";
import { useCallback, useState } from "react";

export type StatusMessageState = { text: string; key: number };

export function useStatusMessage() {
  const [status, setStatus] = useState<StatusMessageState>({ text: "", key: 0 });
  const announce = useCallback((text: string) => setStatus((current) => ({ text, key: current.key + 1 })), []);
  return [status, announce] as const;
}

export function StatusMessage({ status, className }: { status: StatusMessageState; className?: string }) {
  if (!status.text) return null;
  return (
    <p key={status.key} role="status" className={cn("status-reveal", className)}>
      {status.text}
    </p>
  );
}
