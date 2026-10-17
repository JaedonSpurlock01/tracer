/**
 * -------------------------------------------------------------------------
 * @file   workspace-access-section.tsx
 * @brief  Renders the Workspace Settings Access section for Operators.
 *
 * @description
 *  Lists the Client Viewers holding an Access Grant for one Workspace, adds
 *  Access for another Client Viewer while the Workspace is Active, and
 *  removes Access unless it is that Client Viewer's last grant.
 *
 * @remarks
 *  Grants are managed through the Users server interface so one
 *  administration boundary owns every Access Grant rule. Operators have
 *  global access and never appear as Access Grants.
 *
 * @see
 *  data/operator-administration.ts
 *  DESIGN.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Badge } from "@/components/reui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { mutationFetch } from "@/components/tracer/mutation-fetch";
import type { OperatorRecord } from "@/data/operator-administration";
import type { WorkspaceRecord } from "@/data/workspaces";

const lastGrantMessage = "A Client Viewer must keep at least one Access Grant.";

function stateVariant(state: OperatorRecord["state"]): "primary-light" | "success-light" | "destructive-light" {
  if (state === "Active") return "success-light";
  if (state === "Disabled") return "destructive-light";
  return "primary-light";
}

function clientViewersOf(users: OperatorRecord[]): OperatorRecord[] {
  return users.filter((user) => user.role === "Client Viewer");
}

export default function WorkspaceAccessSection({
  workspace,
  initialUsers,
}: {
  workspace: Pick<WorkspaceRecord, "id" | "state">;
  initialUsers?: OperatorRecord[];
}) {
  const [clientViewers, setClientViewers] = useState<OperatorRecord[] | null>(initialUsers ? clientViewersOf(initialUsers) : null);
  const [loadError, setLoadError] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoadError(false);
    try {
      const response = await fetch("/api/users");
      if (!response.ok) throw new Error("Users unavailable");
      const body = (await response.json()) as { users?: OperatorRecord[] };
      setClientViewers(clientViewersOf(body.users ?? []));
    } catch {
      setLoadError(true);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const granted = (clientViewers ?? []).filter((user) => user.accessGrants.some((grant) => grant.workspaceId === workspace.id));
  const ungranted = (clientViewers ?? []).filter((user) => !granted.includes(user));
  const items = Object.fromEntries(ungranted.map((user) => [user.id, user.name]));

  async function update(path: string, init: RequestInit) {
    setBusy(true);
    setError("");
    const response = await mutationFetch(path, init).catch(() => null);
    if (!response?.ok) {
      const body = response ? ((await response.json().catch(() => ({}))) as { error?: string }) : {};
      setError(body.error === "last_access_grant" ? lastGrantMessage : "Access could not be updated.");
    } else {
      setSelectedUserId(null);
      await load();
    }
    setBusy(false);
  }

  return (
    <section id="access" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h2 className="font-semibold">Access</h2>
          <p className="text-sm text-muted-foreground">Client Viewers with read access to this Workspace. Operators have global access.</p>
        </div>
        <Link className={buttonVariants({ variant: "outline", size: "sm" })} href="/users">
          Provision a Client Viewer
        </Link>
      </div>
      {error ? <p role="alert">{error}</p> : null}
      {loadError ? (
        <div className="flex items-center gap-3">
          <p role="alert">Access is unavailable.</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
            Retry
          </Button>
        </div>
      ) : clientViewers === null ? (
        <Skeleton className="h-16 w-full" />
      ) : (
        <>
          {granted.length ? (
            <ul className="flex flex-col gap-2">
              {granted.map((user) => (
                <li key={user.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="flex flex-col">
                    <span className="font-medium">{user.name}</span>
                    <span className="text-xs text-muted-foreground">{user.email}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <Badge variant={stateVariant(user.state)}>{user.state}</Badge>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Remove Access for ${user.name}`}
                      title={user.accessGrants.length <= 1 ? lastGrantMessage : undefined}
                      disabled={busy || user.accessGrants.length <= 1}
                      onClick={() => void update(`/api/users/${user.id}/access-grants/${workspace.id}`, { method: "DELETE" })}
                    >
                      Remove Access
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No Client Viewers have access to this Workspace.</p>
          )}
          {workspace.state === "Active" ? (
            <div className="flex flex-wrap items-end gap-2">
              <Field className="min-w-56 flex-1">
                <FieldLabel htmlFor="access-client-viewer">Client Viewer</FieldLabel>
                <Select items={items} value={selectedUserId} onValueChange={(value) => setSelectedUserId(value)}>
                  <SelectTrigger id="access-client-viewer" aria-label="Client Viewer" className="w-full">
                    <SelectValue placeholder="Select a Client Viewer" />
                  </SelectTrigger>
                  <SelectContent>
                    {ungranted.map((user) => (
                      <SelectItem key={user.id} value={user.id}>
                        {user.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Button
                type="button"
                variant="outline"
                disabled={busy || !selectedUserId}
                onClick={() =>
                  void update(`/api/users/${selectedUserId}/access-grants`, {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ workspaceId: workspace.id }),
                  })
                }
              >
                Add Access
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Only Active Workspaces can receive new Access Grants.</p>
          )}
        </>
      )}
    </section>
  );
}
