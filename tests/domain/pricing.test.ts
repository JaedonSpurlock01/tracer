/**
 * -------------------------------------------------------------------------
 * @file   pricing.test.ts
 * @brief  Verifies the maintained rate table and the pure cost arithmetic.
 *
 * @description
 *  Checks the named rates, billed minutes rounded up per Call, the
 *  Telephony and Processing arithmetic in cents, the worked two-hour Call
 *  the Pricing guide shows, projected revenue for Monthly, Weekly, and
 *  Per Lead Deals, the yearly projection, and dollar formatting.
 *
 * @see
 *  data/pricing.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { describe, expect, it } from "vitest";

import {
  billedMinutes,
  formatUsd,
  formatUsdCents,
  pricingCheckedOn,
  pricingGuide,
  processingFallbackUsd,
  projectedMonthlyRevenueCents,
  rates,
  telephonyCents,
  workedTwoHourCall,
  yearlyCents,
} from "@/data/pricing";

describe("rate table", () => {
  it("keeps every rate in one place with the date it was last checked", () => {
    expect(rates).toEqual({
      twilioNumberMonthlyUsd: 1.15,
      twilioInboundPerMinuteUsd: 0.0085,
      twilioOutboundForwardPerMinuteUsd: 0.014,
      twilioRecordingPerMinuteUsd: 0.0025,
      workersPaidMonthlyUsd: 5,
      r2StoragePerGbMonthUsd: 0.015,
      dataforseoPerLookupUsd: 0.002,
      openaiWhisperPerMinuteUsd: 0.006,
      openaiGpt5MiniInputPerMillionTokensUsd: 0.25,
      openaiGpt5MiniOutputPerMillionTokensUsd: 2,
    });
    expect(pricingCheckedOn).toBe("2026-10-20");
    expect(pricingGuide.map((entry) => entry.key)).toEqual(Object.keys(rates));
    for (const entry of pricingGuide) {
      expect(entry.label).not.toBe("");
      expect(entry.unit).not.toBe("");
      expect(entry.explanation).not.toBe("");
      expect(entry.rate).toBe(rates[entry.key]);
    }
  });

  it("bills Twilio minutes rounded up per Call and treats missing durations as zero", () => {
    expect(billedMinutes(null)).toBe(0);
    expect(billedMinutes(0)).toBe(0);
    expect(billedMinutes(1)).toBe(1);
    expect(billedMinutes(60)).toBe(1);
    expect(billedMinutes(61)).toBe(2);
    expect(billedMinutes(7200)).toBe(120);
  });

  it("prices Telephony in cents from prorated rental and billed minutes", () => {
    expect(telephonyCents({ rentalDays: 31, daysInMonth: 31, inboundMinutes: 0, forwardedMinutes: 0, recordingMinutes: 0 })).toBe(115);
    expect(telephonyCents({ rentalDays: 15, daysInMonth: 30, inboundMinutes: 0, forwardedMinutes: 0, recordingMinutes: 0 })).toBe(58);
    expect(telephonyCents({ rentalDays: 0, daysInMonth: 30, inboundMinutes: 120, forwardedMinutes: 120, recordingMinutes: 120 })).toBe(300);
  });

  it("falls back to the token and minute rates only when no cost was stored", () => {
    expect(processingFallbackUsd({ transcriptAudioMs: 7_200_000, inputTokens: 1_000_000, outputTokens: 500_000 })).toBeCloseTo(0.72 + 0.25 + 1, 6);
    expect(processingFallbackUsd({ transcriptAudioMs: null, inputTokens: null, outputTokens: null })).toBe(0);
  });

  it("documents the worked two-hour Call the Pricing guide shows", () => {
    const example = workedTwoHourCall();
    expect(example.seconds).toBe(7200);
    expect(example.lines.map((line) => [line.label, line.usd])).toEqual([
      ["Inbound minutes, 120 at $0.0085", 1.02],
      ["Forwarded minutes, 120 at $0.014", 1.68],
      ["Recording minutes, 120 at $0.0025", 0.3],
      ["Transcription, 240 channel minutes at $0.006", 1.44],
      ["Lead Assessment, 6,000 input and 400 output tokens", 0.0023],
    ]);
    expect(example.totalUsd).toBeCloseTo(4.4423, 6);
    expect(example.totalCents).toBe(444);
  });

  it("projects monthly revenue per Deal kind and the yearly figure", () => {
    expect(projectedMonthlyRevenueCents({ kind: "Monthly", amountCents: 50_000 }, 9)).toBe(50_000);
    expect(projectedMonthlyRevenueCents({ kind: "Weekly", amountCents: 10_000 }, 9)).toBe(43_333);
    expect(projectedMonthlyRevenueCents({ kind: "Per Lead", amountCents: 2_500 }, 9)).toBe(22_500);
    expect(projectedMonthlyRevenueCents({ kind: "Per Lead", amountCents: 2_500 }, 0)).toBe(0);
    expect(projectedMonthlyRevenueCents(null, 9)).toBe(0);
    expect(yearlyCents(444)).toBe(5_328);
  });

  it("formats cents as dollars with a sign and sub-cent amounts precisely", () => {
    expect(formatUsdCents(444)).toBe("$4.44");
    expect(formatUsdCents(-1_250)).toBe("-$12.50");
    expect(formatUsdCents(0)).toBe("$0.00");
    expect(formatUsdCents(123_456_789)).toBe("$1,234,567.89");
    expect(formatUsd(0.0023)).toBe("$0.0023");
    expect(formatUsd(1.02)).toBe("$1.02");
  });
});
