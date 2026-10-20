/**
 * -------------------------------------------------------------------------
 * @file   report-csv.ts
 * @brief  Writes the Calls CSV detail for reports and Calls exports.
 *
 * @description
 *  Writes one header row and one row per Call with the DESIGN CSV columns:
 *  the Call id, Workspace name, Tracking Number dialed, caller number,
 *  start time in the report timezone as ISO 8601 with its UTC offset, Call
 *  Outcome or In Progress, total and connected duration in whole seconds,
 *  effective Lead classification or None, AI Lead Score, whether a Lead
 *  Review exists as Yes or No, Recording availability, and Transcript
 *  availability. A missing value is an empty cell. A Recording ZIP manifest
 *  has the same columns plus the Recording file's path inside the archive
 *  and its Recording export outcome: Included, or why it was omitted, as
 *  Purged, Expired, No Recording, Processing, Failed, or Missing when its MP3 is
 *  gone from storage.
 *
 * @remarks
 *  The header starts with a UTF-8 byte order mark so Excel decodes
 *  non-ASCII Workspace names. Lines follow RFC 4180 and end in CRLF, and a cell containing a comma,
 *  double quote, CR, or LF is quoted with its quotes doubled. Caller numbers
 *  and Workspace names reach spreadsheets, so a cell starting with =, +, -,
 *  @, tab, or CR is prefixed with a single quote to keep it from running as
 *  a formula, except an exact E.164 number such as a caller or Tracking
 *  Number, which a spreadsheet reads as a plain value. The start time drops
 *  milliseconds. This module has no server imports.
 *
 * @see
 *  data/report-generation.ts
 *  data/analytics-range.ts
 *  DESIGN.md
 *  https://www.rfc-editor.org/rfc/rfc4180
 *  https://owasp.org/www-community/attacks/CSV_Injection
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { timeZoneOffsetMs } from "@/data/analytics-range";
import type { CallDetail, RecordingAvailability } from "@/data/call-details";
import type { OutcomeKind } from "@/data/call-flow";
import type { EffectiveLeadClassification } from "@/data/lead-classification";

export type TranscriptAvailability = "Available" | "Pending" | "Failed" | "Skipped" | "Purged" | "Expired" | "Unavailable";

export interface ReportCsvCall {
  id: string;
  workspaceName: string;
  trackingNumber: string;
  callerNumber: string | null;
  startedAt: Date;
  state: CallDetail["state"];
  outcome: OutcomeKind | null;
  totalDurationSeconds: number | null;
  connectedDurationSeconds: number | null;
  effectiveLeadClassification: EffectiveLeadClassification;
  leadScore: number | null;
  leadReview: boolean;
  recording: RecordingAvailability["state"];
  transcript: TranscriptAvailability;
}

export type RecordingExportOutcome = "Included" | "Purged" | "Expired" | "No Recording" | "Processing" | "Failed" | "Missing";

export interface ReportManifestCall extends ReportCsvCall {
  recordingFile: string | null;
  recordingExport: RecordingExportOutcome;
}

const columns = [
  "Call ID",
  "Workspace",
  "Tracking Number Dialed",
  "Caller Number",
  "Started At",
  "Call Outcome",
  "Total Duration Seconds",
  "Connected Duration Seconds",
  "Effective Lead Classification",
  "AI Lead Score",
  "Lead Review",
  "Recording Availability",
  "Transcript Availability",
];

function cell(raw: string): string {
  const value = /^[=+\-@\t\r]/.test(raw) && !/^\+\d{1,15}$/.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function line(cells: readonly string[]): string {
  return `${cells.map(cell).join(",")}\r\n`;
}

export function reportCsvHeader(): string {
  return `\uFEFF${line(columns)}`;
}

export function isoInTimeZone(instant: Date, timeZone: string): string {
  const seconds = Math.floor(instant.getTime() / 1000) * 1000;
  const offsetMinutes = Math.round(timeZoneOffsetMs(seconds, timeZone) / 60_000);
  const local = new Date(seconds + offsetMinutes * 60_000).toISOString().slice(0, 19);
  const magnitude = Math.abs(offsetMinutes);
  const offset = `${offsetMinutes < 0 ? "-" : "+"}${String(Math.floor(magnitude / 60)).padStart(2, "0")}:${String(magnitude % 60).padStart(2, "0")}`;
  return `${local}${offset}`;
}

function optional(value: number | string | null): string {
  return value === null ? "" : String(value);
}

function callCells(call: ReportCsvCall, timeZone: string): string[] {
  return [
    call.id,
    call.workspaceName,
    call.trackingNumber,
    optional(call.callerNumber),
    isoInTimeZone(call.startedAt, timeZone),
    call.state === "In Progress" ? "In Progress" : optional(call.outcome),
    optional(call.totalDurationSeconds),
    optional(call.connectedDurationSeconds),
    call.effectiveLeadClassification?.classification ?? "None",
    optional(call.leadScore),
    call.leadReview ? "Yes" : "No",
    call.recording,
    call.transcript,
  ];
}

export function reportCsvRows(calls: readonly ReportCsvCall[], timeZone: string): string {
  return calls.map((call) => line(callCells(call, timeZone))).join("");
}

export function reportManifestHeader(): string {
  return `\uFEFF${line([...columns, "Recording File", "Recording Export"])}`;
}

export function reportManifestRows(calls: readonly ReportManifestCall[], timeZone: string): string {
  return calls.map((call) => line([...callCells(call, timeZone), optional(call.recordingFile), call.recordingExport])).join("");
}
