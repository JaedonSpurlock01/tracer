/**
 * -------------------------------------------------------------------------
 * @file   page.tsx
 * @brief  Sends the retired Activity address to Calls.
 *
 * @description
 *  Activity was folded into Calls, which refreshes while the tab is visible
 *  and sorts newest first by default. A bookmark or old link to `/activity`
 *  lands on Calls.
 *
 * @remarks
 *  The redirect carries no parameters and reads no data, so Calls applies
 *  the actor's readable Workspace scope exactly as it does for any visit.
 *
 * @see
 *  app/(app)/(everyone)/calls/page.tsx
 *  docs/IMPLEMENTATION_ROADMAP.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { redirect } from "next/navigation";

export default function ActivityPage() {
  redirect("/calls");
}
