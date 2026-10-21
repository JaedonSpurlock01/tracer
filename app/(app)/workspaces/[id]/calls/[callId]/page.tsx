/**
 * -------------------------------------------------------------------------
 * @file   page.tsx
 * @brief  Renders the guarded Call Detail route.
 *
 * @description
 *  Resolves one Call in a Workspace the actor may read and renders its
 *  header, Recording player, Transcript, Lead Review, Lead Assessment,
 *  Call facts, and processing timeline, with Operator-only actions for
 *  Operators. The `play=1` query flag, sent by the Calls Play Recording
 *  action, starts the Recording player on open. The `back` param names the
 *  Calls list the Call was opened from; Call Detail links back to it and
 *  steps through its previous and next Call, or, without a valid one, links
 *  back to Workspace Calls and walks the Workspace's Calls Started
 *  descending.
 *
 * @remarks
 *  The Call Detail read model authorizes the Workspace through the central
 *  Workspace authorization, so an ungranted Workspace, another Workspace's
 *  path, another Organization, and a missing Call all render Not Found.
 *  The `back` param is validated on the server before any link uses it,
 *  and the neighbors read applies the same readable Workspace condition as
 *  the Calls list, so it never names a Call the actor cannot read.
 *
 * @see
 *  data/call-details.ts
 *  components/tracer/call-detail-view.tsx
 *  data/call-source.ts
 *  data/calls.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { notFound } from "next/navigation";

import { resolveRequestActor } from "@/app/(app)/actor";
import CallDetailView from "@/components/tracer/call-detail-view";
import { demoCallDetail, demoNeighbors } from "@/components/tracer/prototype/call-detail-fixture";
import CallDetailPrototype from "@/components/tracer/prototype/call-detail-prototype";
import { createCallDetails } from "@/data/call-details";
import { callDetailNavigation, callSourceFromBack, callSourceListQuery } from "@/data/call-source";
import { createCallList } from "@/data/calls";
import { withTracerRuntime } from "@/data/tracer-runtime";
import { canManageWorkspaces } from "@/data/workspace-authorization";

export default async function CallDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; callId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await resolveRequestActor();
  if (actor?.state !== "Active") notFound();
  const { id, callId } = await params;
  const query = await searchParams;
  const source = callSourceFromBack(query.back, id);
  // PROTOTYPE: ?demo=1 renders the Call Detail fixture instead of a Call.
  const demo = query.demo === "1" && process.env.NODE_ENV !== "production";
  const data = demo
    ? { call: demoCallDetail(id), neighbors: demoNeighbors(id) }
    : await withTracerRuntime(async ({ pool }) => {
        const call = await createCallDetails(pool, actor).find(id, callId);
        if (!call) return null;
        return { call, neighbors: await createCallList(pool, actor).neighbors(callSourceListQuery(source, id), callId) };
      });
  if (!data) notFound();
  const operator = canManageWorkspaces(actor);
  const autoPlay = query.play === "1";
  const navigation = callDetailNavigation(source, id, data.neighbors);
  return (
    <CallDetailPrototype call={data.call} operator={operator} autoPlay={autoPlay} navigation={navigation} demo={demo}>
      <CallDetailView call={data.call} operator={operator} autoPlay={autoPlay} navigation={navigation} />
    </CallDetailPrototype>
  );
}
