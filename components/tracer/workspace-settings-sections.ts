/**
 * -------------------------------------------------------------------------
 * @file   workspace-settings-sections.ts
 * @brief  Lists the Workspace Settings section pages.
 *
 * @description
 *  Defines each Workspace Settings section's route slug and rail label in
 *  rail order.
 *
 * @remarks
 *  This list lives outside the client settings view because a server page
 *  cannot read plain values exported from a "use client" module; it receives
 *  a client reference instead of the array.
 *
 * @see
 *  components/tracer/workspace-settings-view.tsx
 *  app/(app)/workspaces/[id]/settings/[section]/page.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
export type WorkspaceSettingsSection = "general" | "site" | "number" | "recording" | "access" | "danger";

export const workspaceSettingsSections: ReadonlyArray<{ slug: WorkspaceSettingsSection; label: string }> = [
  { slug: "general", label: "General" },
  { slug: "site", label: "Site" },
  { slug: "number", label: "Number" },
  { slug: "recording", label: "Recording and AI" },
  { slug: "access", label: "Access" },
  { slug: "danger", label: "Danger" },
];
