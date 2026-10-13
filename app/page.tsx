/**
 * -------------------------------------------------------------------------
 * @file   page.tsx
 * @brief  Renders the Tracer application skeleton.
 *
 * @description
 *  Provides a minimal branded root page for Local and Preview verification.
 *
 * @remarks
 *  Product navigation and behavior remain deferred to later milestones.
 *
 * @see
 *  docs/IMPLEMENTATION_ROADMAP.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { Badge } from "@/components/reui/badge";

export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Tracer</h1>
        <Badge variant="outline">Application skeleton</Badge>
      </div>
    </main>
  );
}
