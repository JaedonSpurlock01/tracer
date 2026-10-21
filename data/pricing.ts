/**
 * -------------------------------------------------------------------------
 * @file   pricing.ts
 * @brief  Holds the maintained provider rate table and the pure cost arithmetic.
 *
 * @description
 *  Every price Tracer uses to project a Workspace's cost lives here as a
 *  named rate: Twilio number rental, inbound, forwarded, and recording
 *  minutes, Workers Paid, R2 storage, DataForSEO lookups, whisper-1
 *  minutes, and gpt-5-mini tokens. The file also prices Telephony in
 *  cents from prorated rental and billed minutes, falls back to the
 *  per-minute and per-token rates for a usage row without a stored cost,
 *  projects a Deal's monthly and yearly revenue, formats dollars, and
 *  builds the worked two-hour Call the Pricing guide shows.
 *
 * @remarks
 *  Prices are maintained by hand, not read from provider billing APIs,
 *  and were last checked against the published Twilio, Cloudflare,
 *  DataForSEO, and OpenAI price pages on 2026-10-20 (pricingCheckedOn).
 *  Twilio bills each Call leg per started minute, so minutes round up per
 *  Call. Money is carried as integer cents and each category rounds once,
 *  so totals add up on screen. A stored usage cost wins over the fallback
 *  because the task that stored it priced the exact tokens it was billed.
 *
 * @see
 *  data/cost-revenue.ts
 *  data/transcript.ts
 *  data/lead-assessment.ts
 *  https://www.twilio.com/en-us/voice/pricing/us
 *  https://developers.cloudflare.com/workers/platform/pricing/
 *  https://openai.com/api/pricing/
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
export const pricingCheckedOn = "2026-10-20";

export const rates = {
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
} as const;

export type RateKey = keyof typeof rates;

export interface PricingGuideEntry {
  key: RateKey;
  label: string;
  rate: number;
  unit: string;
  explanation: string;
}

export const pricingGuide: PricingGuideEntry[] = [
  { key: "twilioNumberMonthlyUsd", label: "Tracking Number rental", rate: rates.twilioNumberMonthlyUsd, unit: "per number per month", explanation: "Twilio charges each imported local number monthly. Tracer prorates it by the days the Number Assignment was active in the month." },
  { key: "twilioInboundPerMinuteUsd", label: "Inbound minutes", rate: rates.twilioInboundPerMinuteUsd, unit: "per minute", explanation: "Every Call to the Tracking Number is billed per started minute from the moment Twilio answers, prompts and ringing included." },
  { key: "twilioOutboundForwardPerMinuteUsd", label: "Forwarded minutes", rate: rates.twilioOutboundForwardPerMinuteUsd, unit: "per minute", explanation: "The leg to the Destination Number is an outbound Call billed per started connected minute." },
  { key: "twilioRecordingPerMinuteUsd", label: "Recording minutes", rate: rates.twilioRecordingPerMinuteUsd, unit: "per minute", explanation: "Twilio records the connected conversation per started minute; the dual-channel Recording counts once." },
  { key: "workersPaidMonthlyUsd", label: "Workers Paid", rate: rates.workersPaidMonthlyUsd, unit: "per month, shared", explanation: "One Cloudflare Workers Paid plan hosts Tracer and every Site. Its cost is split evenly across Active Workspaces." },
  { key: "r2StoragePerGbMonthUsd", label: "R2 storage", rate: rates.r2StoragePerGbMonthUsd, unit: "per GB per month, shared", explanation: "Stored Recording WAV and MP3 bytes across the Organization, split evenly across Active Workspaces like Workers Paid." },
  { key: "dataforseoPerLookupUsd", label: "Rank lookups", rate: rates.dataforseoPerLookupUsd, unit: "per lookup", explanation: "The daily rank check runs one DataForSEO lookup per Keyword of the linked Site." },
  { key: "openaiWhisperPerMinuteUsd", label: "Transcription", rate: rates.openaiWhisperPerMinuteUsd, unit: "per channel minute", explanation: "whisper-1 transcribes the Caller and Business channels separately, so a connected Recording bills twice its length. The cost stored with each Transcript is used when present." },
  { key: "openaiGpt5MiniInputPerMillionTokensUsd", label: "Lead Assessment input", rate: rates.openaiGpt5MiniInputPerMillionTokensUsd, unit: "per million tokens", explanation: "gpt-5-mini reads the Transcript and the fixed prompt. The cost stored with each Lead Assessment is used when present." },
  { key: "openaiGpt5MiniOutputPerMillionTokensUsd", label: "Lead Assessment output", rate: rates.openaiGpt5MiniOutputPerMillionTokensUsd, unit: "per million tokens", explanation: "The structured classification, summary, rationale, and evidence the model writes back." },
];

export type DealKind = "Monthly" | "Weekly" | "Per Lead";

export const dealKinds: readonly DealKind[] = ["Monthly", "Weekly", "Per Lead"];

export function usdToCents(usd: number): number {
  return Math.round(Math.round(usd * 1_000_000) / 10_000);
}

export function billedMinutes(seconds: number | null): number {
  if (seconds === null || seconds <= 0) return 0;
  return Math.ceil(seconds / 60);
}

export interface TelephonyUsage {
  rentalDays: number;
  daysInMonth: number;
  inboundMinutes: number;
  forwardedMinutes: number;
  recordingMinutes: number;
}

export function telephonyCents(usage: TelephonyUsage): number {
  const rental = usage.daysInMonth > 0 ? (rates.twilioNumberMonthlyUsd * Math.min(usage.rentalDays, usage.daysInMonth)) / usage.daysInMonth : 0;
  const minutes =
    usage.inboundMinutes * rates.twilioInboundPerMinuteUsd +
    usage.forwardedMinutes * rates.twilioOutboundForwardPerMinuteUsd +
    usage.recordingMinutes * rates.twilioRecordingPerMinuteUsd;
  return usdToCents(rental + minutes);
}

export function processingFallbackUsd(usage: { transcriptAudioMs: number | null; inputTokens: number | null; outputTokens: number | null }): number {
  const transcription = ((usage.transcriptAudioMs ?? 0) / 60_000) * rates.openaiWhisperPerMinuteUsd;
  const assessment = ((usage.inputTokens ?? 0) * rates.openaiGpt5MiniInputPerMillionTokensUsd + (usage.outputTokens ?? 0) * rates.openaiGpt5MiniOutputPerMillionTokensUsd) / 1_000_000;
  return transcription + assessment;
}

export function projectedMonthlyRevenueCents(deal: { kind: DealKind; amountCents: number } | null, goodLeads: number): number {
  if (!deal) return 0;
  if (deal.kind === "Monthly") return deal.amountCents;
  if (deal.kind === "Weekly") return Math.round((deal.amountCents * 52) / 12);
  return deal.amountCents * goodLeads;
}

export function yearlyCents(monthlyCents: number): number {
  return monthlyCents * 12;
}

const dollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const preciseDollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 });

export function formatUsdCents(cents: number): string {
  return dollars.format(cents / 100);
}

export function formatUsd(usd: number): string {
  return preciseDollars.format(usd);
}

export interface WorkedCallLine {
  label: string;
  usd: number;
}

export interface WorkedCallExample {
  seconds: number;
  lines: WorkedCallLine[];
  totalUsd: number;
  totalCents: number;
}

const exampleInputTokens = 6_000;
const exampleOutputTokens = 400;

export function workedTwoHourCall(): WorkedCallExample {
  const seconds = 7200;
  const minutes = billedMinutes(seconds);
  const channelMinutes = minutes * 2;
  const assessmentUsd = processingFallbackUsd({ transcriptAudioMs: null, inputTokens: exampleInputTokens, outputTokens: exampleOutputTokens });
  const lines: WorkedCallLine[] = [
    { label: `Inbound minutes, ${minutes} at $${rates.twilioInboundPerMinuteUsd}`, usd: minutes * rates.twilioInboundPerMinuteUsd },
    { label: `Forwarded minutes, ${minutes} at $${rates.twilioOutboundForwardPerMinuteUsd}`, usd: minutes * rates.twilioOutboundForwardPerMinuteUsd },
    { label: `Recording minutes, ${minutes} at $${rates.twilioRecordingPerMinuteUsd}`, usd: minutes * rates.twilioRecordingPerMinuteUsd },
    { label: `Transcription, ${channelMinutes} channel minutes at $${rates.openaiWhisperPerMinuteUsd}`, usd: channelMinutes * rates.openaiWhisperPerMinuteUsd },
    { label: `Lead Assessment, ${exampleInputTokens.toLocaleString("en-US")} input and ${exampleOutputTokens} output tokens`, usd: assessmentUsd },
  ];
  const totalUsd = lines.reduce((total, line) => total + line.usd, 0);
  return { seconds, lines: lines.map((line) => ({ label: line.label, usd: Math.round(line.usd * 10_000) / 10_000 })), totalUsd, totalCents: usdToCents(totalUsd) };
}
