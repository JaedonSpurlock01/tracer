/**
 * -------------------------------------------------------------------------
 * @file   call-format.ts
 * @brief  Formats Call times and durations for display.
 *
 * @description
 *  Turns seconds into `m:ss` or `h:mm:ss` clock text for durations and the
 *  player, and timestamps into dates in the Workspace reporting timezone.
 *
 *  formatShortTime is the compact form lists and feeds show: a time of day
 *  for today, a short date otherwise.
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

function calendarDay(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/**
 * The compact timestamp for lists and feeds: a time of day for a moment on
 * the current day in the given timezone, a short date for an earlier day in
 * the same year, and a date with its year otherwise. Pair it with
 * formatCallTime as the hover title so the full moment stays available.
 */
export function formatShortTime(iso: string, timeZone: string, now: Date = new Date()): string {
  const moment = new Date(iso);
  const day = calendarDay(moment, timeZone);
  const today = calendarDay(now, timeZone);
  if (day === today) return new Intl.DateTimeFormat("en-US", { timeStyle: "short", timeZone }).format(moment);
  const sameYear = day.slice(0, 4) === today.slice(0, 4);
  return new Intl.DateTimeFormat("en-US", sameYear ? { month: "short", day: "numeric", timeZone } : { dateStyle: "medium", timeZone }).format(moment);
}
