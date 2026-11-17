"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/AppShell";
import { InfoHint } from "@/components/InfoHint";
import { Card, SectionTitle, PrimaryButton } from "@/components/ui";

function Switch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
        checked ? "bg-accent" : "bg-border"
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-5" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

export default function AccountPage() {
  const me = useQuery(api.users.me);
  const updateMe = useMutation(api.users.updateMe);
  const updatePrefs = useMutation(api.users.updatePrefs);

  const [name, setName] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (me) setName(me.name);
  }, [me?.name]);

  const notifyEmail = me?.notifyEmail !== false;
  const notifyInApp = me?.notifyInApp !== false;
  // Lateness emails default OFF (opt-in). Only relevant to people who approve.
  const notifyLatenessEmail = me?.notifyLatenessEmail === true;
  const isApprover =
    me?.role === "admin" ||
    me?.role === "superadmin" ||
    me?.role === "office_manager";

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await updateMe({ name: name.trim() });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <AppShell
      title="Account"
      titleInfo={<InfoHint>Manage your profile and notifications.</InfoHint>}
    >

      <div className="grid max-w-xl gap-6">
        <Card>
          <SectionTitle>Profile</SectionTitle>
          <form onSubmit={saveName} className="space-y-3">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-foreground">
                Display name
              </span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-foreground"
              />
            </label>
            <div className="text-sm text-muted">
              Signed in as {me?.email}
              <span className="ml-2 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium capitalize text-accent">
                {me?.role}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <PrimaryButton type="submit" disabled={!name.trim()}>
                Save
              </PrimaryButton>
              {saved && (
                <span className="text-sm text-emerald-600 dark:text-emerald-400">
                  Saved
                </span>
              )}
            </div>
          </form>
        </Card>

        <Card>
          <SectionTitle>Notifications</SectionTitle>
          <div className="divide-y divide-border">
            <div className="flex items-center justify-between py-3">
              <div>
                <div className="text-sm font-medium text-foreground">
                  In-app notifications
                </div>
                <div className="text-xs text-muted">
                  Show the bell badge for leave requests and decisions.
                </div>
              </div>
              <Switch
                checked={notifyInApp}
                onChange={(v) => void updatePrefs({ notifyInApp: v })}
              />
            </div>
            <div className="flex items-center justify-between py-3">
              <div>
                <div className="text-sm font-medium text-foreground">
                  Email notifications
                </div>
                <div className="text-xs text-muted">
                  Get an email when something needs your attention.
                </div>
              </div>
              <Switch
                checked={notifyEmail}
                onChange={(v) => void updatePrefs({ notifyEmail: v })}
              />
            </div>
            {isApprover && (
              <div className="flex items-center justify-between py-3">
                <div>
                  <div className="text-sm font-medium text-foreground">
                    Late-arrival emails
                  </div>
                  <div className="text-xs text-muted">
                    Email me when someone I manage logs a late arrival. You
                    always get the in-app notification.
                  </div>
                </div>
                <Switch
                  checked={notifyLatenessEmail}
                  onChange={(v) =>
                    void updatePrefs({ notifyLatenessEmail: v })
                  }
                />
              </div>
            )}
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
