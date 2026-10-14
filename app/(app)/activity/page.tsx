/**
 * -------------------------------------------------------------------------
 * @file   page.tsx
 * @brief  Renders the authenticated Activity placeholder.
 *
 * @description
 *  Reserves the Activity surface until Call event delivery is implemented.
 *
 * @remarks
 *  The shell protects this page before the placeholder renders.
 *
 * @see
 *  components/tracer/page-placeholder.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { PagePlaceholder } from "@/components/tracer/page-placeholder";

export default function ActivityPage() {
  return <PagePlaceholder title="Activity" description="Call events appear after the first inbound Call." />;
}
