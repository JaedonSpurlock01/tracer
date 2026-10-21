"use client";

/**
 * -------------------------------------------------------------------------
 * @file   purge-media.tsx
 * @brief  Renders the Operator-only Purge Media action and its confirmation.
 *
 * @description
 *  Offers Purge Media on Call Detail while the Recording's media can still
 *  be purged: a Recording exists and its media has neither expired nor been
 *  purged. An AlertDialog states that the purge cannot be undone, exactly
 *  what it deletes, and what Tracer keeps, and Purge Media stays disabled
 *  until the Operator ticks an acknowledgement that the deletion is
 *  permanent, which is cleared each time the dialog opens. Confirming posts to the
 *  Workspace-authorized purge route and shows a pending state; success
 *  closes the dialog and hands the purge time back so Call Detail shows the
 *  purged media state at once. Also derives that purged state from the
 *  current Call the same way the server read model does.
 *
 * @remarks
 *  A Conflict means the Recording was purged, expired, or removed since the
 *  page loaded, so the dialog explains which and refreshes the Client Cache
 *  to bring the current Call Detail; other failures keep the dialog open to
 *  try again. The page renders the action only for Operators, and the route
 *  enforces the same rule. Until the refreshed Call arrives, the purged
 *  state shown locally drops the Recording, MP3, Transcript, evidence,
 *  rationale, and stages that will never run, as the read model does.
 *
 * @see
 *  data/media-purge.ts
 *  data/call-details.ts
 *  components/tracer/call-detail-view.tsx
 *  DESIGN.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { mutationFetch } from "@/components/tracer/mutation-fetch";
import type { CallDetail } from "@/data/call-details";
import { refreshClientCache } from "@/data/client-cache";

const conflicts: Readonly<Record<string, string>> = {
  already_purged: "This Recording's media was already purged.",
  media_expired: "This Recording's media has already expired.",
  no_recording: "This Call has no Recording to purge.",
};

function purgeError(status: number): string {
  if (status === 403) return "Only Operators can purge media.";
  if (status === 404) return "This Call is no longer available.";
  return "Media could not be purged. Try again.";
}

export function canPurgeMedia(recording: CallDetail["recording"]): boolean {
  return recording.state === "Ready" || recording.state === "Processing" || recording.state === "Failed";
}

export function purgedCallDetail(call: CallDetail, purgedAt: string): CallDetail {
  const assessment: CallDetail["leadAssessment"] = { ...call.leadAssessment, rationale: undefined, evidence: undefined };
  const keepsTranscript = call.transcript.state === "Skipped" || call.transcript.state === "Unavailable";
  return {
    ...call,
    recording: { state: "Purged", purgedAt },
    mp3RecordingId: null,
    transcript: keepsTranscript ? call.transcript : { state: "Purged" },
    leadAssessment: assessment.state === "Completed" ? assessment : { state: "Unavailable" },
    timeline: [...call.timeline.filter((entry) => entry.status !== "Pending"), { id: "media-purge", label: "Media purged", status: "Completed", at: purgedAt }],
  };
}

export default function PurgeMediaDialog({ workspaceId, callId, open, onOpenChange, onPurged }: { workspaceId: string; callId: string; open: boolean; onOpenChange(open: boolean): void; onPurged(purgedAt: string): void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);

  // Each opening asks for the acknowledgement again and starts clean.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setError("");
      setAcknowledged(false);
    }
  }

  async function purge() {
    setPending(true);
    setError("");
    try {
      const response = await mutationFetch(`/api/workspaces/${workspaceId}/calls/${callId}/media/purge`, { method: "POST" });
      if (response.ok) {
        const body = (await response.json()) as { purge: { purgedAt: string } };
        onOpenChange(false);
        onPurged(body.purge.purgedAt);
        return;
      }
      if (response.status === 409) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(`${conflicts[body.error ?? ""] ?? "This Recording's media can no longer be purged."} Call Detail is being refreshed.`);
        void refreshClientCache().catch(() => undefined);
        return;
      }
      setError(purgeError(response.status));
    } catch {
      setError(purgeError(0));
    } finally {
      setPending(false);
    }
  }

  return (
      <AlertDialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Purge this Call&apos;s media?</AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone. Purging permanently deletes the Recording audio, waveform, and MP3, the Transcript, the Transcript-derived evidence and rationale, any copy
              of the audio still at Twilio, and any unexpired export ZIPs that include this Recording.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <p className="text-sm text-muted-foreground">Tracer keeps the Call facts, Call Outcome, Lead Assessment summary, classification, and score, Lead Review, and analytics.</p>
          <Field orientation="horizontal">
            <Checkbox id="purge-media-acknowledgement" checked={acknowledged} disabled={pending} onCheckedChange={(checked) => setAcknowledged(checked === true)} />
            <FieldLabel htmlFor="purge-media-acknowledgement">I understand this permanently deletes this Call&apos;s media</FieldLabel>
          </Field>
          {error ? (
            <p role="alert" className="text-sm">
              {error}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={pending || !acknowledged} onClick={() => void purge()}>
              {pending ? (
                <>
                  <Spinner /> Purging...
                </>
              ) : (
                "Purge Media"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
  );
}
