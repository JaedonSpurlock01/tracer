/**
 * -------------------------------------------------------------------------
 * @file   flow-inspector.tsx
 * @brief  Renders selected Call Flow node fields and branch controls.
 *
 * @description
 *  Provides type-specific editing controls, inline node issues, and keyboard
 *  branch rewiring for the selected editor node, docked inside the canvas. Business Hours times are
 *  chosen in 15-minute steps in the Workspace timezone, and text-to-speech
 *  prompts show character guidance and a browser Preview.
 *
 * @remarks
 *  Native selects keep keyboard editing reliable in the dense builder surface
 *  and, unlike a time input, can offer 24:00 as the end of an overnight
 *  segment. Preview uses the browser's speech synthesis because Twilio's
 *  voices cannot be heard without placing a call, so it only approximates
 *  the selected voice.
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
import { NodeIcon } from "@/components/tracer/flow/node-icon";
import {
  describeFlowNode,
  nodeHandles,
  outcomeKinds,
  promptMaxLength,
  recordingDisclosureText,
  ttsVoices,
  voicemailLimits,
  type EdgeHandle,
  type FlowNode,
  type TtsVoice,
  type ValidationIssue,
} from "@/data/call-flow";

interface Props {
  node: FlowNode | undefined;
  nodes: FlowNode[];
  issues: ValidationIssue[];
  /** Current target of each branch handle, so the selects show the wiring as it is. */
  targets: Partial<Record<EdgeHandle, string>>;
  editing: boolean;
  timeZone: string;
  onChange: (node: FlowNode) => void;
  onConnectHandle: (handle: EdgeHandle, targetId: string | null) => void;
  onDelete: () => void;
}

const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

const quarterHours = Array.from({ length: 97 }, (_, index) => `${String(Math.floor(index / 4)).padStart(2, "0")}:${String((index % 4) * 15).padStart(2, "0")}`);
const startTimes = quarterHours.slice(0, -1);
const endTimes = quarterHours.slice(1);

function timeOptions(times: string[], current: string): Array<{ value: string; label: string }> {
  return (times.includes(current) ? times : [...times, current].sort()).map((time) => ({ value: time, label: time }));
}

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

function previewPrompt(text: string): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-US";
  window.speechSynthesis.speak(utterance);
}

function PromptField({
  label,
  text,
  voice,
  editing,
  editableText = true,
  onTextChange,
  onVoiceChange,
}: {
  label: string;
  text: string;
  voice: TtsVoice;
  editing: boolean;
  editableText?: boolean;
  onTextChange?: (text: string) => void;
  onVoiceChange: (voice: TtsVoice) => void;
}) {
  return (
    <div className="grid gap-2">
      {editableText ? (
        <>
          <Textarea aria-label={label} value={text} maxLength={promptMaxLength} disabled={!editing} onChange={(event) => onTextChange?.(event.target.value)} />
          <p className="text-xs text-muted-foreground tabular-nums">
            {text.trim().length} / {promptMaxLength} characters
          </p>
        </>
      ) : (
        <p className="rounded border p-2 text-sm">{text}</p>
      )}
      <InspectorSelect
        label="Voice"
        value={voice}
        disabled={!editing}
        options={ttsVoices.map((option) => ({ value: option, label: option }))}
        onChange={(value) => onVoiceChange(value as TtsVoice)}
      />
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" disabled={!text.trim()} onClick={() => previewPrompt(text)}>
          Preview
        </Button>
        <p className="text-xs text-muted-foreground">Preview uses your browser&apos;s voice, which only approximates {voice}.</p>
      </div>
    </div>
  );
}

