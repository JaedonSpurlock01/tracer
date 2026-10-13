/**
 * -------------------------------------------------------------------------
 * @file   separator.tsx
 * @brief  Provides the generated semantic separator primitive.
 *
 * @description
 *  Separates authentication provider actions without hand-rolled markup.
 *
 * @remarks
 *  The primitive uses the shared border token.
 *
 * @see
 *  app/sign-in/page.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
"use client"

import { Separator as SeparatorPrimitive } from "@base-ui/react/separator"
import { cn } from "cn"

function Separator({
  className,
  orientation = "horizontal",
  ...props
}: SeparatorPrimitive.Props) {
  return (
    <SeparatorPrimitive
      data-slot="separator"
      orientation={orientation}
      className={cn(
        "shrink-0 bg-border data-horizontal:h-px data-horizontal:w-full data-vertical:w-px data-vertical:self-stretch",
        className
      )}
      {...props}
    />
  )
}

export { Separator }
