/**
 * -------------------------------------------------------------------------
 * @file   loading.tsx
 * @brief  Shows the Site page's shape while it loads.
 *
 * @description
 *  Re-exports the Site loading state so a navigation paints the page's
 *  header and panels at once while its data streams in.
 *
 * @remarks
 *  The layouts above it have already answered 404 for anyone who cannot open the page.
 *
 * @see
 *  components/tracer/page-loading.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
export { SiteLoading as default } from "@/components/tracer/page-loading";
