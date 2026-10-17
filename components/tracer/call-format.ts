/**
 * -------------------------------------------------------------------------
 * @file   call-format.ts
 * @brief  Formats Call times and durations for display.
 *
 * @description
 *  Turns seconds into `m:ss` or `h:mm:ss` clock text for durations and the
 *  player, and timestamps into dates in the Workspace reporting timezone.
 *
 * @remarks
 *  Times use the Workspace reporting timezone so every viewer reads the
 *  same Call time regardless of their browser.
 *
 * @see
 *  components/tracer/call-detail-view.tsx
 *  components/tracer/recording-player.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
export function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = String(whole % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

export function formatCallTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "medium", timeZone }).format(new Date(iso));
}

export function formatCallDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone }).format(new Date(iso));
}

export function formatTimeOfDay(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeStyle: "medium", timeZone }).format(new Date(iso));
}
