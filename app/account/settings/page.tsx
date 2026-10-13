/**
 * -------------------------------------------------------------------------
 * @file   page.tsx
 * @brief  Renders Tracer's Frame-led Account Settings surface.
 *
 * @description
 *  Loads authenticated profile, membership, and session data and
 *  renders one active settings section through the public auth APIs.
 *
 * @remarks
 *  Email, role, and User State are read-only account facts. Session identity
 *  is matched by token so current-session revocation is immediate and precise.
 *
 * @see
 *  DESIGN.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/reui/badge";
import {
  Frame,
  FrameDescription,
  FrameFooter,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from "@/components/reui/frame";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { isValidIanaTimezone, toCanonicalRole, type MembershipRole, type UserState } from "@/data/auth-policy";

interface SessionRecord {
  id: string;
  token: string;
  userAgent?: string | null;
  ipAddress?: string | null;
  expiresAt: string;
}

interface AuthSession {
  user: { id: string; name: string; email: string; state: UserState; timezone: string };
  session: { token: string };
}

type Section = "profile" | "preferences" | "security";

const sections: Array<{ id: Section; label: string }> = [
  { id: "profile", label: "Profile" },
  { id: "preferences", label: "Preferences" },
  { id: "security", label: "Security" },
];

function stateVariant(state: UserState): "primary-light" | "success-light" | "destructive-light" {
  if (state === "Active") return "success-light";
  if (state === "Disabled") return "destructive-light";
  return "primary-light";
}

export default function AccountSettingsPage() {
  const router = useRouter();
  const [activeSection, setActiveSection] = useState<Section>("profile");
  const [session, setSession] = useState<AuthSession | null>(null);
  const [role, setRole] = useState<"Operator" | "Client Viewer">("Operator");
  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [securityLoading, setSecurityLoading] = useState(true);
  const [error, setError] = useState("");
  const [securityError, setSecurityError] = useState("");
  const [profileMessage, setProfileMessage] = useState("");
  const [preferencesMessage, setPreferencesMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const loadSecurity = useCallback(async () => {
    setSecurityLoading(true);
    setSecurityError("");
    try {
      const [sessionResponse, sessionsResponse] = await Promise.all([
        fetch("/api/auth/get-session"),
        fetch("/api/auth/list-sessions"),
      ]);
      if (!sessionResponse.ok || !sessionsResponse.ok) {
        throw new Error("Security data unavailable");
      }
      const current = (await sessionResponse.json()) as AuthSession | null;
      if (!current?.user || !current.session?.token) {
        router.push("/sign-in");
        return;
      }
      const sessionValue = (await sessionsResponse.json()) as SessionRecord[];
      setSession(current);
      setName(current.user.name);
      setTimezone(current.user.timezone);
      setSessions(Array.isArray(sessionValue) ? sessionValue : []);
    } catch {
      setSecurityError("Security data is unavailable.");
    } finally {
      setSecurityLoading(false);
    }
  }, [router]);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/auth/get-session");
      if (!response.ok) throw new Error("Session unavailable");
      const current = (await response.json()) as AuthSession | null;
      if (!current?.user || !current.session?.token) {
        router.push("/sign-in");
        return;
      }
      const organizationResponse = await fetch("/api/auth/organization/get-full-organization?organizationSlug=spurlock-labs");
      if (!organizationResponse.ok) throw new Error("Membership unavailable");
      const organization = (await organizationResponse.json()) as { members?: Array<{ user?: { id?: string }; role?: MembershipRole }> } | null;
      const membership = organization?.members?.find((member) => member.user?.id === current.user.id);
      if (!membership?.role) throw new Error("Membership unavailable");
      setSession(current);
      setName(current.user.name);
      setTimezone(current.user.timezone);
      setRole(toCanonicalRole(membership.role));
      await loadSecurity();
    } catch {
      setError("Settings are unavailable.");
    } finally {
      setLoading(false);
    }
  }, [loadSecurity, router]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadSettings(), 0);
    return () => window.clearTimeout(timer);
  }, [loadSettings]);

  async function saveProfile() {
    setBusy(true);
    setProfileMessage("");
    try {
      const response = await fetch("/api/auth/update-user", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      setProfileMessage(response.ok ? "Profile saved." : "Profile could not be saved.");
    } catch {
      setProfileMessage("Profile could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function savePreferences() {
    setPreferencesMessage("");
    if (!isValidIanaTimezone(timezone)) {
      setPreferencesMessage("Enter a valid IANA timezone.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/auth/update-user", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ timezone }),
      });
      setPreferencesMessage(response.ok ? "Preferences saved." : "Preferences could not be saved.");
    } catch {
      setPreferencesMessage("Preferences could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function revokeSession(token: string, current: boolean) {
    setSecurityError("");
    const response = await fetch("/api/auth/revoke-session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    }).catch(() => null);
    if (!response?.ok) {
      setSecurityError("Session could not be revoked. Retry.");
      return;
    }
    if (current) {
      window.sessionStorage.removeItem("tracer.pending-email");
      router.push("/sign-in");
      return;
    }
    await loadSecurity();
  }

  async function revokeOtherSessions() {
    setSecurityError("");
    const response = await fetch("/api/auth/revoke-other-sessions", { method: "POST" }).catch(() => null);
    if (!response?.ok) {
      setSecurityError("Other sessions could not be revoked. Retry.");
      return;
    }
    await loadSecurity();
  }

  const preview = useMemo(() => {
    try {
      return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: timezone }).format(new Date());
    } catch {
      return "Enter a valid IANA timezone";
    }
  }, [timezone]);
  const currentToken = session?.session.token;
  const currentSession = sessions.find((value) => value.token === currentToken);
  const otherSessions = sessions.filter((value) => value.token !== currentToken);

  if (loading) {
    return <main className="mx-auto flex min-h-screen w-full max-w-5xl gap-6 px-6 py-12"><Skeleton className="h-40 w-44" /><Skeleton className="min-h-96 flex-1" /></main>;
  }
  if (error || !session) {
    return <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-4 px-6 py-12"><p role="alert">{error || "Redirecting to sign in."}</p><Button variant="outline" onClick={() => void loadSettings()}>Retry</Button></main>;
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-6 px-6 py-12 md:flex-row">
      <aside className="w-full shrink-0 md:w-44">
        <div className="flex min-w-max flex-row gap-1 overflow-x-auto md:min-w-0 md:flex-col">
          {sections.map((section) => (
            <Button
              key={section.id}
              type="button"
              variant={activeSection === section.id ? "secondary" : "ghost"}
              aria-current={activeSection === section.id ? "page" : undefined}
              className="justify-start"
              onClick={() => setActiveSection(section.id)}
            >
              {section.label}
            </Button>
          ))}
        </div>
      </aside>
      <Frame className="min-w-0 flex-1" spacing="default">
        {activeSection === "profile" ? (
          <FramePanel>
            <FrameHeader>
              <FrameTitle>Profile</FrameTitle>
              <FrameDescription>Keep your display name up to date.</FrameDescription>
            </FrameHeader>
            <div className="flex flex-col gap-5">
              <Field>
                <FieldLabel htmlFor="display-name">Display name</FieldLabel>
                <Input id="display-name" value={name} onChange={(event) => setName(event.target.value)} />
              </Field>
              <Field>
                <FieldLabel htmlFor="account-email">Email</FieldLabel>
                <Input id="account-email" value={session.user.email} readOnly />
              </Field>
              <Field>
                <FieldLabel htmlFor="account-role">Role</FieldLabel>
                <Input id="account-role" value={role} readOnly />
              </Field>
              <Field>
                <FieldLabel>User State</FieldLabel>
                <Badge variant={stateVariant(session.user.state)}>{session.user.state}</Badge>
              </Field>
            </div>
            <FrameFooter>
              <Button type="button" onClick={() => void saveProfile()} disabled={busy}>Save profile</Button>
              {profileMessage ? <FieldDescription role="status">{profileMessage}</FieldDescription> : null}
            </FrameFooter>
          </FramePanel>
        ) : null}
        {activeSection === "preferences" ? (
          <FramePanel>
            <FrameHeader>
              <FrameTitle>Preferences</FrameTitle>
              <FrameDescription>Choose the IANA timezone used for dates and times.</FrameDescription>
            </FrameHeader>
            <div className="flex flex-col gap-5">
              <Field data-invalid={Boolean(preferencesMessage && !isValidIanaTimezone(timezone))}>
                <FieldLabel htmlFor="timezone">Timezone</FieldLabel>
                <Input id="timezone" value={timezone} onChange={(event) => setTimezone(event.target.value)} aria-invalid={Boolean(preferencesMessage && !isValidIanaTimezone(timezone))} />
                <FieldDescription>Preview: {preview}</FieldDescription>
                {preferencesMessage && !isValidIanaTimezone(timezone) ? <FieldError>{preferencesMessage}</FieldError> : null}
              </Field>
            </div>
            <FrameFooter>
              <Button type="button" onClick={() => void savePreferences()} disabled={busy}>Save preferences</Button>
              {preferencesMessage && isValidIanaTimezone(timezone) ? <FieldDescription role="status">{preferencesMessage}</FieldDescription> : null}
            </FrameFooter>
          </FramePanel>
        ) : null}
        {activeSection === "security" ? (
          <FramePanel>
            <FrameHeader>
              <FrameTitle>Security</FrameTitle>
              <FrameDescription>Email code sign-in is available.</FrameDescription>
            </FrameHeader>
            {securityLoading ? <div className="flex flex-col gap-3"><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /></div> : null}
            {!securityLoading && securityError ? <div className="flex flex-col gap-3"><p role="alert">{securityError}</p><Button variant="outline" onClick={() => void loadSecurity()}>Retry</Button></div> : null}
            {!securityLoading && !securityError ? (
              <div className="flex flex-col gap-5">
                {currentSession ? (
                  <div className="flex items-center justify-between gap-4 border-b border-border py-3">
                    <div><p className="font-medium">Current session</p><p className="text-sm text-muted-foreground">{currentSession.userAgent || "This browser"}</p></div>
                    <AlertDialog>
                      <AlertDialogTrigger render={<Button type="button" variant="outline" />}>Revoke</AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader><AlertDialogTitle>Revoke current session?</AlertDialogTitle><AlertDialogDescription>You will return to Sign in on this browser.</AlertDialogDescription></AlertDialogHeader>
                        <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => void revokeSession(currentSession.token, true)}>Revoke session</AlertDialogAction></AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                ) : null}
                {otherSessions.length ? otherSessions.map((value) => (
                  <div key={value.id} className="flex items-center justify-between gap-4 border-b border-border py-3">
                    <div><p>{value.userAgent || "Other session"}</p><p className="text-sm text-muted-foreground">Expires {new Date(value.expiresAt).toLocaleString()}</p></div>
                    <Button type="button" variant="outline" onClick={() => void revokeSession(value.token, false)}>Revoke</Button>
                  </div>
                )) : <p className="text-sm text-muted-foreground">No other active sessions.</p>}
                <Button type="button" variant="outline" onClick={() => void revokeOtherSessions()} disabled={!otherSessions.length}>Revoke other sessions</Button>
              </div>
            ) : null}
          </FramePanel>
        ) : null}
      </Frame>
    </main>
  );
}
