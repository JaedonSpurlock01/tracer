/**
 * -------------------------------------------------------------------------
 * @file   rank-check.ts
 * @brief  Schedules the daily Keyword rank check with Trigger.dev.
 *
 * @description
 *  Every day at 06:41 UTC, looks up each live Keyword of every linked
 *  Site with a Service Area on DataForSEO, stores the position and top
 *  results, and returns how many Sites and Keywords were seen and how
 *  many lookups succeeded or failed.
 *
 * @remarks
 *  Registration stays thin so the check is tested as an ordinary
 *  function. The minute is offset from the other sweeps. The DataForSEO
 *  password is decrypted with the same credential master key as Twilio
 *  and Cloudflare, so no new secret is needed.
 *
 * @see
 *  data/rank-check.ts
 *  trigger/site-sync.ts
 *  https://trigger.dev/docs/tasks/scheduled
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { schedules } from "@trigger.dev/sdk";

import { createDataForSeoClient } from "@/data/dataforseo-client";
import { checkRankings } from "@/data/rank-check";
import { requiredEnvironment, taskPool } from "@/trigger/environment";

export const rankCheck = schedules.task({
  id: "rank-check",
  cron: "41 6 * * *",
  run: async (payload) => {
    const pool = taskPool();
    try {
      return await checkRankings({
        pool,
        dataforseo: createDataForSeoClient(),
        masterKey: requiredEnvironment("TWILIO_CREDENTIAL_MASTER_KEY"),
        now: payload.timestamp,
      });
    } finally {
      await pool.end();
    }
  },
});
