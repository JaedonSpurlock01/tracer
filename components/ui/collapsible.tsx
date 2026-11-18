/**
 * -------------------------------------------------------------------------
 * @file   collapsible.tsx
 * @brief  Provides collapsible primitives for sections that open and close.
 *
 * @description
 *  Wraps the Base UI Collapsible. The content panel grows and shrinks between
 *  zero and its measured height over 200ms instead of snapping, so an opening
 *  section reads as the same region expanding. Viewers who prefer reduced
 *  motion get a fade with no height change.
 *
 * @remarks
 *  Base UI measures the panel into `--collapsible-panel-height` and marks the
 *  first and last frames with `data-starting-style` and `data-ending-style`.
 *  The panel clips its overflow so content does not spill while the height
 *  changes; put padding and borders on an inner element so the closed panel
 *  is truly zero tall and focus rings have room.
 *
 * @see
 *  components/tracer/activity-view.tsx
 *  components/tracer/call-detail-view.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
"use client"

import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible"
import { cn } from "cn"

function Collapsible({ ...props }: CollapsiblePrimitive.Root.Props) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />
}

function CollapsibleTrigger({ ...props }: CollapsiblePrimitive.Trigger.Props) {
  return (
    <CollapsiblePrimitive.Trigger data-slot="collapsible-trigger" {...props} />
  )
}

function CollapsibleContent({ className, ...props }: CollapsiblePrimitive.Panel.Props) {
  return (
    <CollapsiblePrimitive.Panel
      data-slot="collapsible-content"
      className={cn(
        "h-(--collapsible-panel-height) overflow-hidden transition-[height,opacity] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] data-starting-style:h-0 data-starting-style:opacity-0 data-ending-style:h-0 data-ending-style:opacity-0 motion-reduce:transition-opacity",
        className
      )}
      {...props}
    />
  )
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent }
