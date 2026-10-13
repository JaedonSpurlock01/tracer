/**
 * -------------------------------------------------------------------------
 * @file   open-next.config.ts
 * @brief  Configures OpenNext for Cloudflare Workers.
 *
 * @description
 *  Defines the adapter settings used to transform the Next.js build output.
 *
 * @remarks
 *  M1 does not require an incremental cache binding.
 *
 * @see
 *  docs/adr/0001-use-opennext-for-cloudflare-workers.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig();
