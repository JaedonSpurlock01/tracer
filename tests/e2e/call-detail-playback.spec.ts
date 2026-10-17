/**
 * -------------------------------------------------------------------------
 * @file   call-detail-playback.spec.ts
 * @brief  Opens Call Detail from Recent Calls and plays it by keyboard.
 *
 * @description
 *  An Operator activates a recording Workspace through the fake Twilio
 *  boundary, a simulated Twilio lifecycle of signed voice, Forward Call,
 *  Recording, and status callbacks produces a Call, and the Recording is
 *  completed in local R2 the way the transfer and waveform tasks leave it.
 *  The Operator opens the Call from Workspace Overview Recent Calls and
 *  drives playback, seeking, and mute from the keyboard.
 *
 * @remarks
 *  Trigger.dev does not run in the browser suite, so the spec writes the
 *  WAV and its peaks to the local R2 bucket with Wrangler and marks the
 *  Recording Stored directly, matching what tests/integration covers for
 *  the tasks themselves.
 *
 * @see
 *  README.md
 *  tests/e2e/helpers.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";

import { expect, test, type APIRequestContext } from "@playwright/test";
import { Pool } from "pg";

import { signTwilioRequest } from "../../data/twilio-signature";
import { archiveActiveWorkspaces, ensureTwilioNumbers, signInAsOperator } from "./helpers";

const baseURL = "http://127.0.0.1:3000";
const databaseUrl = "postgresql://postgres:postgres@127.0.0.1:5433/tracer_e2e";
const authToken = "e2e-auth-token";
const durationSeconds = 10;
const sampleRate = 8000;

function stereoWav(): Buffer {
  const frames = durationSeconds * sampleRate;
  const data = Buffer.alloc(frames * 4);
  for (let frame = 0; frame < frames; frame += 1) {
    const time = frame / sampleRate;
    data.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 220 * time) * 8000), frame * 4);
    data.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 330 * time) * 8000), frame * 4 + 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(2, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 4, 28);
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

function peaksJson(): string {
  const points = durationSeconds * 50;
  const lane = (offset: number) => Array.from({ length: points }, (_, index) => Number((0.2 + 0.6 * Math.abs(Math.sin((index + offset) / 9))).toFixed(3)));
  return JSON.stringify({ version: 1, sampleRate, samplesPerPixel: sampleRate / 50, pixelsPerSecond: 50, durationSeconds, lanes: ["Caller", "Business"], peaks: [lane(0), lane(4)] });
}

function putLocalObject(key: string, file: string, contentType: string): void {
  execFileSync("corepack", ["pnpm", "exec", "wrangler", "r2", "object", "put", `tracer-recordings-test/${key}`, "--file", file, "--content-type", contentType, "--local", "--config", "wrangler.test.jsonc"], { stdio: "pipe" });
}

async function twilioCallback(request: APIRequestContext, path: string, params: Record<string, string>): Promise<void> {
  const url = `${baseURL}${path}`;
  const signature = await signTwilioRequest({ authToken, url, params });
  const response = await request.post(url, { form: params, headers: { "x-twilio-signature": signature } });
  expect(response.status(), path).toBeLessThan(300);
}

test("an Operator opens Call Detail from Recent Calls and controls playback by keyboard", async ({ page, request }, testInfo) => {
  test.setTimeout(150_000);
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await signInAsOperator(page, request);
    await ensureTwilioNumbers(page);
    await page.goto("/workspaces");
    await archiveActiveWorkspaces(page, "E2E");
    await page.reload();
    const workspaceName = `E2E Calls ${Date.now()}`;
    await page.getByRole("button", { name: "Create Workspace" }).first().click();
    await page.getByLabel("Workspace name").fill(workspaceName);
    await page.getByRole("button", { name: "Create Workspace" }).last().click();
    await page.getByRole("radio", { disabled: false }).first().check();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await page.getByLabel("Destination Number").fill("+14155550199");
    await page.getByRole("switch", { name: "Recording enabled" }).click();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await page.getByRole("button", { name: "Create and Activate" }).click();
    await expect(page.getByRole("status")).toHaveText(`${workspaceName} is Active.`);

    const assignment = (await pool.query<{ id: string; workspace_id: string; organization_id: string }>(
      `select a.id, a.workspace_id, a.organization_id from number_assignment a join workspace w on w.id = a.workspace_id where w.name = $1 and a.ended_at is null`,
      [workspaceName],
    )).rows[0];
    const callSid = `CA${createHash("sha256").update(workspaceName).digest("hex").slice(0, 32)}`;
    const recordingSid = `RE${createHash("sha256").update(`${workspaceName}:recording`).digest("hex").slice(0, 32)}`;
    const common = { AccountSid: `AC${"a".repeat(32)}` };
    await twilioCallback(request, `/api/twilio/voice/${assignment.id}`, { ...common, CallSid: callSid, From: "+13125550142", To: "+14155550100", CallStatus: "ringing", Direction: "inbound" });
    for (const CallStatus of ["initiated", "in-progress"]) {
      await twilioCallback(request, `/api/twilio/forward-status/${assignment.id}?node=forward`, { ...common, CallSid: `${callSid}child`, ParentCallSid: callSid, CallStatus });
    }
    await twilioCallback(request, `/api/twilio/forward-status/${assignment.id}?node=forward`, { ...common, CallSid: `${callSid}child`, ParentCallSid: callSid, CallStatus: "completed", CallDuration: String(durationSeconds) });
    await twilioCallback(request, `/api/twilio/recording-status/${assignment.id}?node=forward`, { ...common, CallSid: callSid, RecordingSid: recordingSid, RecordingStatus: "completed", RecordingDuration: String(durationSeconds), RecordingChannels: "2", RecordingSource: "DialVerb" });
    await twilioCallback(request, `/api/twilio/status/${assignment.id}`, { ...common, CallSid: callSid, CallStatus: "completed", CallDuration: String(durationSeconds + 6) });

    const recording = (await pool.query<{ id: string; call_id: string }>("select id, call_id from recording where twilio_recording_sid = $1", [recordingSid])).rows[0];
    const prefix = `organizations/${assignment.organization_id}/workspaces/${assignment.workspace_id}/calls/${recording.call_id}/recordings/${recording.id}`;
    const wav = stereoWav();
    const wavFile = testInfo.outputPath("recording.wav");
    const peaksFile = testInfo.outputPath("recording.peaks.json");
    writeFileSync(wavFile, wav);
    writeFileSync(peaksFile, peaksJson());
    putLocalObject(`${prefix}.wav`, wavFile, "audio/wav");
    putLocalObject(`${prefix}.peaks.json`, peaksFile, "application/json");
    await pool.query(
      `update recording
          set transfer_state = 'Stored', r2_object_key = $2, size_bytes = $3, sha256 = $4, stored_at = now(),
              waveform_state = 'Stored', waveform_object_key = $5, waveform_generated_at = now(), updated_at = now()
        where id = $1`,
      [recording.id, `${prefix}.wav`, wav.length, createHash("sha256").update(wav).digest("hex"), `${prefix}.peaks.json`],
    );

    await page.goto(`/workspaces/${assignment.workspace_id}`);
    const recentCalls = page.getByRole("list", { name: "Recent Calls" });
    await expect(recentCalls.getByRole("link")).toHaveCount(1);
    await recentCalls.getByRole("link", { name: /\+13125550142/ }).click();
    await expect(page).toHaveURL(new RegExp(`/workspaces/${assignment.workspace_id}/calls/${recording.call_id}$`));
    await expect(page.getByRole("heading", { level: 1, name: "+13125550142" })).toBeVisible();
    const waveform = page.getByRole("group", { name: "Waveform" });
    await expect(waveform.getByText("Caller")).toBeVisible();
    await expect(waveform.getByText("Business")).toBeVisible();
    await expect(waveform.locator("canvas").first()).toBeVisible();

    await waveform.focus();
    await page.keyboard.press("k");
    await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
    await page.keyboard.press("k");
    await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowRight");
    await expect(page.getByText("0:05 / 0:10")).toBeVisible();
    await page.keyboard.press("m");
    await expect(page.getByRole("button", { name: "Unmute" })).toBeVisible();
    const seek = page.getByRole("slider", { name: "Seek" });
    await seek.focus();
    await page.keyboard.press("End");
    await expect(seek).toHaveAttribute("aria-valuetext", "0:10 of 0:10");
  } finally {
    await pool.end();
  }
});
