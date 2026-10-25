/**
 * -------------------------------------------------------------------------
 * @file   loading.tsx
 * @brief  Loading boundary for the Operator-only global pages.
 *
 * @description
 *  Re-exports the shared skeleton so this route group paints at once while
 *  its page streams in. The group's layout has already answered 404 for anyone who is not an Operator.
 *
 * @see
 *  components/tracer/page-loading.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
export { PageLoading as default } from "@/components/tracer/page-loading";
