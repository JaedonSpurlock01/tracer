/**
 * PROTOTYPE - throwaway. Mounts three Call Detail variants on the existing
 * /workspaces/[id]/calls/[callId] route when ?variant= is set outside
 * production; otherwise renders the real page. With ?demo=1 the page
 * already swapped the Call for the fixture, and the media path points at
 * the synthetic demo Recording so playback works.
 */
"use client";

import type { ReactNode } from "react";

import { demoMediaPath } from "@/components/tracer/prototype/call-detail-fixture";
import { VariantA, VariantB, VariantC, type VariantProps } from "@/components/tracer/prototype/call-detail-variants";
import PrototypeSwitcher, { usePrototypeVariant } from "@/components/tracer/prototype/prototype-switcher";
import { recordingMediaPath } from "@/components/tracer/recording-engine";

export default function CallDetailPrototype({ children, demo, ...props }: Omit<VariantProps, "mediaPath"> & { demo: boolean; children: ReactNode }) {
  const variant = usePrototypeVariant();
  if (!variant) return <>{children}</>;
  const Variant = variant === "A" ? VariantA : variant === "B" ? VariantB : VariantC;
  const mediaPath = demo ? demoMediaPath : props.call.recording.state === "Ready" ? recordingMediaPath(props.call.workspace.id, props.call.recording.id) : "";
  return (
    <>
      <Variant {...props} mediaPath={mediaPath} />
      <PrototypeSwitcher current={variant} bottomClassName={variant === "B" ? "bottom-44" : "bottom-4"} />
    </>
  );
}