export default function FlowInspector({ node, nodes, issues, targets, editing, timeZone, onChange, onConnectHandle, onDelete }: Props) {
  if (!node) return null;
  const patch = (value: Partial<FlowNode>) => onChange({ ...node, ...value } as FlowNode);
  return (
    <div className="grid gap-4 p-3">
        <h2 className="flex items-center gap-2 font-semibold">
          <NodeIcon type={node.type} />
          {describeFlowNode(node).title}
        </h2>
        {node.type === "recording_disclosure" ? (
          <PromptField label="Disclosure" text={recordingDisclosureText} voice={node.voice} editing={editing} editableText={false} onVoiceChange={(voice) => patch({ voice })} />
        ) : null}
        {node.type === "keypad_gate" ? (
          <>
            <PromptField label="Prompt" text={node.prompt} voice={node.voice} editing={editing} onTextChange={(prompt) => patch({ prompt })} onVoiceChange={(voice) => patch({ voice })} />
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
          <PromptField label="Message" text={node.message} voice={node.voice} editing={editing} onTextChange={(message) => patch({ message })} onVoiceChange={(voice) => patch({ voice })} />
        ) : null}
        {node.type === "voicemail" ? (
          <>
            <PromptField label="Greeting" text={node.greeting} voice={node.voice} editing={editing} onTextChange={(greeting) => patch({ greeting })} onVoiceChange={(voice) => patch({ voice })} />
            <p className="text-xs text-muted-foreground">
              Maximum {voicemailLimits.maxSeconds}s, silence {voicemailLimits.silenceTimeoutSeconds}s, finish with{" "}
              {voicemailLimits.finishOnKey}
            </p>
          </>
        ) : null}
        {node.type === "business_hours" ? (
          <div className="grid gap-2">
            <p className="text-xs text-muted-foreground">
              Times use the {timeZone} timezone. Enter overnight hours as one window per day, ending at 24:00.
            </p>
            <strong>Weekly windows</strong>
            {node.weeklyWindows.map((window, index) => (
              <div className="grid gap-1" key={`${window.day}-${index}`}>
                <InspectorSelect
                  label={`Window ${index + 1} day`}
                  value={String(window.day)}
                  options={days.map((day, dayIndex) => ({ value: String(dayIndex), label: day }))}
                  onChange={(value) => {
                    const weeklyWindows = [...node.weeklyWindows];
                    weeklyWindows[index] = { ...window, day: Number(value) as typeof window.day };
                    patch({ weeklyWindows });
                  }}
                />
                <InspectorSelect
                  label={`Window ${index + 1} start`}
                  value={window.start}
                  options={timeOptions(startTimes, window.start)}
                  onChange={(start) => {
                    const weeklyWindows = [...node.weeklyWindows];
                    weeklyWindows[index] = { ...window, start };
                    patch({ weeklyWindows });
                  }}
                />
                <InspectorSelect
                  label={`Window ${index + 1} end`}
                  value={window.end}
                  options={timeOptions(endTimes, window.end)}
                  onChange={(end) => {
                    const weeklyWindows = [...node.weeklyWindows];
                    weeklyWindows[index] = { ...window, end };
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
                  aria-label={`Override ${index + 1} date`}
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
                      dateOverrides[index] = open ? { ...override, open, start: override.start ?? "09:00", end: override.end ?? "17:00" } : { date: override.date, open };
                      patch({ dateOverrides });
                    }}
                  />
                </label>
                {override.open ? (
                  <>
                    <InspectorSelect
                      label={`Override ${index + 1} start`}
                      value={override.start ?? "09:00"}
                      options={timeOptions(startTimes, override.start ?? "09:00")}
                      onChange={(start) => {
                        const dateOverrides = [...node.dateOverrides];
                        dateOverrides[index] = { ...override, start };
                        patch({ dateOverrides });
                      }}
                    />
                    <InspectorSelect
                      label={`Override ${index + 1} end`}
                      value={override.end ?? "17:00"}
                      options={timeOptions(endTimes, override.end ?? "17:00")}
                      onChange={(end) => {
                        const dateOverrides = [...node.dateOverrides];
                        dateOverrides[index] = { ...override, end };
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
              value={targets[handle] ?? "none"}
              disabled={!editing}
              options={[
                { value: "none", label: "Not connected" },
                ...nodes
                  .filter((candidate) => candidate.id !== node.id && candidate.type !== "incoming_call")
                  .map((candidate) => {
                    const { title, detail } = describeFlowNode(candidate);
                    return { value: candidate.id, label: `${title} · ${detail.length > 40 ? `${detail.slice(0, 40)}…` : detail}` };
                  }),
              ]}
              onChange={(value) => onConnectHandle(handle, value === "none" ? null : value)}
            />
          ))}
        </div>
    </div>
  );
}
