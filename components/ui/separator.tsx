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
        "shrink-0 bg-border data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:w-px data-[orientation=vertical]:self-stretch",
        className
      )}
      {...props}
    />
  )
}

export { Separator }
