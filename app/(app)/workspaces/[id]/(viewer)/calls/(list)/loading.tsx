/**
 * -------------------------------------------------------------------------
 * @file   loading.tsx
 * @brief  Shows the Workspace Calls page's shape while it loads.
 *
 * @description
 *  Re-exports the Workspace Calls loading state so a navigation paints the page's
 *  header and panels at once while its data streams in.
 *
 * @remarks
 *  The list sits in its own route group so this boundary never stands in for Call Detail beneath calls/. The layouts above it have already answered 404 for anyone who cannot open the page.
 *
 * @see
 *  components/tracer/page-loading.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
export { CallsLoading as default } from "@/components/tracer/page-loading";
