/**
 * -------------------------------------------------------------------------
 * @file   recording-lead-assessment.ts
 * @brief  Registers the Recording Lead Assessment task with Trigger.dev.
 *
 * @description
 *  Builds the database and OpenAI dependencies from environment variables
 *  and assesses one Recording's Completed Transcript into an immutable Lead
 *  Assessment.
 *
 * @remarks
 *  Registration stays thin so the assessment behavior is tested as an
 *  ordinary function. The transcription task requests this task through
 *  the REST API with a Recording-derived idempotency key. The concurrency
 *  limit bounds load on OpenAI. An OpenAI rejection a retry cannot fix
 *  aborts the run after the Lead Assessment is persisted Failed, so it does
 *  not spend the remaining attempts.
 *
 * @see
 *  data/recording-lead-assessment.ts
 *  data/openai-client.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { AbortTaskRunError, task } from "@trigger.dev/sdk";

import { createOpenAIClient, OpenAIError } from "@/data/openai-client";
import { assessRecordingLead } from "@/data/recording-lead-assessment";
import { recordingLeadAssessmentTaskId } from "@/data/recording-processing";
import { requiredEnvironment, taskDatabase } from "@/trigger/environment";

export const recordingLeadAssessment = task({
  id: recordingLeadAssessmentTaskId,
  concurrency: { total: 5 },
  run: async (payload: { recordingId: string }) => {
    const database = taskDatabase();
    try {
      await assessRecordingLead({ database, responder: createOpenAIClient({ apiKey: requiredEnvironment("OPENAI_API_KEY") }), now: () => new Date() }, payload.recordingId);
    } catch (error) {
      if (error instanceof OpenAIError && !error.retryable) throw new AbortTaskRunError(error.message);
      throw error;
    } finally {
      await database.close();
    }
  },
});
