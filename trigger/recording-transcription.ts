/**
 * -------------------------------------------------------------------------
 * @file   recording-transcription.ts
 * @brief  Registers the Recording transcription task with Trigger.dev.
 *
 * @description
 *  Builds the database, R2, OpenAI, and Lead Assessment request
 *  dependencies from environment variables and transcribes one
 *  analysis-eligible Stored Recording into a normalized Transcript.
 *
 * @remarks
 *  Registration stays thin so the transcription behavior is tested as an
 *  ordinary function. The transfer task and the recovery sweep request this
 *  task through the REST API with a Recording-derived idempotency key, and
 *  it requests the Lead Assessment the same way so both share one key. The
 *  concurrency limit bounds load on OpenAI and R2. The longer maximum
 *  duration covers a 3-hour dual-channel Recording transcribed as eighteen
 *  sequential 20-minute chunks, and the small-2x machine's 1 GB of memory
 *  holds that Recording's roughly 345 MB WAV and its mono chunks. An OpenAI
 *  rejection a retry cannot fix aborts the run after the Transcript is
 *  persisted Failed, so it does not spend the remaining attempts.
 *
 * @see
 *  data/recording-transcription.ts
 *  data/openai-client.ts
 *  trigger.config.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { AbortTaskRunError, task } from "@trigger.dev/sdk";

import { createOpenAIClient, OpenAIError } from "@/data/openai-client";
import { createR2RecordingObjects } from "@/data/r2-objects";
import { createTriggerRecordingProcessing, recordingLeadAssessmentTaskId, recordingTranscriptionTaskId } from "@/data/recording-processing";
import { transcribeRecording } from "@/data/recording-transcription";
import { requiredEnvironment, taskDatabase } from "@/trigger/environment";

export const recordingTranscription = task({
  id: recordingTranscriptionTaskId,
  concurrency: { total: 5 },
  machine: "small-2x",
  maxDuration: 3600,
  run: async (payload: { recordingId: string }) => {
    const database = taskDatabase();
    try {
      await transcribeRecording(
        {
          database,
          objects: createR2RecordingObjects({
            accountId: requiredEnvironment("R2_ACCOUNT_ID"),
            accessKeyId: requiredEnvironment("R2_ACCESS_KEY_ID"),
            secretAccessKey: requiredEnvironment("R2_SECRET_ACCESS_KEY"),
            bucket: requiredEnvironment("R2_BUCKET"),
          }),
          transcriber: createOpenAIClient({ apiKey: requiredEnvironment("OPENAI_API_KEY") }),
          leadAssessment: createTriggerRecordingProcessing({
            secretKey: process.env.TRIGGER_SECRET_KEY,
            baseUrl: process.env.TRIGGER_API_URL,
            taskId: recordingLeadAssessmentTaskId,
          }),
          now: () => new Date(),
        },
        payload.recordingId,
      );
    } catch (error) {
      if (error instanceof OpenAIError && !error.retryable) throw new AbortTaskRunError(error.message);
      throw error;
    } finally {
      await database.close();
    }
  },
});
