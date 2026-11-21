/**
 * -------------------------------------------------------------------------
 * @file   loading.tsx
 * @brief  Shows the Forms page's shape while it loads.
 *
 * @description
 *  Re-exports the Forms loading state so a navigation paints the page's
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
export { FormsLoading as default } from "@/components/tracer/page-loading";
