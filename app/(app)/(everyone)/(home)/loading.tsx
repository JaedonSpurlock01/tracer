/**
 * -------------------------------------------------------------------------
 * @file   loading.tsx
 * @brief  Shows the Home page's shape while it loads.
 *
 * @description
 *  Re-exports the Home loading state so a navigation paints the page's
 *  header and panels at once while its data streams in.
 *
 * @remarks
 *  Home sits in its own route group so this boundary covers Home alone. The layouts above it have already answered 404 for anyone who cannot open the page.
 *
 * @see
 *  components/tracer/page-loading.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
export { HomeLoading as default } from "@/components/tracer/page-loading";
