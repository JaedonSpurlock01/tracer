/**
 * -------------------------------------------------------------------------
 * @file   page.tsx
 * @brief  Renders the guarded Call Detail route.
 *
 * @description
 *  Resolves one Call in a Workspace the actor may read and renders its
 *  header, Recording player, Call facts, and processing timeline.
 *
 * @remarks
 *  The Call Detail read model authorizes the Workspace through the central
 *  Workspace authorization, so an ungranted Workspace, another Workspace's
 *  path, another Organization, and a missing Call all render Not Found.
 *
 * @see
 *  data/call-details.ts
 *  components/tracer/call-detail-view.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { notFound } from "next/navigation";

import { resolveRequestActor } from "@/app/(app)/actor";
import CallDetailView from "@/components/tracer/call-detail-view";
import { createCallDetails } from "@/data/call-details";
import { withTracerRuntime } from "@/data/tracer-runtime";

export default async function CallDetailPage({ params }: { params: Promise<{ id: string; callId: string }> }) {
  const actor = await resolveRequestActor();
  if (actor?.state !== "Active") notFound();
  const { id, callId } = await params;
  const call = await withTracerRuntime(({ pool }) => createCallDetails(pool, actor).find(id, callId));
  if (!call) notFound();
  return <CallDetailView call={call} />;
}
