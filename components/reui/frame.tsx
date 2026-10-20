/**
 * -------------------------------------------------------------------------
 * @file   frame.tsx
 * @brief  Provides the ReUI Frame-led page composition, flattened.
 *
 * @description
 *  Exposes Frame, panel, header, title, description, and footer primitives.
 *  A Frame is a chrome-free column that spaces its panels; each FramePanel
 *  is one flat zinc-900 surface with a 1px border and no shadow, so a page
 *  reads as monolithic panels on the darker root rather than nested boxes.
 *
 * @remarks
 *  FrameHeader and FrameFooter placed directly in a Frame are plain label
 *  bars above or below the panel. A caller that wants a header inside the
 *  box gives the Frame the surface classes and uses variant="ghost" so the
 *  panel draws no second border. Account Settings uses one active
 *  FramePanel with a vertical settings rail.
 *
 * @see
 *  DESIGN.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "cn"

/**
 * Frame sets --frame-panel-bg and --frame-panel-border-color; FramePanel reads
 * them back as bg-(--frame-panel-bg) and border-(--frame-panel-border-color).
 * So a variant re-points every panel from one place, and a consumer's own
 * bg-* on a panel still wins on source order.
 */
const frameVariants = cva(
  [
    "relative flex flex-col gap-(--frame-gap) rounded-(--frame-radius)",
    "[--frame-radius:var(--radius-lg)] [--frame-panel-radius:var(--frame-radius)]",
    "[--frame-gap:--spacing(2)] [--frame-panel-header-gap:0rem] [--frame-panel-footer-gap:--spacing(1)]",
    "[--frame-panel-px-adjust:0px] [--frame-panel-py-adjust:0px] [--frame-panel-header-px-adjust:0px] [--frame-panel-header-py-adjust:0px] [--frame-panel-footer-px-adjust:0px] [--frame-panel-footer-py-adjust:0px]",
    "[--frame-panel-px:calc(var(--frame-panel-px-base)+var(--frame-panel-px-adjust))] [--frame-panel-py:calc(var(--frame-panel-py-base)+var(--frame-panel-py-adjust))] [--frame-panel-header-px:calc(var(--frame-panel-header-px-base)+var(--frame-panel-header-px-adjust))] [--frame-panel-header-py:calc(var(--frame-panel-header-py-base)+var(--frame-panel-header-py-adjust))] [--frame-panel-footer-px:calc(var(--frame-panel-footer-px-base)+var(--frame-panel-footer-px-adjust))] [--frame-panel-footer-py:calc(var(--frame-panel-footer-py-base)+var(--frame-panel-footer-py-adjust))]",
    "[--frame-panel-bg:var(--color-card)] [--frame-panel-border-color:var(--color-border)]",
  ],
  {
    variants: {
      variant: {
        default: "",
        // Opaque root color, for sticky regions that must mask content
        // scrolling beneath them.
        inverse: "bg-background",
        // Panels draw no surface of their own; the Frame (or its parent)
        // supplies the box.
        ghost: "[--frame-panel-bg:transparent] [--frame-panel-border-color:transparent]",
      },
      // Bars read as chrome, not a second content block: py runs 0.5/1.5/2/2.5
      // against a body py of 2/3.5/4/5, while px stays level with the body so
      // header, content and footer left-align.
      spacing: {
        xs: "[--frame-panel-px-base:--spacing(2)] [--frame-panel-py-base:--spacing(2)] [--frame-panel-header-px-base:--spacing(2)] [--frame-panel-header-py-base:--spacing(0.5)] [--frame-panel-footer-px-base:--spacing(2)] [--frame-panel-footer-py-base:--spacing(0.5)]",
        sm: "[--frame-panel-px-base:--spacing(3)] [--frame-panel-py-base:--spacing(3.5)] [--frame-panel-header-px-base:--spacing(3)] [--frame-panel-header-py-base:--spacing(1.5)] [--frame-panel-footer-px-base:--spacing(3)] [--frame-panel-footer-py-base:--spacing(1.5)]",
        default:
          "[--frame-panel-px-base:--spacing(4)] [--frame-panel-py-base:--spacing(4)] [--frame-panel-header-px-base:--spacing(4)] [--frame-panel-header-py-base:--spacing(2)] [--frame-panel-footer-px-base:--spacing(4)] [--frame-panel-footer-py-base:--spacing(2)]",
        lg: "[--frame-panel-px-base:--spacing(5)] [--frame-panel-py-base:--spacing(5)] [--frame-panel-header-px-base:--spacing(5)] [--frame-panel-header-py-base:--spacing(2.5)] [--frame-panel-footer-px-base:--spacing(5)] [--frame-panel-footer-py-base:--spacing(2.5)]",
      },
      // Adjacent panels share one hairline and one outer radius.
      stacked: {
        true: [
          "gap-0 *:has-[+[data-slot=frame-panel]]:rounded-b-none",
          "*:[[data-slot=frame-panel]+[data-slot=frame-panel]]:rounded-t-none",
          "*:[[data-slot=frame-panel]+[data-slot=frame-panel]]:border-t-0",
        ],
        false: "",
      },
      dense: {
        true: "gap-0",
        false: "",
      },
    },
    defaultVariants: {
      variant: "default",
      spacing: "default",
      stacked: false,
      dense: false,
    },
  }
)

function Frame({
  className,
  variant,
  spacing,
  stacked,
  dense,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof frameVariants>) {
  return (
    <div
      className={cn(
        frameVariants({ variant, spacing, stacked, dense }),
        className
      )}
      data-slot="frame"
      data-spacing={spacing}
      {...props}
    />
  )
}

function FramePanel({
  className,
  fit,
  ...props
}: React.ComponentProps<"div"> & { fit?: boolean }) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-(--frame-panel-radius) border border-(--frame-panel-border-color) bg-(--frame-panel-bg)",
        /* `fit` sizes the panel to its content; otherwise it grows to fill
           the frame. */
        !fit && "grow",
        "px-(--frame-panel-px) py-(--frame-panel-py)",
        className
      )}
      data-slot="frame-panel"
      {...props}
    />
  )
}

function FrameHeader({ className, ...props }: React.ComponentProps<"header">) {
  return (
    <header
      className={cn(
        "flex flex-col gap-(--frame-panel-header-gap) px-(--frame-panel-header-px) py-(--frame-panel-header-py)",
        className
      )}
      data-slot="frame-panel-header"
      {...props}
    />
  )
}

function FrameTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("text-sm font-semibold", className)}
      data-slot="frame-panel-title"
      {...props}
    />
  )
}

function FrameDescription({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("text-muted-foreground text-sm", className)}
      data-slot="frame-panel-description"
      {...props}
    />
  )
}

function FrameFooter({ className, ...props }: React.ComponentProps<"footer">) {
  return (
    <footer
      className={cn(
        "flex flex-col gap-(--frame-panel-footer-gap) px-(--frame-panel-footer-px) py-(--frame-panel-footer-py)",
        className
      )}
      data-slot="frame-panel-footer"
      {...props}
    />
  )
}

export {
  Frame,
  FramePanel,
  FrameHeader,
  FrameTitle,
  FrameDescription,
  FrameFooter,
  frameVariants,
}
