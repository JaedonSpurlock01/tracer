/**
 * -------------------------------------------------------------------------
 * @file   page.tsx
 * @brief  Renders the authenticated Reports placeholder.
 *
 * @description
 *  Reserves the Reports surface until Workspace analytics are available.
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

export default function ReportsPage() {
  return <PagePlaceholder title="Reports" description="On-demand reports arrive with Workspace analytics." />;
}
