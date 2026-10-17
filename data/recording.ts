/**
 * -------------------------------------------------------------------------
 * @file   recording.ts
 * @brief  Maps Twilio recording status callbacks to Recordings.
 *
 * @description
 *  Reads a Twilio recording status callback for a connected conversation or
 *  a voicemail and returns the Recording it produces. Only a completed
 *  recording produces one; an absent or failed recording produces none.
 *  Also declares the Recording processing port that hands a stored Recording
 *  to the background transfer workflow.
 *
 * @remarks
 *  The channel count comes from Twilio's RecordingChannels, so a connected
 *  conversation keeps separate Caller and Business channels only when Twilio
 *  actually provided them. Processing requests carry an idempotency key
 *  derived from the Recording id so a repeated request maps to one logical
 *  workflow run.
 *
 * @see
 *  data/inbound-calls.ts
 *  https://www.twilio.com/docs/voice/twiml/dial#recordingstatuscallback
 *  https://www.twilio.com/docs/voice/twiml/record#recordingstatuscallback
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
export type RecordingSource = "connected" | "voicemail";

export interface CompletedRecording {
  twilioRecordingSid: string;
  source: RecordingSource;
  channels: 1 | 2;
  durationSeconds: number | null;
}

export function completedRecording(source: RecordingSource, params: Readonly<Record<string, string>>): CompletedRecording | null {
  if (params.RecordingStatus !== "completed" || !params.RecordingSid) return null;
  const duration = Number.parseInt(params.RecordingDuration ?? "", 10);
  return {
    twilioRecordingSid: params.RecordingSid,
    source,
    channels: params.RecordingChannels === "2" ? 2 : 1,
    durationSeconds: Number.isFinite(duration) ? duration : null,
  };
}

export interface RecordingProcessingRequest {
  id: string;
  organizationId: string;
  idempotencyKey: string;
}

export interface RecordingProcessing {
  request(recording: RecordingProcessingRequest): Promise<void>;
}
