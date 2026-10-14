/**
 * -------------------------------------------------------------------------
 * @file   page-placeholder.tsx
 * @brief  Renders guarded placeholder pages for deferred capabilities.
 *
 * @description
 *  Provides the shared page header and Frame state used before later
 *  milestones deliver each operational surface.
 *
 * @remarks
 *  Placeholder pages remain visible only after the authenticated shell guard.
 *
 * @see
 *  DESIGN.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { Frame, FramePanel } from "@/components/reui/frame";

interface PagePlaceholderProps {
  title: string;
  description: string;
}

export function PagePlaceholder({ title, description }: PagePlaceholderProps) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <Frame>
        <FramePanel>
          <p className="text-sm text-muted-foreground">Available in a later milestone.</p>
        </FramePanel>
      </Frame>
    </div>
  );
}
