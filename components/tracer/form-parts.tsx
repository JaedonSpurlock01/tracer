/**
 * -------------------------------------------------------------------------
 * @file   form-parts.tsx
 * @brief  The shared parts every settings form is built from.
 *
 * @description
 *  SettingsSection is one settings panel: a header bar naming the section,
 *  a muted line saying what it controls, its fields, and a footer holding
 *  its actions. SwitchField is a switch with its label and a one-line
 *  description beneath the label, both announced with the switch.
 *  useAction tracks one action's pending state, failure, and confirmation,
 *  and ActionButton shows all three on and beside the button that started
 *  the action, together with why the action is unavailable when it is.
 *  A confirm button that closes its dialog on success passes
 *  showConfirmation={false}, so the confirmation appears once, beside the
 *  button that opened the dialog, and not again in the dialog as it closes.
 *
 * @remarks
 *  Settings pages used to build each section by hand, so label sizes,
 *  headings, and where the save button sat differed between pages. Read-only
 *  values use FactList from page-parts rather than read-only inputs, so they
 *  never look editable. Each action keeps its own pending flag because one
 *  shared busy flag disabled every action on the page while any one ran.
 *
 * @see
 *  components/tracer/page-parts.tsx
 *  DESIGN.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
"use client";

import { Loader2Icon } from "lucide-react";
import { useCallback, useId, useState, type ComponentProps, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { Panel } from "@/components/tracer/page-parts";
import { StatusMessage, useStatusMessage } from "@/components/tracer/status-message";

export type ActionResult = { message?: string; error?: string } | void;

export function useAction() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [status, announce] = useStatusMessage();
  const run = useCallback(
    async (task: () => Promise<ActionResult>) => {
      setPending(true);
      setError("");
      try {
        const result = await task();
        if (result?.error) setError(result.error);
        else if (result?.message) announce(result.message);
      } finally {
        setPending(false);
      }
    },
    [announce],
  );
  return { pending, error, status, run };
}

export type Action = ReturnType<typeof useAction>;

export function ActionButton({
  action,
  unavailable,
  showConfirmation = true,
  disabled,
  children,
  ...props
}: ComponentProps<typeof Button> & { action: Action; unavailable?: string | null; showConfirmation?: boolean }) {
  const id = useId();
  const confirmed = showConfirmation && Boolean(action.status.text);
  const note = action.error || (confirmed ? null : unavailable);
  return (
    <span className="flex flex-wrap items-center gap-3">
      <Button
        aria-busy={action.pending || undefined}
        aria-describedby={note ? id : undefined}
        disabled={disabled || action.pending || Boolean(unavailable)}
        {...props}
      >
        {action.pending ? <Loader2Icon aria-hidden="true" className="animate-spin" /> : null}
        {children}
      </Button>
      {action.error ? (
        <p id={id} role="alert" className="text-sm text-destructive">
          {action.error}
        </p>
      ) : confirmed ? (
        <StatusMessage status={action.status} className="text-sm text-muted-foreground" />
      ) : unavailable ? (
        <p id={id} className="text-xs text-muted-foreground">
          {unavailable}
        </p>
      ) : null}
    </span>
  );
}

export function SettingsSection({
  title,
  description,
  footer,
  children,
  ...props
}: Omit<ComponentProps<typeof Panel>, "title"> & { title: string; description?: ReactNode; footer?: ReactNode }) {
  return (
    <Panel title={title} {...props}>
      <div className="flex flex-col gap-5 p-4">
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        {children}
      </div>
      {footer ? <div className="flex flex-wrap items-center gap-3 border-t border-border px-4 py-3">{footer}</div> : null}
    </Panel>
  );
}

export function SwitchField({ label, description, ...props }: ComponentProps<typeof Switch> & { label: string; description: string }) {
  const id = useId();
  return (
    <Field orientation="horizontal" data-disabled={props.disabled || undefined}>
      <FieldContent>
        <FieldLabel id={`${id}-label`} htmlFor={id}>
          {label}
        </FieldLabel>
        <FieldDescription id={`${id}-description`} className="text-xs">
          {description}
        </FieldDescription>
      </FieldContent>
      <Switch id={id} aria-labelledby={`${id}-label`} aria-describedby={`${id}-description`} {...props} />
    </Field>
  );
}
