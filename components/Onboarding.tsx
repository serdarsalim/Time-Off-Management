"use client";

import { useState } from "react";
import Image from "next/image";
import { BRAND } from "@/lib/brand";
import { useMutation } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "@/convex/_generated/api";

type Me = {
  firstName?: string;
  lastName?: string;
  phone?: string;
  email: string;
  status?: "pending" | "active" | "rejected";
} | null;

export function Onboarding({ me }: { me: Me }) {
  const { signOut } = useAuthActions();
  const completeProfile = useMutation(api.users.completeProfile);

  const [firstName, setFirstName] = useState(me?.firstName ?? "");
  const [lastName, setLastName] = useState(me?.lastName ?? "");
  const [phone, setPhone] = useState(me?.phone ?? "");
  const [busy, setBusy] = useState(false);
  const submitted = !!(me?.firstName && me?.lastName && me?.phone);

  const inputCls =
    "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-foreground";

  if (me?.status === "rejected") {
    return (
      <Shell>
        <h1 className="text-xl font-semibold text-foreground">
          Access not granted
        </h1>
        <p className="mt-2 text-sm text-muted">
          Your request to join wasn't approved. If you think this is a mistake,
          contact your administrator.
        </p>
        <button
          onClick={() => void signOut()}
          className="mt-4 text-sm text-accent hover:underline"
        >
          Sign out
        </button>
      </Shell>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim() || !phone.trim()) return;
    setBusy(true);
    try {
      await completeProfile({ firstName, lastName, phone });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      <h1 className="text-xl font-semibold text-foreground">
        {submitted ? "You're almost in" : "Complete your profile"}
      </h1>
      <p className="mt-1 text-sm text-muted">
        {submitted
          ? "Your details are in — an administrator just needs to approve your account. You can update them below in the meantime."
          : "Tell us a bit about you so an administrator can approve your account."}
      </p>

      <form onSubmit={submit} className="mt-4 space-y-3 text-left">
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-foreground">
              First name
            </span>
            <input
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              required
              className={inputCls}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-foreground">
              Last name
            </span>
            <input
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              required
              className={inputCls}
            />
          </label>
        </div>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-foreground">
            Phone
          </span>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            type="tel"
            required
            placeholder="+353…"
            className={inputCls}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-foreground">
            Email
          </span>
          <input value={me?.email ?? ""} disabled className={`${inputCls} opacity-60`} />
        </label>

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-md bg-accent py-2.5 text-sm font-medium text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {busy ? "Saving…" : submitted ? "Update details" : "Submit"}
        </button>
      </form>

      {submitted && (
        <div className="mt-3 rounded-md bg-amber-500/15 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
          Awaiting administrator approval.
        </div>
      )}

      <button
        onClick={() => void signOut()}
        className="mt-4 text-sm text-muted hover:text-foreground"
      >
        Sign out
      </button>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-pane px-4">
      <div className="w-full max-w-sm text-center">
        <div className="mb-5 flex flex-col items-center">
          <Image
            src={BRAND.logo}
            alt={BRAND.org}
            width={48}
            height={48}
          />
        </div>
        <div className="card p-6">
          {children}
        </div>
      </div>
    </div>
  );
}
