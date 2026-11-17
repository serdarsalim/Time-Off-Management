import { ConvexError } from "convex/values";

// Pull something a human can act on out of a failed mutation.
//
// Convex deliberately hides `throw new Error(...)` messages from clients in
// production — they arrive as a bare "Server Error". Anything the person is
// meant to read (no working days in that range, overlapping leave, allowance
// exhausted) is thrown as a ConvexError instead, whose payload does reach the
// browser. That payload is what this returns.
export function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ConvexError) {
    const data = err.data;
    if (typeof data === "string" && data.trim()) return data;
  }
  return fallback;
}
