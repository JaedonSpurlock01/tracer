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
 *
 * @remarks
 *  Server authorization and validation remain authoritative for every action.
 *  The last sign-in shows the short time in the given timezone, falling back
 *  to the browser's, with the full timestamp as its hover title. Absent
 *  values are named: Never for a user who has not signed in, and Initial
 *  setup for the Operator the bootstrap script created.
 *
 * @see
 *  data/operator-administration-handler.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
"use client";

import { useCallback, useMemo, useState, useEffect, type FormEvent } from "react";
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
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCallTime, formatShortTime } from "@/components/tracer/call-format";
import { mutationFetch } from "@/components/tracer/mutation-fetch";
import { PageHeader, Panel } from "@/components/tracer/page-parts";
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
  const [confirmDisable, setConfirmDisable] = useState(false);
  const [actionError, setActionError] = useState("");
  const [status, setStatus] = useStatusMessage();
  const [deliveryWarning, setDeliveryWarning] = useState<OperatorRecord | null>(null);
  const [provisionRole, setProvisionRole] = useState<CanonicalRole>("Operator");
  const [provisionWorkspaceIds, setProvisionWorkspaceIds] = useState<string[]>([]);
  const [workspaceOptions, setWorkspaceOptions] = useState<WorkspaceOption[] | null>(null);
  const [workspaceOptionsError, setWorkspaceOptionsError] = useState(false);
  const [grantWorkspaceId, setGrantWorkspaceId] = useState<string | null>(null);

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
    setActionError("");
    setGrantWorkspaceId(null);
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

  async function provision(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const email = String(form.get("email") ?? "");
    const name = String(form.get("name") ?? "");
    const sendEmail = form.get("sendEmail") === "on";
    setActionError("");
    if (provisionRole === "Client Viewer" && provisionWorkspaceIds.length === 0) {
      setActionError(updateErrors.access_grant_required);
      return;
    }
    const response = await mutationFetch("/api/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        provisionRole === "Client Viewer"
          ? { email, name, role: provisionRole, sendEmail, workspaceIds: provisionWorkspaceIds }
          : { email, name, role: provisionRole, sendEmail },
      ),
    }).catch(() => null);
    if (!response) {
      setActionError("Enter a valid email address.");
      return;
    }
    const body = await responseBody(response);
    if (response.status === 409 && body.error === "duplicate_email") {
      setActionError("This email is already provisioned.");
      return;
    }
    if (body.error === "access_grant_required" || body.error === "workspace_not_grantable") {
      setActionError(updateErrors[String(body.error)]);
      return;
    }
    if (response.status === 400) {
      setActionError("Enter a valid email address.");
      return;
    }
    if (!response.ok) {
      setActionError("Enter a valid email address.");
      return;
    }
    setProvisionOpen(false);
    formElement.reset();
    setProvisionWorkspaceIds([]);
    await loadUsers(true);
    const user = body.user as OperatorRecord;
    if (body.delivery === "failed") {
      setDeliveryWarning(user);
    } else {
      setDeliveryWarning(null);
    }
    setStatus(`${provisionRole} provisioned.`);
  }

  async function applyUserUpdate(path: string, init: RequestInit, message: string) {
    setActionError("");
    const response = await mutationFetch(path, init).catch(() => null);
    if (!response?.ok) {
      setActionError(await updateError(response));
      return;
    }
    const body = await responseBody(response);
    setManageUser(body.user as OperatorRecord);
    setGrantWorkspaceId(null);
    await loadUsers(true);
    setStatus(message);
  }

  function addAccess(user: OperatorRecord) {
    if (!grantWorkspaceId) return;
    void applyUserUpdate(`/api/users/${user.id}/access-grants`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId: grantWorkspaceId }),
    }, "Access Grant added.");
  }

  function removeAccess(user: OperatorRecord, workspaceId: string) {
    void applyUserUpdate(`/api/users/${user.id}/access-grants/${workspaceId}`, { method: "DELETE" }, "Access Grant removed.");
  }

  function changeRole(user: OperatorRecord, role: CanonicalRole) {
    void applyUserUpdate(`/api/users/${user.id}/role`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(role === "Client Viewer" && grantWorkspaceId ? { role, workspaceIds: [grantWorkspaceId] } : { role }),
    }, `Role changed to ${role}.`);
  }

  async function resend(user: OperatorRecord) {
    const response = await mutationFetch(`/api/users/${user.id}/resend-access`, { method: "POST" }).catch(() => null);
    if (response?.ok) {
      setDeliveryWarning(null);
      setStatus("Access email sent.");
    } else {
      setActionError("Update failed.");
    }
  }

  async function updateState(user: OperatorRecord, nextState: "Active" | "Disabled") {
    setActionError("");
    const response = await mutationFetch(`/api/users/${user.id}/state`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state: nextState }),
    }).catch(() => null);
    if (!response?.ok) {
      setActionError("Update failed.");
      return;
    }
    setConfirmDisable(false);
    setManageUser(null);
    await loadUsers(true);
    setStatus(nextState === "Disabled" ? "User disabled." : "User re-enabled.");
  }

  const isLastActiveOperator = manageUser?.state === "Active" && manageUser.role === "Operator" && activeOperatorCount === 1;
  const isLastAccessGrant = manageUser?.role === "Client Viewer" && manageUser.accessGrants.length <= 1;
  const grantableWorkspaces = (workspaceOptions ?? []).filter(
    (workspace) => !manageUser?.accessGrants.some((grant) => grant.workspaceId === workspace.id),
  );
  const workspaceItems = Object.fromEntries(grantableWorkspaces.map((workspace) => [workspace.id, workspace.name]));
  const canDemote = !isLastActiveOperator && Boolean(manageUser?.accessGrants.length || grantWorkspaceId);
  const workspaceOptionsState = workspaceOptionsError
    ? <div className="flex items-center gap-3"><p role="alert">Workspaces are unavailable.</p><Button type="button" variant="outline" size="sm" onClick={() => void loadWorkspaceOptions()}>Retry</Button></div>
    : workspaceOptions === null
      ? <Skeleton className="h-8 w-full" />
      : null;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Users" description={`${activeOperatorCount} Active Operators, ${users.filter((user) => user.role === "Client Viewer").length} Client Viewers`}>
        <Button type="button" onClick={() => { setProvisionOpen(true); setActionError(""); setProvisionRole("Operator"); setProvisionWorkspaceIds([]); }}>Provision User</Button>
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
        {status.text || deliveryWarning || fetchError || (!loading && !filteredUsers.length) ? (
          <div className="flex flex-col gap-3 px-4 py-3">
            <StatusMessage status={status} />
            {deliveryWarning ? <div className="flex items-center gap-3"><p role="alert">Access email could not be delivered.</p><Button type="button" variant="outline" onClick={() => void resend(deliveryWarning)}>Resend</Button></div> : null}
            {fetchError ? <div className="flex items-center gap-3"><p role="alert">Users are unavailable.</p><Button type="button" variant="outline" onClick={() => void loadUsers()}>Retry</Button></div> : null}
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
          <form className="flex flex-col gap-4" onSubmit={(event) => void provision(event)}>
            <Field data-invalid={Boolean(actionError)}>
              <FieldLabel htmlFor="provision-email">Email</FieldLabel>
              <Input id="provision-email" name="email" type="email" required />
              {actionError ? <FieldError>{actionError}</FieldError> : null}
            </Field>
            <Field>
              <FieldLabel htmlFor="provision-name">Display name</FieldLabel>
              <Input id="provision-name" name="name" />
              <FieldDescription>Optional until first sign-in</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="provision-role">Role</FieldLabel>
              <Select value={provisionRole} onValueChange={(value) => {
                const role = (value ?? "Operator") as CanonicalRole;
                setProvisionRole(role);
                setActionError("");
                if (role === "Client Viewer") void loadWorkspaceOptions();
              }}>
                <SelectTrigger id="provision-role" aria-label="Role"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Operator">Operator</SelectItem>
                  <SelectItem value="Client Viewer">Client Viewer</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            {provisionRole === "Client Viewer" ? (
              <fieldset className="flex flex-col gap-2">
                <legend className="text-sm font-medium">Workspace Access</legend>
                {workspaceOptionsState}
                {workspaceOptions && !workspaceOptions.length ? <p className="text-sm text-muted-foreground">Activate a Workspace before provisioning a Client Viewer.</p> : null}
                {workspaceOptions?.map((workspace) => (
                  <Field key={workspace.id} orientation="horizontal">
                    <Checkbox
                      id={`provision-workspace-${workspace.id}`}
                      checked={provisionWorkspaceIds.includes(workspace.id)}
                      onCheckedChange={(checked) => setProvisionWorkspaceIds((current) => checked
                        ? [...current, workspace.id]
                        : current.filter((id) => id !== workspace.id))}
                    />
                    <FieldLabel htmlFor={`provision-workspace-${workspace.id}`}>{workspace.name}</FieldLabel>
                  </Field>
                ))}
                <FieldDescription>Client Viewers read only the Active Workspaces granted here.</FieldDescription>
              </fieldset>
            ) : null}
            <Field orientation="horizontal">
              <Checkbox id="send-access-email" name="sendEmail" defaultChecked />
              <FieldLabel htmlFor="send-access-email">Send access-created email</FieldLabel>
            </Field>
            <DialogFooter><Button type="submit">Provision</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(manageUser)} onOpenChange={(open) => { if (!open) setManageUser(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Manage {manageUser?.name}</DialogTitle><DialogDescription>{manageUser?.email}</DialogDescription></DialogHeader>
          {manageUser ? <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2"><Badge variant="outline">{manageUser.role}</Badge><Badge variant={stateVariant(manageUser.state)}>{manageUser.state}</Badge></div>
            <dl className="grid gap-2 text-sm"><div><dt className="text-muted-foreground">Last Sign-In</dt><dd>{manageUser.lastSignInAt ? formatCallTime(manageUser.lastSignInAt, timeZone) : <Muted>Never</Muted>}</dd></div><div><dt className="text-muted-foreground">Added By</dt><dd>{manageUser.provisionedBy?.name ?? <Muted>Initial setup</Muted>}</dd></div></dl>
            {actionError ? <p role="alert">{actionError}</p> : null}
            {isLastActiveOperator ? <p>{updateErrors.last_active_operator}</p> : null}
            {manageUser.role === "Client Viewer" ? (
              <div className="flex flex-col gap-2">
                <p className="text-sm font-medium">Workspace Access</p>
                <ul className="flex flex-col gap-1">
                  {manageUser.accessGrants.map((grant) => (
                    <li key={grant.workspaceId} className="flex items-center justify-between gap-2 text-sm">
                      <span>{grant.workspaceName}</span>
                      <Button type="button" variant="ghost" size="sm" aria-label={`Remove ${grant.workspaceName}`} disabled={isLastAccessGrant} onClick={() => removeAccess(manageUser, grant.workspaceId)}>Remove</Button>
                    </li>
                  ))}
                </ul>
                {isLastAccessGrant ? <p className="text-sm text-muted-foreground">{updateErrors.last_access_grant}</p> : null}
              </div>
            ) : null}
            {manageUser.role === "Client Viewer" || !manageUser.accessGrants.length ? (
              <div className="flex flex-col gap-2">
                {workspaceOptionsState}
                <div className="flex items-end gap-2">
                  <Field className="flex-1">
                    <FieldLabel htmlFor="grant-workspace">{manageUser.role === "Client Viewer" ? "Add Workspace Access" : "Workspace Access for Client Viewer"}</FieldLabel>
                    <Select items={workspaceItems} value={grantWorkspaceId} onValueChange={(value) => setGrantWorkspaceId(value)}>
                      <SelectTrigger id="grant-workspace" aria-label={manageUser.role === "Client Viewer" ? "Add Workspace Access" : "Workspace Access for Client Viewer"} className="w-full"><SelectValue placeholder="Select a Workspace" /></SelectTrigger>
                      <SelectContent>{grantableWorkspaces.map((workspace) => <SelectItem key={workspace.id} value={workspace.id}>{workspace.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </Field>
                  {manageUser.role === "Client Viewer" ? <Button type="button" variant="outline" disabled={!grantWorkspaceId} onClick={() => addAccess(manageUser)}>Add Access</Button> : null}
                </div>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {manageUser.role === "Client Viewer"
                ? <Button type="button" variant="outline" onClick={() => changeRole(manageUser, "Operator")}>Make Operator</Button>
                : <Button type="button" variant="outline" disabled={!canDemote} onClick={() => changeRole(manageUser, "Client Viewer")}>Make Client Viewer</Button>}
              {manageUser.state === "Provisioned" ? <Button type="button" variant="outline" onClick={() => void resend(manageUser)}>Resend access instructions</Button> : null}
              {manageUser.state === "Disabled" ? <Button type="button" onClick={() => void updateState(manageUser, "Active")}>Re-enable</Button> : <Button type="button" variant="destructive" disabled={isLastActiveOperator} onClick={() => setConfirmDisable(true)}>Disable</Button>}
            </div>
          </div> : null}
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDisable} onOpenChange={setConfirmDisable}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Disable {manageUser?.name}?</AlertDialogTitle><AlertDialogDescription>Active sessions are revoked immediately and sign-in is blocked.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => manageUser && void updateState(manageUser, "Disabled")}>Disable</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <span className="sr-only">Current user: {currentUserId}</span>
    </div>
  );
}
