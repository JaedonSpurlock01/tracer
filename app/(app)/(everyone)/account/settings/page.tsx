/**
 * -------------------------------------------------------------------------
 * @file   page.tsx
 * @brief  Renders Tracer's Frame-led Account Settings surface.
 *
 * @description
 *  Loads authenticated profile, membership, and session data and
 *  renders one active settings section through the public auth APIs.
 *  Profile holds the display name and the chosen Gaze avatar seed, saved
 *  together; the seed is stored in the user's image field as a token.
 *  Preferences holds the color theme, applied at once and kept in a cookie,
 *  and the timezone, saved with Save preferences.
 *
 * @remarks
 *  Email, role, and User State are read-only account facts. Session identity
 *  is matched by token so current-session revocation is immediate and precise.
 *  The page sits directly in the shell's content padding, and each panel's
 *  header, fields, and footer share the panel's one content edge.
 *
 * @see
 *  DESIGN.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { Badge } from "@/components/reui/badge";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { AvatarPicker } from "@/components/tracer/avatar-picker";
import { ActionButton, SettingsSection, useAction, type ActionResult } from "@/components/tracer/form-parts";
import { FactList, PageHeader } from "@/components/tracer/page-parts";
import { ThemePicker } from "@/components/tracer/theme-picker";
import { isValidIanaTimezone, toCanonicalRole, type MembershipRole, type UserState } from "@/data/auth-policy";
import { avatarImageToken, avatarInitials, avatarSeedFromImage } from "@/data/avatar";

interface SessionRecord {
  id: string;
  token: string;
  userAgent?: string | null;
  ipAddress?: string | null;
  expiresAt: string;
}

interface AuthSession {
  user: { id: string; name: string; email: string; state: UserState; timezone: string; image?: string | null };
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
  const [avatarSeed, setAvatarSeed] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [securityLoading, setSecurityLoading] = useState(true);
  const [error, setError] = useState("");
  const [securityError, setSecurityError] = useState("");
  const [timezoneError, setTimezoneError] = useState("");
  const profileSave = useAction();
  const preferencesSave = useAction();
  const revokeOthers = useAction();

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
      setAvatarSeed(avatarSeedFromImage(current.user.image, current.user.id));
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
      setAvatarSeed(avatarSeedFromImage(current.user.image, current.user.id));
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

  function saveProfile() {
    return profileSave.run(async () => {
      const response = await fetch("/api/auth/update-user", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, image: avatarImageToken(avatarSeed) }),
      }).catch(() => null);
      if (!response?.ok) return { error: "Profile could not be saved." };
      // The Sidebar avatar is server-rendered; refresh so it shows the new style.
      router.refresh();
      return { message: "Profile saved." };
    });
  }

  function savePreferences() {
    setTimezoneError("");
    if (!isValidIanaTimezone(timezone)) {
      setTimezoneError("Enter a valid IANA timezone.");
      return;
    }
    return preferencesSave.run(async () => {
      const response = await fetch("/api/auth/update-user", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ timezone }),
      }).catch(() => null);
      return response?.ok ? { message: "Preferences saved." } : { error: "Preferences could not be saved." };
    });
  }

  async function revokeSession(token: string, current: boolean): Promise<ActionResult> {
    const response = await fetch("/api/auth/revoke-session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    }).catch(() => null);
    if (!response?.ok) return { error: "Session could not be revoked." };
    if (current) {
      window.sessionStorage.removeItem("tracer.pending-email");
      router.push("/sign-in");
      return;
    }
    await loadSecurity();
  }

  function revokeOtherSessions() {
    return revokeOthers.run(async () => {
      const response = await fetch("/api/auth/revoke-other-sessions", { method: "POST" }).catch(() => null);
      if (!response?.ok) return { error: "Other sessions could not be revoked." };
      await loadSecurity();
      return { message: "Other sessions revoked." };
    });
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
    return <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 md:flex-row"><Skeleton className="h-28 w-full md:w-48" /><Skeleton className="min-h-96 flex-1" /></div>;
  }
  if (error || !session) {
    return <div className="mx-auto flex w-full max-w-6xl flex-col items-start gap-3"><p role="alert">{error || "Redirecting to sign in."}</p><Button variant="outline" onClick={() => void loadSettings()}>Retry</Button></div>;
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <PageHeader title="Account Settings" description="Your profile, preferences, and sign-in sessions." />
      <div className="grid items-start gap-5 md:grid-cols-[12rem_1fr]">
        <nav aria-label="Account settings" className="min-w-0">
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
        </nav>
        <div className="flex min-w-0 flex-1 flex-col gap-5">
          {activeSection === "profile" ? (
            <SettingsSection
              title="Profile"
              description="Keep your display name and avatar up to date."
              footer={<ActionButton type="button" action={profileSave} onClick={() => void saveProfile()}>Save profile</ActionButton>}
            >
              <FactList
                className="sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]"
                facts={[
                  { label: "Email", value: session.user.email },
                  { label: "Role", value: role },
                  { label: "User State", value: <Badge variant={stateVariant(session.user.state)}>{session.user.state}</Badge> },
                ]}
              />
              <Field>
                <FieldLabel htmlFor="display-name">Display name</FieldLabel>
                <Input id="display-name" value={name} onChange={(event) => setName(event.target.value)} />
              </Field>
              <FieldSet className="gap-2">
                <FieldLegend variant="label" className="mb-0">Avatar</FieldLegend>
                <FieldDescription>Pick a face, or shuffle for new ones. Your name and email are never sent.</FieldDescription>
                <AvatarPicker initials={avatarInitials(name || session.user.name)} value={avatarSeed} onValueChange={setAvatarSeed} disabled={profileSave.pending} />
              </FieldSet>
            </SettingsSection>
          ) : null}
          {activeSection === "preferences" ? (
            <SettingsSection
              title="Preferences"
              description="Choose how Tracer looks and the timezone used for dates and times."
              footer={<ActionButton type="button" action={preferencesSave} onClick={() => void savePreferences()}>Save preferences</ActionButton>}
            >
              <FieldSet className="gap-2">
                <FieldLegend variant="label" className="mb-0">Theme</FieldLegend>
                <FieldDescription>Applies right away and is remembered on this browser.</FieldDescription>
                <ThemePicker />
              </FieldSet>
              <Field data-invalid={Boolean(timezoneError)}>
                <FieldLabel htmlFor="timezone">Timezone</FieldLabel>
                <Input id="timezone" value={timezone} onChange={(event) => setTimezone(event.target.value)} aria-invalid={Boolean(timezoneError)} />
                <FieldDescription>Preview: {preview}</FieldDescription>
                {timezoneError ? <FieldError>{timezoneError}</FieldError> : null}
              </Field>
            </SettingsSection>
          ) : null}
          {activeSection === "security" ? (
            <SettingsSection
              title="Security"
              description="Email code sign-in is available."
              footer={
                !securityLoading && !securityError ? (
                  <ActionButton type="button" variant="outline" action={revokeOthers} onClick={() => void revokeOtherSessions()} unavailable={otherSessions.length ? null : "No other sessions to revoke."}>Revoke other sessions</ActionButton>
                ) : null
              }
            >
              {securityLoading ? <div className="flex flex-col gap-3"><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /></div> : null}
              {!securityLoading && securityError ? <div className="flex flex-col items-start gap-3"><p role="alert">{securityError}</p><Button variant="outline" onClick={() => void loadSecurity()}>Retry</Button></div> : null}
              {!securityLoading && !securityError ? (
                <ul className="flex flex-col divide-y divide-border border-t border-border">
                  {currentSession ? (
                    <li className="flex items-center justify-between gap-4 py-3">
                      <div className="flex min-w-0 flex-col gap-0.5"><p className="text-sm font-medium">Current session</p><p className="truncate text-sm text-muted-foreground">{currentSession.userAgent || "This browser"}</p></div>
                      <AlertDialog>
                        <AlertDialogTrigger render={<Button type="button" variant="outline" />}>Revoke</AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader><AlertDialogTitle>Revoke current session?</AlertDialogTitle><AlertDialogDescription>You will return to Sign in on this browser.</AlertDialogDescription></AlertDialogHeader>
                          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><RevokeSessionButton variant="default" revoke={() => revokeSession(currentSession.token, true)}>Revoke session</RevokeSessionButton></AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </li>
                  ) : null}
                  {otherSessions.length ? otherSessions.map((value) => (
                    <li key={value.id} className="flex items-center justify-between gap-4 py-3">
                      <div className="flex min-w-0 flex-col gap-0.5"><p className="truncate text-sm">{value.userAgent || "Other session"}</p><p className="font-mono text-xs text-muted-foreground tabular-nums">Expires {new Date(value.expiresAt).toLocaleString()}</p></div>
                      <RevokeSessionButton revoke={() => revokeSession(value.token, false)}>Revoke</RevokeSessionButton>
                    </li>
                  )) : <li className="py-3 text-sm text-muted-foreground">No other active sessions.</li>}
                </ul>
              ) : null}
            </SettingsSection>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** One session's revoke with its own pending state and failure beside it. */
function RevokeSessionButton({ revoke, variant = "outline", children }: { revoke: () => Promise<ActionResult>; variant?: "default" | "outline"; children: ReactNode }) {
  const action = useAction();
  return (
    <ActionButton type="button" variant={variant} action={action} onClick={() => void action.run(revoke)}>
      {children}
    </ActionButton>
  );
}
