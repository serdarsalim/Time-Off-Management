import {
  convexAuthNextjsMiddleware,
  createRouteMatcher,
  nextjsMiddlewareRedirect,
} from "@convex-dev/auth/nextjs/server";

const isSignInPage = createRouteMatcher(["/login"]);

export default convexAuthNextjsMiddleware(async (request, { convexAuth }) => {
  const authed = await convexAuth.isAuthenticated();

  // Signed-in users don't need the login page.
  if (isSignInPage(request)) {
    if (authed) return nextjsMiddlewareRedirect(request, "/");
    return;
  }

  // Everything else requires auth. Protect-by-default (not an allowlist) so a
  // newly added page can never accidentally leak / crash for logged-out users —
  // they're redirected to /login before the page or its queries ever run.
  if (!authed) {
    return nextjsMiddlewareRedirect(request, "/login");
  }
});

export const config = {
  // Run on everything except static files and Next internals.
  matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
};
