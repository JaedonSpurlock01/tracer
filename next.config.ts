/**
 * -------------------------------------------------------------------------
 * @file   next.config.ts
 * @brief  Configures the Tracer Next.js application.
 *
 * @description
 *  Enables local Next.js development with the Cloudflare adapter available.
 *
 * @remarks
 *  OpenNext performs the production Worker adaptation during its build step.
 *
 * @see
 *  docs/adr/0001-use-opennext-for-cloudflare-workers.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import type { NextConfig } from "next";

initOpenNextCloudflareForDev();

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  outputFileTracingIncludes: {
    "**/*": ["./node_modules/pg-cloudflare/dist/**", "./node_modules/pg-cloudflare/esm/**"],
  },
};

export default nextConfig;
