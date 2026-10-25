/**
 * -------------------------------------------------------------------------
 * @file   loading.tsx
 * @brief  Loading boundary for the pages every Active user can open.
 *
 * @description
 *  Re-exports the shared skeleton so this route group paints at once while
 *  its page streams in. The group has no authorization of its own beyond the signed-in shell.
 *
 * @see
 *  components/tracer/page-loading.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
export { PageLoading as default } from "@/components/tracer/page-loading";
