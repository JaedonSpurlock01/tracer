/**
 * -------------------------------------------------------------------------
 * @file   users-view.tsx
 * @brief  Renders the Operator Users Data Grid and management dialogs.
 *
 * @description
 *  Loads Organization users, provides client-side search and User State
 *  filtering, and manages provisioning, delivery, and state actions.
 *
 * @remarks
 *  Server authorization and validation remain authoritative for every action.
 *
 * @see
 *  data/operator-administration-handler.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
"use client";

import { useMemo, useState, useEffect, type FormEvent } from "react";
import { useTable, type ColumnDef, type PaginationState } from "@tanstack/react-table";

import { Badge } from "@/components/reui/badge";
import { Frame, FramePanel } from "@/components/reui/frame";
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
import type { UserState } from "@/data/auth-policy";
import type { OperatorRecord } from "@/data/operator-administration";

const pageSize = 10;
const userStates: Array<"All" | UserState> = ["All", "Provisioned", "Active", "Disabled"];

function stateVariant(state: UserState): "primary-light" | "success-light" | "destructive-light" {
  if (state === "Active") return "success-light";
  if (state === "Disabled") return "destructive-light";
  return "primary-light";
}

function formatSignIn(value: string | null): string {
  return value
    ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
    : "Never";
}

function responseBody(response: Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>;
}

interface UsersViewProps {
  currentUserId: string;
}

export default function UsersView({ currentUserId }: UsersViewProps) {
  const [users, setUsers] = useState<OperatorRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState<"All" | UserState>("All");
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize });
  const [provisionOpen, setProvisionOpen] = useState(false);
  const [manageUser, setManageUser] = useState<OperatorRecord | null>(null);
  const [confirmDisable, setConfirmDisable] = useState(false);
  const [actionError, setActionError] = useState("");
  const [status, setStatus] = useState("");
  const [deliveryWarning, setDeliveryWarning] = useState<OperatorRecord | null>(null);

  const loadUsers = async () => {
    setLoading(true);
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
    const timer = window.setTimeout(() => void loadUsers(), 0);
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
      cell: ({ row }) => <div><p className="font-medium">{row.original.name}</p><p className="text-xs text-muted-foreground">{row.original.email}</p></div>,
      meta: { skeleton: <Skeleton className="h-8 w-44" /> },
    },
    { accessorKey: "role", header: "Role", cell: ({ row }) => <Badge variant="outline">{row.original.role}</Badge> },
    { accessorKey: "state", header: "User State", cell: ({ row }) => <Badge variant={stateVariant(row.original.state)}>{row.original.state}</Badge> },
    { id: "workspaceAccess", header: "Workspace Access", cell: ({ row }) => row.original.role === "Operator" ? "All Workspaces" : "None" },
    { id: "lastSignIn", header: "Last Sign-In", cell: ({ row }) => formatSignIn(row.original.lastSignInAt) },
    { id: "provisionedBy", header: "Provisioned By", cell: ({ row }) => row.original.provisionedBy?.name ?? "Bootstrap" },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => <Button variant="ghost" size="sm" aria-label={`Manage ${row.original.name}`} onClick={() => { setManageUser(row.original); setActionError(""); }}>Manage</Button>,
    },
  ], []);

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
    const response = await fetch("/api/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, name, role: "Operator", sendEmail }),
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
    await loadUsers();
    const user = body.user as OperatorRecord;
    if (body.delivery === "failed") {
      setDeliveryWarning(user);
    } else {
      setDeliveryWarning(null);
    }
    setStatus("Operator provisioned.");
  }

  async function resend(user: OperatorRecord) {
    const response = await fetch(`/api/users/${user.id}/resend-access`, { method: "POST" }).catch(() => null);
    if (response?.ok) {
      setDeliveryWarning(null);
      setStatus("Access email sent.");
    } else {
      setActionError("Update failed.");
    }
  }

  async function updateState(user: OperatorRecord, nextState: "Active" | "Disabled") {
    setActionError("");
    const response = await fetch(`/api/users/${user.id}/state`, {
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
    await loadUsers();
    setStatus(nextState === "Disabled" ? "Operator disabled." : "Operator re-enabled.");
  }

  const isLastActiveOperator = manageUser?.state === "Active" && manageUser.role === "Operator" && activeOperatorCount === 1;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
        <p className="text-sm text-muted-foreground">{activeOperatorCount} Active Operators, {users.filter((user) => user.role === "Client Viewer").length} Client Viewers</p>
      </div>
      <Frame>
        <FramePanel className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <Field className="min-w-56 flex-1">
              <FieldLabel htmlFor="search-users">Search</FieldLabel>
              <Input id="search-users" aria-label="Search users" value={search} onChange={(event) => { setSearch(event.target.value); resetPagination(); }} />
            </Field>
            <Field className="w-44">
              <FieldLabel htmlFor="user-state">User State</FieldLabel>
              <Select value={stateFilter} onValueChange={(value) => { setStateFilter((value ?? "All") as "All" | UserState); resetPagination(); }}>
                <SelectTrigger id="user-state" aria-label="User State"><SelectValue /></SelectTrigger>
                <SelectContent>{userStates.map((state) => <SelectItem key={state} value={state}>{state}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Button type="button" onClick={() => { setProvisionOpen(true); setActionError(""); }}>Provision User</Button>
          </div>
          {status ? <p role="status">{status}</p> : null}
          {deliveryWarning ? <div className="flex items-center gap-3"><p role="alert">Access email could not be delivered.</p><Button type="button" variant="outline" onClick={() => void resend(deliveryWarning)}>Resend</Button></div> : null}
          {fetchError ? <div className="flex items-center gap-3"><p role="alert">Users are unavailable.</p><Button type="button" variant="outline" onClick={() => void loadUsers()}>Retry</Button></div> : null}
          {!fetchError && !loading && !filteredUsers.length ? <div className="flex items-center gap-3"><p>No matching users.</p><Button type="button" variant="outline" onClick={() => { setSearch(""); setStateFilter("All"); }}>Clear Filters</Button></div> : null}
          {!fetchError && (loading || filteredUsers.length > 0) ? (
            <DataGrid table={table} recordCount={filteredUsers.length} isLoading={loading}>
              <DataGridScrollArea orientation="horizontal">
                <DataGridTable />
              </DataGridScrollArea>
              <DataGridPagination sizes={[pageSize]} />
            </DataGrid>
          ) : null}
        </FramePanel>
      </Frame>

      <Dialog open={provisionOpen} onOpenChange={setProvisionOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Provision User</DialogTitle><DialogDescription>Create Organization access for an Operator.</DialogDescription></DialogHeader>
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
              <Select defaultValue="Operator">
                <SelectTrigger id="provision-role" aria-label="Role"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Operator">Operator</SelectItem>
                  <SelectItem value="Client Viewer" disabled>Client Viewer</SelectItem>
                </SelectContent>
              </Select>
              <FieldDescription>Client Viewer provisioning arrives after Workspaces exist.</FieldDescription>
            </Field>
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
            <dl className="grid gap-2 text-sm"><div><dt className="text-muted-foreground">Last Sign-In</dt><dd>{formatSignIn(manageUser.lastSignInAt)}</dd></div><div><dt className="text-muted-foreground">Provisioned By</dt><dd>{manageUser.provisionedBy?.name ?? "Bootstrap"}</dd></div></dl>
            {actionError ? <p role="alert">{actionError}</p> : null}
            {isLastActiveOperator ? <p>The last Active Operator cannot be disabled.</p> : null}
            <div className="flex flex-wrap gap-2">
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
