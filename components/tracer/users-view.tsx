/**
 * -------------------------------------------------------------------------
 * @file   users-view.tsx
 * @brief  Renders the Operator Users Data Grid and management dialogs.
 *
 * @description
 *  Loads Organization users, provides client-side search and User State
 *  filtering, and manages provisioning, delivery, and state actions. Each
 *  user is one line: the name with the email beside it, Role, State, the
 *  Workspaces the user can read, the last sign-in, and who added the user.
 *  Every action shows its own pending state, names a failure beside the
 *  button that started it, and confirms beside that button; a disabled
 *  action says why it is unavailable.
 *
 * @remarks
 *  Server authorization and validation remain authoritative for every action.
 *  The last sign-in shows the short time in the given timezone, falling back
 *  to the browser's, with the full timestamp as its hover title. Absent
 *  values are named: Never for a user who has not signed in, and Initial
 *  setup for the Operator the bootstrap script created. The Provision form,
 *  the Manage dialog body, and the delivery warning are their own
 *  components so their actions start fresh each time they open.
 *
 * @see
 *  data/operator-administration-handler.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
"use client";

import { useCallback, useId, useMemo, useState, useEffect, type FormEvent, type ReactNode } from "react";
import { useTable, type ColumnDef, type PaginationState } from "@tanstack/react-table";

import { Badge } from "@/components/reui/badge";
import {
  DataGrid,
  dataGridFeatures,
  type DataGridFeatures,
} from "@/components/reui/data-grid/data-grid";
import { DataGridPagination } from "@/components/reui/data-grid/data-grid-pagination";
import { DataGridScrollArea } from "@/components/reui/data-grid/data-grid-scroll-area";
import { DataGridTable } from "@/components/reui/data-grid/data-grid-table";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCallTime, formatShortTime } from "@/components/tracer/call-format";
import { ActionButton, useAction, type ActionResult } from "@/components/tracer/form-parts";
import { mutationFetch } from "@/components/tracer/mutation-fetch";
import { FactList, PageHeader, Panel } from "@/components/tracer/page-parts";
import { StatusMessage, useStatusMessage } from "@/components/tracer/status-message";
import type { CanonicalRole, UserState } from "@/data/auth-policy";
import type { OperatorRecord } from "@/data/operator-administration";

const pageSize = 10;
const userStates: Array<"All" | UserState> = ["All", "Provisioned", "Active", "Disabled"];

function stateVariant(state: UserState): "primary-light" | "success-light" | "destructive-light" {
  if (state === "Active") return "success-light";
  if (state === "Disabled") return "destructive-light";
  return "primary-light";
}

function Muted({ children }: { children: string }) {
  return <span className="text-muted-foreground">{children}</span>;
}

function responseBody(response: Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>;
}

interface WorkspaceOption {
  id: string;
  name: string;
}

const updateErrors: Record<string, string> = {
  last_access_grant: "A Client Viewer must keep at least one Access Grant.",
  workspace_not_grantable: "Only Active Workspaces can be granted.",
  last_active_operator: "The last Active Operator cannot be disabled or made a Client Viewer.",
  access_grant_required: "Select at least one Workspace.",
};

async function updateError(response: Response | null): Promise<string> {
  const body = response ? await responseBody(response).catch(() => ({} as Record<string, unknown>)) : {};
  return updateErrors[String(body.error)] ?? "Update failed.";
}

async function resendAccess(user: OperatorRecord): Promise<ActionResult> {
  const response = await mutationFetch(`/api/users/${user.id}/resend-access`, { method: "POST" }).catch(() => null);
  return response?.ok ? { message: "Access email sent." } : { error: "The access email could not be sent." };
}

function workspaceAccess(user: OperatorRecord) {
  if (user.role === "Operator") return "All Workspaces";
  const names = user.accessGrants.map((grant) => grant.workspaceName).join(", ");
  return names ? <span className="block truncate" title={names}>{names}</span> : <Muted>None</Muted>;
}

interface UsersViewProps {
  currentUserId: string;
  initialUsers: OperatorRecord[];
  timeZone?: string;
}

export default function UsersView({ currentUserId, initialUsers, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone }: UsersViewProps) {
  const [users, setUsers] = useState<OperatorRecord[]>(initialUsers);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState<"All" | UserState>("All");
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize });
  const [provisionOpen, setProvisionOpen] = useState(false);
  const [manageUser, setManageUser] = useState<OperatorRecord | null>(null);
  const [provisionStatus, announceProvision] = useStatusMessage();
  const [deliveryWarning, setDeliveryWarning] = useState<OperatorRecord | null>(null);
  const [workspaceOptions, setWorkspaceOptions] = useState<WorkspaceOption[] | null>(null);
  const [workspaceOptionsError, setWorkspaceOptionsError] = useState(false);

  const loadWorkspaceOptions = useCallback(async () => {
    setWorkspaceOptionsError(false);
    try {
      const response = await fetch("/api/workspaces?state=Active&pageSize=50");
      if (!response.ok) throw new Error("Workspaces unavailable");
      const body = await responseBody(response);
      setWorkspaceOptions((body.workspaces as WorkspaceOption[]).map(({ id, name }) => ({ id, name })));
    } catch {
      setWorkspaceOptionsError(true);
    }
  }, []);

  const openManage = useCallback((user: OperatorRecord) => {
    setManageUser(user);
    void loadWorkspaceOptions();
  }, [loadWorkspaceOptions]);

  const loadUsers = async (quiet = false) => {
    if (!quiet) setLoading(true);
    setFetchError(false);
    try {
      const response = await fetch("/api/users");
      if (!response.ok) throw new Error("Users unavailable");
      const body = await responseBody(response);
      setUsers(Array.isArray(body.users) ? body.users as OperatorRecord[] : []);
    } catch {
      setFetchError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => void loadUsers(true), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const filteredUsers = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    return users.filter((user) => {
      const matchesSearch = !normalized || `${user.name} ${user.email}`.toLowerCase().includes(normalized);
      const matchesState = stateFilter === "All" || user.state === stateFilter;
      return matchesSearch && matchesState;
    });
  }, [search, stateFilter, users]);

  function resetPagination() {
    setPagination((current) => ({ ...current, pageIndex: 0 }));
  }

  const activeOperatorCount = users.filter((user) => user.state === "Active" && user.role === "Operator").length;
  const columns = useMemo<ColumnDef<DataGridFeatures, OperatorRecord>[]>(() => [
    {
      accessorKey: "name",
      header: "User",
      cell: ({ row }) => (
        <span className="block truncate" title={`${row.original.name} ${row.original.email}`}>
          <span className="font-medium">{row.original.name}</span> <span className="text-muted-foreground">{row.original.email}</span>
        </span>
      ),
      size: 280,
      meta: { skeleton: <Skeleton className="h-4 w-44" /> },
    },
    { accessorKey: "role", header: "Role", cell: ({ row }) => <Badge variant="outline">{row.original.role}</Badge>, size: 120 },
    { accessorKey: "state", header: "State", cell: ({ row }) => <Badge variant={stateVariant(row.original.state)}>{row.original.state}</Badge>, size: 120 },
    { id: "workspaceAccess", header: "Workspaces", cell: ({ row }) => workspaceAccess(row.original), size: 200 },
    {
      id: "lastSignIn",
      header: "Last Sign-In",
      cell: ({ row }) => {
        const signedIn = row.original.lastSignInAt;
        return signedIn ? (
          <span className="whitespace-nowrap tabular-nums" title={formatCallTime(signedIn, timeZone)}>{formatShortTime(signedIn, timeZone)}</span>
        ) : (
          <Muted>Never</Muted>
        );
      },
      size: 130,
    },
    {
      id: "provisionedBy",
      header: "Added By",
      cell: ({ row }) => (row.original.provisionedBy ? <span className="block truncate">{row.original.provisionedBy.name}</span> : <Muted>Initial setup</Muted>),
      size: 150,
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => <Button variant="ghost" size="sm" aria-label={`Manage ${row.original.name}`} onClick={() => openManage(row.original)}>Manage</Button>,
      size: 96,
    },
  ], [openManage, timeZone]);

  const table = useTable({
    features: dataGridFeatures,
    data: filteredUsers,
    columns,
    getRowId: (row) => row.id,
    state: { pagination },
    onPaginationChange: setPagination,
  });

  async function provisioned(user: OperatorRecord, deliveryFailed: boolean, role: CanonicalRole) {
    setProvisionOpen(false);
    await loadUsers(true);
    setDeliveryWarning(deliveryFailed ? user : null);
    announceProvision(`${role} provisioned.`);
  }

  const workspaceOptionsState = workspaceOptionsError
    ? <div className="flex items-center gap-3"><p role="alert" className="text-sm text-destructive">Workspaces are unavailable.</p><Button type="button" variant="outline" size="sm" onClick={() => void loadWorkspaceOptions()}>Retry</Button></div>
    : workspaceOptions === null
      ? <Skeleton className="h-8 w-full" />
      : null;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Users" description={`${activeOperatorCount} Active Operators, ${users.filter((user) => user.role === "Client Viewer").length} Client Viewers`}>
        <StatusMessage status={provisionStatus} className="text-sm text-muted-foreground" />
        <Button type="button" onClick={() => setProvisionOpen(true)}>Provision User</Button>
      </PageHeader>
      <Panel>
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          <Input
            type="search"
            aria-label="Search users"
            placeholder="Search name or email..."
            className="w-full sm:w-64"
            value={search}
            onChange={(event) => { setSearch(event.target.value); resetPagination(); }}
          />
          <Select value={stateFilter} onValueChange={(value) => { setStateFilter((value ?? "All") as "All" | UserState); resetPagination(); }}>
            <SelectTrigger className="w-40" aria-label="State"><SelectValue /></SelectTrigger>
            <SelectContent>{userStates.map((state) => <SelectItem key={state} value={state}>{state === "All" ? "All states" : state}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        {deliveryWarning || fetchError || (!loading && !filteredUsers.length) ? (
          <div className="flex flex-col gap-3 px-4 py-3">
            {deliveryWarning ? <DeliveryWarning key={deliveryWarning.id} user={deliveryWarning} /> : null}
            {fetchError ? <div className="flex items-center gap-3"><p role="alert" className="text-sm text-destructive">Users are unavailable.</p><Button type="button" variant="outline" onClick={() => void loadUsers()}>Retry</Button></div> : null}
            {!fetchError && !loading && !filteredUsers.length ? <div className="flex items-center gap-3"><p>No matching users.</p><Button type="button" variant="outline" onClick={() => { setSearch(""); setStateFilter("All"); }}>Clear Filters</Button></div> : null}
          </div>
        ) : null}
        {!fetchError && (loading || filteredUsers.length > 0) ? (
          <DataGrid table={table} recordCount={filteredUsers.length} isLoading={loading}>
            <DataGridScrollArea orientation="horizontal">
              <DataGridTable />
            </DataGridScrollArea>
            <div className="border-t border-border px-4 py-2">
              <DataGridPagination sizes={[pageSize]} />
            </div>
          </DataGrid>
        ) : null}
      </Panel>

      <Dialog open={provisionOpen} onOpenChange={setProvisionOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Provision User</DialogTitle><DialogDescription>Create Organization access for an Operator or a Client Viewer.</DialogDescription></DialogHeader>
          <ProvisionForm
            workspaceOptions={workspaceOptions}
            workspaceOptionsState={workspaceOptionsState}
            loadWorkspaceOptions={loadWorkspaceOptions}
            onProvisioned={provisioned}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(manageUser)} onOpenChange={(open) => { if (!open) setManageUser(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Manage {manageUser?.name}</DialogTitle><DialogDescription>{manageUser?.email}</DialogDescription></DialogHeader>
          {manageUser ? (
            <ManageUser
              key={manageUser.id}
              user={manageUser}
              timeZone={timeZone}
              lastActiveOperator={manageUser.state === "Active" && manageUser.role === "Operator" && activeOperatorCount === 1}
              workspaceOptions={workspaceOptions}
              workspaceOptionsState={workspaceOptionsState}
              onUserChange={setManageUser}
              reload={() => loadUsers(true)}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <span className="sr-only">Current user: {currentUserId}</span>
    </div>
  );
}

/** Names an access email that was not delivered, and confirms a resend in its place. */
function DeliveryWarning({ user }: { user: OperatorRecord }) {
  const resend = useAction();
  if (resend.status.text) return <StatusMessage status={resend.status} className="text-sm text-muted-foreground" />;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <p role="alert" className="text-sm text-destructive">Access email could not be delivered.</p>
      <ActionButton type="button" variant="outline" action={resend} onClick={() => void resend.run(() => resendAccess(user))}>Resend</ActionButton>
    </div>
  );
}

