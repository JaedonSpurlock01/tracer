/**
 * -------------------------------------------------------------------------
 * @file   trigger.config.ts
 * @brief  Configures Tracer's Trigger.dev Cloud project.
 *
 * @description
 *  Points the Trigger.dev CLI at Tracer's project and task directory, sets
 *  the default run duration limit and retry policy for every task, and adds
 *  the audiowaveform and ffmpeg CLIs to the deployed task image.
 *
 * @remarks
 *  Retries back off exponentially with jitter so a transient Twilio, R2, or
 *  database failure is retried without hammering the provider. The pg
 *  driver stays external so its optional native binding is not bundled.
 *  The Audio Waveform and ffmpeg extensions install their CLIs only in
 *  deployed images, so the local Dev runner needs audiowaveform and ffmpeg
 *  installed on its PATH. The report PDF renderer and React stay external
 *  because pdfkit loads its standard font metrics through package subpath
 *  imports that a bundle cannot resolve, and React must be the copy the
 *  renderer imports. The Additional Files extension copies the embedded
 *  Geist TTFs to the same relative path in the image, where the renderer
 *  reads them.
 *
 * @see
 *  trigger/recording-transfer.ts
 *  trigger/recording-recovery.ts
 *  trigger/recording-waveform.ts
 *  trigger/recording-mp3.ts
 *  data/report-fonts.ts
 *  https://trigger.dev/docs/config/config-file
 *  https://trigger.dev/docs/config/extensions/audioWaveform
 *  https://trigger.dev/docs/config/extensions/ffmpeg
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { audioWaveform } from "@trigger.dev/build/extensions/audioWaveform";
import { additionalFiles, ffmpeg } from "@trigger.dev/build/extensions/core";
import { defineConfig } from "@trigger.dev/sdk";

import { reportFontPaths } from "./data/report-fonts";

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
    external: ["pg", "@react-pdf/renderer", "react"],
    extensions: [audioWaveform(), ffmpeg(), additionalFiles({ files: Object.values(reportFontPaths).map((file) => `./${file}`) })],
  },
});
