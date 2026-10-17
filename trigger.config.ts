/**
 * -------------------------------------------------------------------------
 * @file   trigger.config.ts
 * @brief  Configures Tracer's Trigger.dev Cloud project.
 *
 * @description
 *  Points the Trigger.dev CLI at Tracer's project and task directory and
 *  sets the default run duration limit and retry policy for every task.
 *
 * @remarks
 *  Retries back off exponentially with jitter so a transient Twilio, R2, or
 *  database failure is retried without hammering the provider. The pg
 *  driver stays external so its optional native binding is not bundled.
 *
 * @see
 *  trigger/recording-transfer.ts
 *  trigger/recording-recovery.ts
 *  https://trigger.dev/docs/config/config-file
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { defineConfig } from "@trigger.dev/sdk";

export default defineConfig({
  project: "proj_tdulgcojxncuxbsettnq",
  dirs: ["./trigger"],
  maxDuration: 300,
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 5,
      factor: 2,
      minTimeoutInMs: 5_000,
      maxTimeoutInMs: 300_000,
      randomize: true,
    },
  },
  build: {
    external: ["pg"],
  },
});