function ProvisionForm({
  workspaceOptions,
  workspaceOptionsState,
  loadWorkspaceOptions,
  onProvisioned,
}: {
  workspaceOptions: WorkspaceOption[] | null;
  workspaceOptionsState: ReactNode;
  loadWorkspaceOptions: () => Promise<void>;
  onProvisioned: (user: OperatorRecord, deliveryFailed: boolean, role: CanonicalRole) => Promise<void>;
}) {
  const [role, setRole] = useState<CanonicalRole>("Operator");
  const [workspaceIds, setWorkspaceIds] = useState<string[]>([]);
  const [workspaceError, setWorkspaceError] = useState("");
  const provision = useAction();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "");
    const name = String(form.get("name") ?? "");
    const sendEmail = form.get("sendEmail") === "on";
    setWorkspaceError("");
    if (role === "Client Viewer" && workspaceIds.length === 0) {
      setWorkspaceError(updateErrors.access_grant_required);
      return;
    }
    return provision.run(async () => {
      const response = await mutationFetch("/api/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          role === "Client Viewer"
            ? { email, name, role, sendEmail, workspaceIds }
            : { email, name, role, sendEmail },
        ),
      }).catch(() => null);
      if (!response) return { error: "Enter a valid email address." };
      const body = await responseBody(response);
      if (response.status === 409 && body.error === "duplicate_email") return { error: "This email is already provisioned." };
      if (body.error === "access_grant_required" || body.error === "workspace_not_grantable") return { error: updateErrors[String(body.error)] };
      if (!response.ok) return { error: "Enter a valid email address." };
      await onProvisioned(body.user as OperatorRecord, body.delivery === "failed", role);
    });
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
      <Field>
        <FieldLabel htmlFor="provision-email">Email</FieldLabel>
        <Input id="provision-email" name="email" type="email" required />
      </Field>
      <Field>
        <FieldLabel htmlFor="provision-name">Display name</FieldLabel>
        <Input id="provision-name" name="name" />
        <FieldDescription>Optional until first sign-in</FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor="provision-role">Role</FieldLabel>
        <Select value={role} onValueChange={(value) => {
          const next = (value ?? "Operator") as CanonicalRole;
          setRole(next);
          setWorkspaceError("");
          if (next === "Client Viewer") void loadWorkspaceOptions();
        }}>
          <SelectTrigger id="provision-role" aria-label="Role"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="Operator">Operator</SelectItem>
            <SelectItem value="Client Viewer">Client Viewer</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      {role === "Client Viewer" ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">Workspace Access</legend>
          {workspaceOptionsState}
          {workspaceOptions && !workspaceOptions.length ? <p className="text-sm text-muted-foreground">Activate a Workspace before provisioning a Client Viewer.</p> : null}
          {workspaceOptions?.map((workspace) => (
            <Field key={workspace.id} orientation="horizontal">
              <Checkbox
                id={`provision-workspace-${workspace.id}`}
                checked={workspaceIds.includes(workspace.id)}
                onCheckedChange={(checked) => setWorkspaceIds((current) => checked
                  ? [...current, workspace.id]
                  : current.filter((id) => id !== workspace.id))}
              />
              <FieldLabel htmlFor={`provision-workspace-${workspace.id}`}>{workspace.name}</FieldLabel>
            </Field>
          ))}
          <FieldDescription>Client Viewers read only the Active Workspaces granted here.</FieldDescription>
          {workspaceError ? <FieldError>{workspaceError}</FieldError> : null}
        </fieldset>
      ) : null}
      <Field orientation="horizontal">
        <Checkbox id="send-access-email" name="sendEmail" defaultChecked />
        <FieldLabel htmlFor="send-access-email">Send access-created email</FieldLabel>
      </Field>
      <DialogFooter><ActionButton type="submit" action={provision}>Provision</ActionButton></DialogFooter>
    </form>
  );
}

