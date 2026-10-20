/**
 * -------------------------------------------------------------------------
 * @file   empty-state.tsx
 * @brief  Renders one action-oriented Empty state.
 *
 * @description
 *  Stacks optional line art, a short title, an explanatory description,
 *  and an optional action, centered inside whatever region is empty: a
 *  FramePanel, a Data Grid body, or a timeline.
 *
 * @remarks
 *  The description is one paragraph so tests and screen readers find the
 *  explanatory sentence as a single text node. The art is decorative.
 *
 * @see
 *  components/tracer/line-art.tsx
 *  DESIGN.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import type { ComponentProps, ReactNode } from "react";

import { cn } from "cn";

interface EmptyStateProps extends Omit<ComponentProps<"div">, "title"> {
  art?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ art, title, description, action, className, ...props }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center gap-4 py-8 text-center", className)} {...props}>
      {art}
      <div className="flex max-w-sm flex-col gap-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}
