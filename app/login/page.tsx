"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useAuthActions } from "@convex-dev/auth/react";
import { useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { api } from "@/convex/_generated/api";
import { brandFor } from "@/lib/brand";

export default function LoginPage() {
  const { signIn } = useAuthActions();
  const router = useRouter();
  const isDemo = useQuery(api.demo.isDemo) === true;
  const demoBrand =
    process.env.NEXT_PUBLIC_DEMO_MODE === "true" || isDemo;
  const [loading, setLoading] = useState(false);
  const [demoFailed, setDemoFailed] = useState(false);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!isDemo || startedRef.current) return;
    startedRef.current = true;
    setLoading(true);
    void signIn("anonymous")
      .then(() => router.replace("/"))
      .catch(() => {
        setDemoFailed(true);
        setLoading(false);
      });
  }, [isDemo, router, signIn]);

  const enteringDemo = isDemo && !demoFailed;
  const brand = brandFor(demoBrand);

  return (
    <div className="flex min-h-screen items-center justify-center bg-pane px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <Image
            src={brand.logo}
            alt={brand.org}
            width={56}
            height={56}
          />
          <h1 className="mt-3 text-xl font-semibold text-foreground">
            {brand.appName}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {enteringDemo
              ? "Preparing the demo workspace…"
              : `Sign in with your ${brand.org} Google account.`}
          </p>
        </div>

        <div className="card p-6">
          {enteringDemo ? (
            <div className="flex items-center justify-center gap-3 py-2.5 text-sm font-medium text-foreground">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-accent" />
              Entering demo…
            </div>
          ) : (
          <button
            onClick={() => {
              setLoading(true);
              void signIn("google", { redirectTo: "/" });
            }}
            disabled={loading}
            className="flex w-full items-center justify-center gap-3 rounded-md border border-border bg-background py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted-bg disabled:opacity-60"
          >
            <GoogleIcon />
            {loading ? "Redirecting…" : "Continue with Google"}
          </button>
          )}
        </div>

      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.34A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.94H.96a9 9 0 0 0 0 8.12l3.01-2.34Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A8.99 8.99 0 0 0 .96 4.94l3.01 2.34C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}
