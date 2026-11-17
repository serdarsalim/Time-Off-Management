"use client";

import { useTheme } from "@/lib/useTheme";
import type { ThemeMode } from "@/lib/theme";

const NEXT: Record<ThemeMode, ThemeMode> = {
  light: "dark",
  dark: "auto",
  auto: "light",
};

const LABEL: Record<ThemeMode, string> = {
  light: "Light theme",
  dark: "Dark theme",
  auto: "Auto theme (follows sunrise & sunset)",
};

export function ThemeToggle({ className = "" }: { className?: string }) {
  const { mode, setMode } = useTheme();

  return (
    <button
      onClick={() => setMode(NEXT[mode])}
      aria-label={LABEL[mode]}
      title={LABEL[mode]}
      className={`flex h-8 w-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-black/[0.045] hover:text-foreground dark:hover:bg-white/[0.06] ${className}`}
    >
      {mode === "light" && (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
        </svg>
      )}
      {mode === "dark" && (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )}
      {mode === "auto" && (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
          <path d="M12 8a4 4 0 0 0 0 8z" fill="currentColor" stroke="none" />
        </svg>
      )}
    </button>
  );
}
