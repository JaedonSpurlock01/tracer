/**
 * -------------------------------------------------------------------------
 * @file   forms-settings.tsx
 * @brief  Edits a Workspace's Forwarding Recipients.
 *
 * @description
 *  ForwardingRecipientsSettings keeps the list of up to ten email addresses
 *  that receive every forwarded Form Submission, with add, remove, and one
 *  Save.
 *
 * @remarks
 *  The Organization's Forms key is managed on Integrations, not here,
 *  because one key serves every Site.
 *
 * @see
 *  components/tracer/workspace-settings-view.tsx
 *  data/form-submissions.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { mutationFetch } from "@/components/tracer/mutation-fetch";

const maxForwardingRecipients = 10;

export function ForwardingRecipientsSettings({ workspaceId, initial, hostname, onMessage }: { workspaceId: string; initial: string[]; hostname: string | null; onMessage: (message: string) => void }) {
  const [emails, setEmails] = useState(initial);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const atLimit = emails.length >= maxForwardingRecipients;

  function add() {
    const email = draft.trim().toLowerCase();
    if (!email) return;
    setEmails((current) => (current.includes(email) ? current : [...current, email]));
    setDraft("");
  }

  async function save() {
    setBusy(true);
    setError("");
    const response = await mutationFetch(`/api/workspaces/${workspaceId}/forms/forwarding`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ emails }),
    }).catch(() => null);
    if (!response?.ok) {
      setError(response?.status === 400 ? `Enter up to ${maxForwardingRecipients} valid email addresses.` : "The Forwarding Recipients could not be saved.");
    } else {
      const body = (await response.json()) as { forwardTo: string[] };
      setEmails(body.forwardTo);
      onMessage("Forwarding Recipients saved.");
    }
    setBusy(false);
  }

  return (
    <section role="region" aria-labelledby="forwarding-recipients-title" className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h3 id="forwarding-recipients-title" className="font-semibold">Forwarding Recipients</h3>
        <p className="text-sm text-muted-foreground">
          Every Form Submission is emailed from <span className="font-mono">info@{hostname ?? "<the linked Site's hostname>"}</span> with Reply-To the customer. Without recipients, submissions are stored as Not forwarded.
        </p>
      </div>
      {emails.length === 0 ? (
        <p className="text-sm text-muted-foreground">No Forwarding Recipients yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {emails.map((email) => (
            <li key={email} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="truncate font-mono">{email}</span>
              <Button type="button" variant="ghost" size="sm" disabled={busy} aria-label={`Remove ${email}`} onClick={() => setEmails((current) => current.filter((item) => item !== email))}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <Field className="w-full sm:w-72" data-invalid={Boolean(error)}>
          <FieldLabel htmlFor="forwarding-recipient-email">Add a recipient</FieldLabel>
          <Input
            id="forwarding-recipient-email"
            type="email"
            value={draft}
            disabled={busy || atLimit}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                add();
              }
            }}
          />
          {error ? <FieldError>{error}</FieldError> : null}
        </Field>
        <Button type="button" variant="outline" disabled={busy || atLimit || !draft.trim()} onClick={add}>
          Add
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" disabled={busy} onClick={() => void save()}>
          Save Forwarding Recipients
        </Button>
        <p className="text-xs text-muted-foreground tabular-nums">{emails.length} of {maxForwardingRecipients} recipients</p>
      </div>
    </section>
  );
}
