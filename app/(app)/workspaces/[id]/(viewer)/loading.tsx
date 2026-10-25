/**
 * -------------------------------------------------------------------------
 * @file   loading.tsx
 * @brief  Loading boundary for the Workspace pages every reader can open.
 *
 * @description
 *  Re-exports the shared skeleton so this route group paints at once while
 *  its page streams in. The Workspace layout has already answered 404 for a Workspace the actor cannot read.
 *
 * @see
 *  components/tracer/page-loading.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
export { WorkspaceLoading as default } from "@/components/tracer/page-loading";
