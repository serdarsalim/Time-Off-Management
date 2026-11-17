"use client";

import { ReactNode } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "@/convex/_generated/api";

// Blocks the app for an account whose access has been revoked — offboarded, or
// sign-in switched off.
//
// This has to live above the pages, in the root layout. Every page calls its
// own Convex queries in its component body and only then returns <AppShell>,
// so a gate inside AppShell runs too late: the page's queries have already
// fired and thrown. Holding `children` here means those components never
// execute in the first place.
export function AccessGate({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  // `users.me` deliberately skips the access check, so it still resolves for a
  // revoked account and can tell us to show this screen rather than an error.
  const me = useQuery(api.users.me, isAuthenticated ? {} : "skip");

  if (isLoading) return <Spinner />;
  // Signed out — let the login page through.
  if (!isAuthenticated) return <>{children}</>;
  if (me === undefined) return <Spinner />;
  if (me && (!me.active || me.signInBlocked)) return <AccessEnded />;
  return <>{children}</>;
}

function Spinner() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-pane">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-accent" />
    </div>
  );
}

// A dead end rather than an error: the record is kept, so the only action is
// to sign out.
function AccessEnded() {
  const { signOut } = useAuthActions();
  return (
    <div className="flex min-h-screen items-center justify-center bg-pane p-6">
      <div className="card w-full max-w-sm p-6 text-center">
        <h1 className="text-lg font-semibold text-foreground">
          Your access has ended
        </h1>
        <p className="mt-2 text-sm text-muted">
          This account can no longer be used to book or view leave. If that
          &apos;s unexpected, speak to your manager.
        </p>
        <button
          type="button"
          onClick={() => void signOut()}
          className="mt-5 w-full rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted-bg"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
