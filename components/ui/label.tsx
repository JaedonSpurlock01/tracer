/**
 * -------------------------------------------------------------------------
 * @file   label.tsx
 * @brief  Provides the generated accessible form label primitive.
 *
 * @description
 *  Renders semantic labels used by Tracer Field compositions.
 *
 * @remarks
 *  Shared labels preserve consistent field focus and disabled states.
 *
 * @see
 *  components/ui/field.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
"use client"

import * as React from "react"
import { cn } from "cn"

function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Label }
