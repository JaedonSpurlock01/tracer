"use client";

/**
 * -------------------------------------------------------------------------
 * @file   error.tsx
 * @brief  Shows the failure page when a page inside the app shell fails to load.
 *
 * @description
 *  Catches a server render error below this segment and renders the
 *  shared RequestFailed page with its Retry action, so a database that
 *  did not answer shows as a named, retryable state instead of a blank
 *  page.
 *
 * @see
 *  components/tracer/request-failed.tsx
 *  node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import RequestFailed, { type RequestFailedProps } from "@/components/tracer/request-failed";

export default function RequestError(props: RequestFailedProps) {
  return <RequestFailed {...props} />;
}
