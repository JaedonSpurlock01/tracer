/**
 * -------------------------------------------------------------------------
 * @file   report-csv.test.ts
 * @brief  Verifies the Calls CSV detail written for reports and Calls exports.
 *
 * @description
 *  Checks the header row, CRLF line endings, RFC 4180 quoting, neutralized
 *  spreadsheet formulas, start times in the report timezone with their UTC
 *  offset, durations in whole seconds, and the canonical availability and
 *  classification labels.
 *
 * @remarks
 *  Instants are non-round. America/New_York covers both sides of the
 *  2026-11-01 daylight saving change and Asia/Kolkata a half-hour offset.
 *
 * @see
 *  data/report-csv.ts
 *  DESIGN.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { describe, expect, it } from "vitest";

import { reportCsvHeader, reportCsvRows, type ReportCsvCall } from "@/data/report-csv";

const answered: ReportCsvCall = {
  id: "call-7f3a",
  workspaceName: "North Plumbing",
  trackingNumber: "+14155550113",
  callerNumber: "+12125550187",
  startedAt: new Date("2026-10-07T13:14:23.418Z"),
  state: "Completed",
  outcome: "Answered",
  totalDurationSeconds: 317,
  connectedDurationSeconds: 283,
  effectiveLeadClassification: { classification: "Good Lead", source: "review" },
  leadScore: 37,
  leadReview: true,
  recording: "Ready",
  transcript: "Available",
};

describe("Calls CSV detail", () => {
  it("starts with the header row and ends every line with CRLF", () => {
    expect(reportCsvRows([], "America/New_York")).toBe("");
    expect(reportCsvHeader()).toBe(
      "\uFEFFCall ID,Workspace,Tracking Number Dialed,Caller Number,Started At,Call Outcome,Total Duration Seconds,Connected Duration Seconds,Effective Lead Classification,AI Lead Score,Lead Review,Recording Availability,Transcript Availability\r\n",
    );
  });

  it("starts the file with a UTF-8 byte order mark so spreadsheets read non-ASCII names correctly", () => {
    const bytes = new TextEncoder().encode(reportCsvHeader() + reportCsvRows([{ ...answered, workspaceName: "Zürich Café" }], "UTC"));
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes.slice(3, 10))).toBe("Call ID");
    expect(new TextDecoder().decode(bytes)).toContain(",Zürich Café,");
  });

  it("writes each Call with its start time in the report timezone and its UTC offset, durations in seconds, and canonical labels", () => {
    const inProgress: ReportCsvCall = {
      ...answered,
      id: "call-9b21",
      startedAt: new Date("2026-11-02T02:41:09.907Z"),
      state: "In Progress",
      outcome: null,
      totalDurationSeconds: null,
      connectedDurationSeconds: null,
      effectiveLeadClassification: null,
      leadScore: null,
      leadReview: false,
      recording: "Unavailable",
      transcript: "Unavailable",
    };
    const lines = reportCsvRows([answered, inProgress], "America/New_York").split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[2]).toBe("");
    expect(lines[0].split(",").slice(0, 2)).toEqual(["call-7f3a", "North Plumbing"]);
    expect(lines[0].split(",").slice(4)).toEqual(["2026-10-07T09:14:23-04:00", "Answered", "317", "283", "Good Lead", "37", "Yes", "Ready", "Available"]);
    expect(lines[1].split(",").slice(4)).toEqual(["2026-11-01T21:41:09-05:00", "In Progress", "", "", "None", "", "No", "Unavailable", "Unavailable"]);
    expect(reportCsvRows([answered], "Asia/Kolkata").split(",")[4]).toBe("2026-10-07T18:44:23+05:30");
    expect(reportCsvRows([answered], "UTC").split(",")[4]).toBe("2026-10-07T13:14:23+00:00");
  });

  it("quotes a cell containing a comma, double quote, or line break and doubles its quotes", () => {
    const rows = reportCsvRows([{ ...answered, workspaceName: 'Smith, "Ace"\nPlumbing' }, { ...answered, workspaceName: "Line\rBreak" }], "UTC");
    expect(rows.startsWith('call-7f3a,"Smith, ""Ace""\nPlumbing",')).toBe(true);
    expect(rows).toContain('\r\ncall-7f3a,"Line\rBreak",');
  });

  it("prefixes a single quote to any cell that a spreadsheet would run as a formula", () => {
    const cellsFor = (workspaceName: string, callerNumber: string | null) => reportCsvRows([{ ...answered, workspaceName, callerNumber }], "UTC").split(",").slice(1, 4);
    expect(cellsFor("=HYPERLINK(1)", "+12125550187")).toEqual(["'=HYPERLINK(1)", "+14155550113", "+12125550187"]);
    expect(cellsFor("-2+3", "@SUM(A1)")).toEqual(["'-2+3", "+14155550113", "'@SUM(A1)"]);
    expect(cellsFor("\tTabbed", null)).toEqual(["'\tTabbed", "+14155550113", ""]);
    expect(reportCsvRows([{ ...answered, workspaceName: "\r=1" }], "UTC")).toContain(`,"'\r=1",`);
    expect(cellsFor("North = Plumbing", "2125550187")).toEqual(["North = Plumbing", "+14155550113", "2125550187"]);
  });

  it("leaves an exact E.164 number unprefixed but still prefixes plus-led values that are not one", () => {
    const cellsFor = (workspaceName: string, callerNumber: string | null) => reportCsvRows([{ ...answered, workspaceName, callerNumber }], "UTC").split(",").slice(1, 4);
    expect(cellsFor("North Plumbing", "+12125550187")).toEqual(["North Plumbing", "+14155550113", "+12125550187"]);
    expect(cellsFor("+1+1", "+=1")).toEqual(["'+1+1", "+14155550113", "'+=1"]);
    expect(cellsFor("+1234567890123456", "+")).toEqual(["'+1234567890123456", "+14155550113", "'+"]);
  });
});
