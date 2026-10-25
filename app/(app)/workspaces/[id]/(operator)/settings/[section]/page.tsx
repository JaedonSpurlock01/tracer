/**
 * -------------------------------------------------------------------------
 * @file   page.tsx
 * @brief  Renders one guarded Workspace Settings section page.
 *
 * @description
 *  Restricts Workspace settings to Active Operators, resolves a scoped
 *  Workspace, and renders the requested section behind the settings rail.
 *
 * @remarks
 *  Unknown section names return Not Found. Settings remain separate from
 *  provider integration mutation. The Access section's users and the Site
 *  section's linked Site with its Service Area, Keywords, and Domain
 *  renewal, the Workspace's Business and open Deal, and the Forms section's Forwarding
 *  Recipients load on the server with the Workspace so the
 *  page renders without a loading Skeleton.
 *
 * @see
 *  components/tracer/workspace-settings-view.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { notFound } from "next/navigation";

import { resolveRequestActor } from "@/app/(app)/actor";
import { workspaceSettingsSections } from "@/components/tracer/workspace-settings-sections";
import WorkspaceSettingsView from "@/components/tracer/workspace-settings-view";
import { isActiveOperatorActor } from "@/data/authorization";
import { createBusinesses } from "@/data/business";
import { createDeals } from "@/data/deals";
import { createFormSubmissions } from "@/data/form-submissions";
import { createOperatorAdministration } from "@/data/operator-administration";
import { createSiteKeywords } from "@/data/site-keywords";
import { createSites, siteResponseForActor } from "@/data/sites";
import { createWorkspaces } from "@/data/workspaces";
import { withRequestRuntime } from "@/app/(app)/runtime";

export default async function WorkspaceSettingsSectionPage({ params }: { params: Promise<{ id: string; section: string }> }) {
  const actor = await resolveRequestActor();
  if (!isActiveOperatorActor(actor)) notFound();
  const { id, section } = await params;
  const match = workspaceSettingsSections.find((item) => item.slug === section);
  if (!match) notFound();
  const data = await withRequestRuntime(async ({ database, pool, email }) => {
    const workspace = await createWorkspaces(database, actor.organizationId).find(id);
    const accessUsers = workspace && match.slug === "access" ? await createOperatorAdministration(pool, actor.organizationId).list() : undefined;
    const site = workspace && match.slug === "site" ? await createSites(pool, actor).findLinked(workspace.id) : null;
    const keywords = site ? await createSiteKeywords(pool, actor).list(site.id).catch(() => null) : null;
    const deal = workspace && match.slug === "site" ? await createDeals(pool, actor).current(workspace.id).catch(() => null) : undefined;
    const business = workspace && match.slug === "site" ? await createBusinesses(pool, actor).find(workspace.id).catch(() => null) : undefined;
    const forms = workspace && match.slug === "forms" ? await createFormSubmissions(pool, actor, email).list(workspace.id).catch(() => null) : undefined;
    return { workspace, accessUsers, site: site ? siteResponseForActor(actor, site) : null, keywords, deal, business, forms };
  });
  if (!data.workspace) notFound();
  return <WorkspaceSettingsView initialWorkspace={data.workspace} section={match.slug} initialAccessUsers={data.accessUsers} initialSite={data.site} initialKeywords={data.keywords} initialDeal={data.deal} initialBusiness={data.business} initialForms={data.forms} />;
}
