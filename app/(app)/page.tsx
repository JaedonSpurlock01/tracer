/**
 * -------------------------------------------------------------------------
 * @file   page.tsx
 * @brief  Renders the authenticated Tracer Home surface.
 *
 * @description
 *  Provides the initial shell landing page while operational dashboards are
 *  delivered by later milestones.
 *
 * @remarks
 *  Home stays compact until Workspaces receive Calls.
 *
 * @see
 *  DESIGN.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
export default function Home() {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-2xl font-semibold tracking-tight">Home</h1>
      <p className="text-sm text-muted-foreground">Operational dashboards arrive once Workspaces receive Calls.</p>
    </div>
  );
}