function ManageUser({
  user,
  timeZone,
  lastActiveOperator,
  workspaceOptions,
  workspaceOptionsState,
  onUserChange,
  reload,
}: {
  user: OperatorRecord;
  timeZone: string;
  lastActiveOperator: boolean;
  workspaceOptions: WorkspaceOption[] | null;
  workspaceOptionsState: ReactNode;
  onUserChange: (user: OperatorRecord) => void;
  reload: () => Promise<void>;
}) {
  const [grantWorkspaceId, setGrantWorkspaceId] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [confirmDisable, setConfirmDisable] = useState(false);
  const grantAdd = useAction();
  const grantRemove = useAction();
  const roleChange = useAction();
  const resend = useAction();
  const stateChange = useAction();
  const lastOperatorNote = useId();
  const lastGrantNote = useId();
  const lastAccessGrant = user.role === "Client Viewer" && user.accessGrants.length <= 1;
  const grantableWorkspaces = (workspaceOptions ?? []).filter((workspace) => !user.accessGrants.some((grant) => grant.workspaceId === workspace.id));
  const workspaceItems = Object.fromEntries(grantableWorkspaces.map((workspace) => [workspace.id, workspace.name]));
  const accessLabel = user.role === "Client Viewer" ? "Add Workspace Access" : "Workspace Access for Client Viewer";

  async function applyUserUpdate(path: string, init: RequestInit, message: string): Promise<ActionResult> {
    const response = await mutationFetch(path, init).catch(() => null);
    if (!response?.ok) return { error: await updateError(response) };
    const body = await responseBody(response);
    onUserChange(body.user as OperatorRecord);
    setGrantWorkspaceId(null);
    await reload();
    return { message };
  }

  function addAccess() {
    return grantAdd.run(() => applyUserUpdate(`/api/users/${user.id}/access-grants`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId: grantWorkspaceId }),
    }, "Access Grant added."));
  }

  function removeAccess(workspaceId: string) {
    setRemoving(workspaceId);
    return grantRemove.run(() => applyUserUpdate(`/api/users/${user.id}/access-grants/${workspaceId}`, { method: "DELETE" }, "Access Grant removed.")).finally(() => setRemoving(null));
  }

  function changeRole(role: CanonicalRole) {
    return roleChange.run(() => applyUserUpdate(`/api/users/${user.id}/role`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(role === "Client Viewer" && grantWorkspaceId ? { role, workspaceIds: [grantWorkspaceId] } : { role }),
    }, `Role changed to ${role}.`));
  }

  function updateState(nextState: "Active" | "Disabled") {
    return stateChange.run(async () => {
      const response = await mutationFetch(`/api/users/${user.id}/state`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state: nextState }),
      }).catch(() => null);
      if (!response?.ok) return { error: await updateError(response) };
      setConfirmDisable(false);
      onUserChange({ ...user, state: nextState });
      await reload();
      return { message: nextState === "Disabled" ? "User disabled." : "User re-enabled." };
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <FactList
        className="grid-cols-2"
        facts={[
          { label: "Role", value: <Badge variant="outline">{user.role}</Badge> },
          { label: "State", value: <Badge variant={stateVariant(user.state)}>{user.state}</Badge> },
          { label: "Last Sign-In", value: user.lastSignInAt ? formatCallTime(user.lastSignInAt, timeZone) : null, empty: "Never" },
          { label: "Added By", value: user.provisionedBy?.name ?? null, empty: "Initial setup" },
        ]}
      />
      {user.role === "Client Viewer" ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">Workspace Access</p>
          <ul className="flex flex-col gap-1">
            {user.accessGrants.map((grant) => (
              <li key={grant.workspaceId} className="flex items-center justify-between gap-2 text-sm">
                <span>{grant.workspaceName}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove ${grant.workspaceName}`}
                  aria-busy={removing === grant.workspaceId || undefined}
                  aria-describedby={lastAccessGrant ? lastGrantNote : undefined}
                  disabled={lastAccessGrant || removing === grant.workspaceId}
                  onClick={() => void removeAccess(grant.workspaceId)}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
          {lastAccessGrant ? <p id={lastGrantNote} className="text-xs text-muted-foreground">{updateErrors.last_access_grant}</p> : null}
          {grantRemove.error ? <p role="alert" className="text-sm text-destructive">{grantRemove.error}</p> : <StatusMessage status={grantRemove.status} className="text-sm text-muted-foreground" />}
        </div>
      ) : null}
      {user.role === "Client Viewer" || !user.accessGrants.length ? (
        <div className="flex flex-col gap-2">
          {workspaceOptionsState}
          <div className="flex flex-wrap items-end gap-2">
            <Field className="flex-1">
              <FieldLabel htmlFor="grant-workspace">{accessLabel}</FieldLabel>
              <Select items={workspaceItems} value={grantWorkspaceId} onValueChange={(value) => setGrantWorkspaceId(value)}>
                <SelectTrigger id="grant-workspace" aria-label={accessLabel} className="w-full"><SelectValue placeholder="Select a Workspace" /></SelectTrigger>
                <SelectContent>{grantableWorkspaces.map((workspace) => <SelectItem key={workspace.id} value={workspace.id}>{workspace.name}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            {user.role === "Client Viewer" ? (
              <ActionButton type="button" variant="outline" action={grantAdd} unavailable={grantWorkspaceId ? null : "Select a Workspace to add."} onClick={() => void addAccess()}>Add Access</ActionButton>
            ) : null}
          </div>
        </div>
      ) : null}
      <div className="flex flex-col gap-3 border-t border-border pt-4">
        {user.role === "Client Viewer" ? (
          <ActionButton type="button" variant="outline" action={roleChange} onClick={() => void changeRole("Operator")}>Make Operator</ActionButton>
        ) : (
          <ActionButton
            type="button"
            variant="outline"
            action={roleChange}
            disabled={lastActiveOperator}
            aria-describedby={lastActiveOperator ? lastOperatorNote : undefined}
            unavailable={!lastActiveOperator && !user.accessGrants.length && !grantWorkspaceId ? "Select a Workspace for Client Viewer access first." : null}
            onClick={() => void changeRole("Client Viewer")}
          >
            Make Client Viewer
          </ActionButton>
        )}
        {user.state === "Provisioned" ? (
          <ActionButton type="button" variant="outline" action={resend} onClick={() => void resend.run(() => resendAccess(user))}>Resend access instructions</ActionButton>
        ) : null}
        {user.state === "Disabled" ? (
          <ActionButton type="button" action={stateChange} onClick={() => void updateState("Active")}>Re-enable</ActionButton>
        ) : (
          <ActionButton
            type="button"
            variant="destructive"
            action={stateChange}
            disabled={lastActiveOperator}
            aria-describedby={lastActiveOperator ? lastOperatorNote : undefined}
            onClick={() => setConfirmDisable(true)}
          >
            Disable
          </ActionButton>
        )}
        {lastActiveOperator ? <p id={lastOperatorNote} className="text-xs text-muted-foreground">{updateErrors.last_active_operator}</p> : null}
      </div>

      <AlertDialog open={confirmDisable} onOpenChange={setConfirmDisable}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Disable {user.name}?</AlertDialogTitle><AlertDialogDescription>Active sessions are revoked immediately and sign-in is blocked.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><ActionButton type="button" action={stateChange} showConfirmation={false} onClick={() => void updateState("Disabled")}>Disable</ActionButton></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
