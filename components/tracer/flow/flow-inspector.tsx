/**
 * -------------------------------------------------------------------------
 * @file   flow-inspector.tsx
 * @brief  Renders selected Call Flow node fields and branch controls.
 *
 * @description
 *  Provides type-specific editing controls, inline node issues, and keyboard
 *  branch rewiring for the selected editor node.
 *
 * @remarks
 *  Native selects keep keyboard editing reliable in the dense builder surface.
 *
 * @see
 *  components/tracer/workspace-flow-editor.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Frame, FramePanel } from "@/components/reui/frame";
import {
  nodeHandles,
  outcomeKinds,
  recordingDisclosureText,
  ttsVoices,
  voicemailLimits,
  type EdgeHandle,
  type FlowNode,
  type ValidationIssue,
} from "@/data/call-flow";

interface Props {
  node: FlowNode | undefined;
  nodes: FlowNode[];
  issues: ValidationIssue[];
  editing: boolean;
  onChange: (node: FlowNode) => void;
  onConnectHandle: (handle: EdgeHandle, targetId: string | null) => void;
  onDelete: () => void;
}

const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

function InspectorSelect({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export default function FlowInspector({ node, nodes, issues, editing, onChange, onConnectHandle, onDelete }: Props) {
  if (!node)
    return (
      <Frame>
        <FramePanel>
          <p className="text-sm text-muted-foreground">Select a node to inspect it.</p>
        </FramePanel>
      </Frame>
    );
  const patch = (value: Partial<FlowNode>) => onChange({ ...node, ...value } as FlowNode);
  const voiceOptions = ttsVoices.map((voice) => ({ value: voice, label: voice }));
  return (
    <Frame>
      <FramePanel className="grid gap-4">
        <h2 className="font-semibold">Inspector</h2>
        <p className="text-sm capitalize">
          {node.type.replaceAll("_", " ")} <span className="sr-only">{node.type}</span>
        </p>
        {node.type === "recording_disclosure" ? (
          <>
            <InspectorSelect
              label="Voice"
              value={node.voice}
              options={voiceOptions}
              onChange={(value) => patch({ voice: value as typeof node.voice })}
            />
            <p className="rounded border p-2 text-sm">{recordingDisclosureText}</p>
          </>
        ) : null}
        {node.type === "keypad_gate" ? (
          <>
            <Textarea
              aria-label="Prompt"
              value={node.prompt}
              disabled={!editing}
              onChange={(event) => patch({ prompt: event.target.value })}
            />
            <InspectorSelect
              label="Voice"
              value={node.voice}
              options={voiceOptions}
              onChange={(value) => patch({ voice: value as typeof node.voice })}
            />
            <InspectorSelect
              label="Digit"
              value={node.digit}
              options={Array.from({ length: 10 }, (_, index) => ({ value: String(index), label: String(index) }))}
              onChange={(value) => patch({ digit: value })}
            />
            <Input
              aria-label="Timeout seconds"
              type="number"
              value={node.timeoutSeconds}
              onChange={(event) => patch({ timeoutSeconds: Number(event.target.value) })}
            />
          </>
        ) : null}
        {node.type === "forward_call" ? (
          <>
            <Input
              aria-label="Destination Number"
              value={node.destinationNumber}
              onChange={(event) => patch({ destinationNumber: event.target.value })}
            />
            <Input
              aria-label="Timeout seconds"
              type="number"
              value={node.timeoutSeconds}
              onChange={(event) => patch({ timeoutSeconds: Number(event.target.value) })}
            />
          </>
        ) : null}
        {node.type === "whisper" ? (
          <>
            <Textarea aria-label="Message" value={node.message} onChange={(event) => patch({ message: event.target.value })} />
            <InspectorSelect
              label="Voice"
              value={node.voice}
              options={voiceOptions}
              onChange={(value) => patch({ voice: value as typeof node.voice })}
            />
          </>
        ) : null}
        {node.type === "voicemail" ? (
          <>
            <Textarea aria-label="Greeting" value={node.greeting} onChange={(event) => patch({ greeting: event.target.value })} />
            <InspectorSelect
              label="Voice"
              value={node.voice}
              options={voiceOptions}
              onChange={(value) => patch({ voice: value as typeof node.voice })}
            />
            <p className="text-xs text-muted-foreground">
              Maximum {voicemailLimits.maxSeconds}s, silence {voicemailLimits.silenceTimeoutSeconds}s, finish with{" "}
              {voicemailLimits.finishOnKey}
            </p>
          </>
        ) : null}
        {node.type === "business_hours" ? (
          <div className="grid gap-2">
            <strong>Weekly windows</strong>
            {node.weeklyWindows.map((window, index) => (
              <div className="grid gap-1" key={`${window.day}-${index}`}>
                <InspectorSelect
                  label="Day"
                  value={String(window.day)}
                  options={days.map((day, dayIndex) => ({ value: String(dayIndex), label: day }))}
                  onChange={(value) => {
                    const weeklyWindows = [...node.weeklyWindows];
                    weeklyWindows[index] = { ...window, day: Number(value) as typeof window.day };
                    patch({ weeklyWindows });
                  }}
                />
                <Input
                  type="time"
                  value={window.start}
                  onChange={(event) => {
                    const weeklyWindows = [...node.weeklyWindows];
                    weeklyWindows[index] = { ...window, start: event.target.value };
                    patch({ weeklyWindows });
                  }}
                />
                <Input
                  type="time"
                  value={window.end}
                  onChange={(event) => {
                    const weeklyWindows = [...node.weeklyWindows];
                    weeklyWindows[index] = { ...window, end: event.target.value };
                    patch({ weeklyWindows });
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => patch({ weeklyWindows: node.weeklyWindows.filter((_, candidate) => candidate !== index) })}
                >
                  Remove
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              onClick={() => patch({ weeklyWindows: [...node.weeklyWindows, { day: 1, start: "09:00", end: "17:00" }] })}
            >
              Add window
            </Button>
            <strong>Date overrides</strong>
            {node.dateOverrides.map((override, index) => (
              <div className="grid gap-1" key={`${override.date}-${index}`}>
                <Input
                  type="date"
                  value={override.date}
                  onChange={(event) => {
                    const dateOverrides = [...node.dateOverrides];
                    dateOverrides[index] = { ...override, date: event.target.value };
                    patch({ dateOverrides });
                  }}
                />
                <label className="flex items-center justify-between">
                  <span>Open</span>
                  <Switch
                    checked={override.open}
                    onCheckedChange={(open) => {
                      const dateOverrides = [...node.dateOverrides];
                      dateOverrides[index] = { ...override, open };
                      patch({ dateOverrides });
                    }}
                  />
                </label>
                {override.open ? (
                  <>
                    <Input
                      aria-label="Override start"
                      type="time"
                      value={override.start ?? "09:00"}
                      onChange={(event) => {
                        const dateOverrides = [...node.dateOverrides];
                        dateOverrides[index] = { ...override, start: event.target.value };
                        patch({ dateOverrides });
                      }}
                    />
                    <Input
                      aria-label="Override end"
                      type="time"
                      value={override.end ?? "17:00"}
                      onChange={(event) => {
                        const dateOverrides = [...node.dateOverrides];
                        dateOverrides[index] = { ...override, end: event.target.value };
                        patch({ dateOverrides });
                      }}
                    />
                  </>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => patch({ dateOverrides: node.dateOverrides.filter((_, candidate) => candidate !== index) })}
                >
                  Remove
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              onClick={() => patch({ dateOverrides: [...node.dateOverrides, { date: "2026-01-01", open: false }] })}
            >
              Add override
            </Button>
          </div>
        ) : null}
        {node.type === "outcome" ? (
          <InspectorSelect
            label="Outcome"
            value={node.outcome}
            options={outcomeKinds.map((outcome) => ({ value: outcome, label: outcome }))}
            onChange={(value) => patch({ outcome: value as typeof node.outcome })}
          />
        ) : null}
        {issues.length ? (
          <ul role="alert" className="grid gap-1 text-sm text-destructive">
            {issues.map((issue) => (
              <li key={`${issue.code}-${issue.message}`}>{issue.message}</li>
            ))}
          </ul>
        ) : null}
        {node.type !== "incoming_call" && editing ? (
          <Button type="button" variant="destructive" onClick={onDelete}>
            Delete node
          </Button>
        ) : null}
        <div className="grid gap-2">
          <strong>Branches</strong>
          {nodeHandles[node.type].map((handle) => (
            <InspectorSelect
              key={handle}
              label={handle}
              value="none"
              options={[
                { value: "none", label: "Not connected" },
                ...nodes
                  .filter((candidate) => candidate.id !== node.id && candidate.type !== "incoming_call")
                  .map((candidate) => ({ value: candidate.id, label: candidate.id })),
              ]}
              onChange={(value) => onConnectHandle(handle, value === "none" ? null : value)}
            />
          ))}
        </div>
      </FramePanel>
    </Frame>
  );
}
