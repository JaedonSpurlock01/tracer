/**
 * -------------------------------------------------------------------------
 * @file   trigger.config.ts
 * @brief  Configures Tracer's Trigger.dev Cloud project.
 *
 * @description
 *  Points the Trigger.dev CLI at Tracer's project and task directory, sets
 *  the default run duration limit and retry policy for every task, and adds
 *  the audiowaveform CLI to the deployed task image.
 *
 * @remarks
 *  Retries back off exponentially with jitter so a transient Twilio, R2, or
 *  database failure is retried without hammering the provider. The pg
 *  driver stays external so its optional native binding is not bundled.
 *  The Audio Waveform extension installs audiowaveform only in deployed
 *  images, so the local Dev runner needs it installed on its PATH.
 *
 * @see
 *  trigger/recording-transfer.ts
 *  trigger/recording-recovery.ts
 *  trigger/recording-waveform.ts
 *  https://trigger.dev/docs/config/config-file
 *  https://trigger.dev/docs/config/extensions/audioWaveform
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { audioWaveform } from "@trigger.dev/build/extensions/audioWaveform";
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
    extensions: [audioWaveform()],
  },
});
