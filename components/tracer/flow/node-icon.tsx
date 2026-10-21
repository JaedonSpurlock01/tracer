/**
 * -------------------------------------------------------------------------
 * @file   node-icon.tsx
 * @brief  Maps each Call Flow node type to its icon.
 *
 * @description
 *  One Lucide icon per node type, shared by the canvas node, the palette,
 *  the inspector heading, and the Overview spine so a step looks the same
 *  everywhere.
 *
 * @remarks
 *  A new node type needs one entry here; see the checklist in
 *  data/call-flow.ts.
 *
 * @see
 *  data/call-flow.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { ClockIcon, FlagIcon, HashIcon, MessageSquareIcon, MicIcon, PhoneForwardedIcon, PhoneIncomingIcon, VoicemailIcon } from "lucide-react";

import type { FlowNodeType } from "@/data/call-flow";

const icons = {
  incoming_call: PhoneIncomingIcon,
  recording_disclosure: MicIcon,
  business_hours: ClockIcon,
  keypad_gate: HashIcon,
  forward_call: PhoneForwardedIcon,
  whisper: MessageSquareIcon,
  voicemail: VoicemailIcon,
  outcome: FlagIcon,
} satisfies Record<FlowNodeType, typeof FlagIcon>;

export function NodeIcon({ type, className = "size-4" }: { type: FlowNodeType; className?: string }) {
  const Icon = icons[type];
  return <Icon className={className} aria-hidden />;
}
