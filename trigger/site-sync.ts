/**
 * -------------------------------------------------------------------------
 * @file   site-sync.ts
 * @brief  Schedules the hourly Site sync with Trigger.dev.
 *
 * @description
 *  Every hour at minute 17, discovers the Sites of every connected
 *  Cloudflare account, records their deployments, per-day traffic, and an
 *  uptime check, captures a preview when the live deployment changed or
 *  the newest preview is older than a day, and returns how many Sites
 *  were seen, synced, and failed.
 *
 * @remarks
 *  Registration stays thin so the sync is tested as an ordinary function.
 *  The minute is offset from the other sweeps. Previews go to R2 through
 *  the same bucket-scoped token as the Recording workflows, and the
 *  Cloudflare token is decrypted with the same credential master key as
 *  Twilio, so no new secret is needed.
 *
 * @see
 *  data/site-sync.ts
 *  trigger/media-retention.ts
 *  https://trigger.dev/docs/tasks/scheduled
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { schedules } from "@trigger.dev/sdk";

import { createCloudflareClient } from "@/data/cloudflare-client";
import { createR2RecordingObjects } from "@/data/r2-objects";
import { sitePreviewObjectsFromArtifacts } from "@/data/site-preview";
import { syncSites } from "@/data/site-sync";
import { requiredEnvironment, taskPool } from "@/trigger/environment";

export const siteSync = schedules.task({
  id: "site-sync",
  cron: "17 * * * *",
  run: async (payload) => {
    const pool = taskPool();
    try {
      return await syncSites({
        pool,
        cloudflare: createCloudflareClient(),
        objects: sitePreviewObjectsFromArtifacts(createR2RecordingObjects({
          accountId: requiredEnvironment("R2_ACCOUNT_ID"),
          accessKeyId: requiredEnvironment("R2_ACCESS_KEY_ID"),
          secretAccessKey: requiredEnvironment("R2_SECRET_ACCESS_KEY"),
          bucket: requiredEnvironment("R2_BUCKET"),
        })),
        masterKey: requiredEnvironment("TWILIO_CREDENTIAL_MASTER_KEY"),
        now: payload.timestamp,
      });
    } finally {
      await pool.end();
    }
  },
});
