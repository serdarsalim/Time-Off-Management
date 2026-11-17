import Google from "@auth/core/providers/google";
import { Anonymous } from "@convex-dev/auth/providers/Anonymous";
import { convexAuth } from "@convex-dev/auth/server";
import type { DatabaseWriter, MutationCtx } from "./_generated/server";

const DEMO_USER_EMAIL = "demo@timeoff.example";

function isDemoDeployment(): boolean {
  return process.env.DEMO_MODE === "true";
}

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: isDemoDeployment()
    ? [Anonymous()]
    : [
        Google({
          // Always show the Google account chooser instead of silently using
          // the already-signed-in account.
          authorization: { params: { prompt: "select_account" } },
        }),
        // Registered in every build, but the callback below refuses it unless
        // the deployment is explicitly marked as the isolated public demo.
        Anonymous(),
      ],
  callbacks: {
    async createOrUpdateUser(ctx, args) {
      const db = ctx.db as unknown as DatabaseWriter;

      if (args.provider.id === "anonymous") {
        if (!isDemoDeployment()) throw new Error("Demo access is not enabled.");
        const existing = await db
          .query("users")
          .withIndex("email", (q) => q.eq("email", DEMO_USER_EMAIL))
          .first();
        const userId = existing
          ? existing._id
          : await db.insert("users", {
              name: "Demo administrator",
              email: DEMO_USER_EMAIL,
              isAnonymous: true,
            });
        await ensureProfile(ctx as unknown as MutationCtx, userId);
        return userId;
      }

      const email = String(args.profile.email ?? "").trim().toLowerCase();
      const name = String(args.profile.name ?? (email || "Unknown"));
      const image =
        typeof args.profile.image === "string" ? args.profile.image : undefined;
      let userId = args.existingUserId;

      // Google has verified the email. Link it to a pre-imported employee row
      // when one exists, otherwise create the account the same way Convex Auth
      // normally would.
      if (!userId && email) {
        userId =
          (
            await db
              .query("users")
              .withIndex("email", (q) => q.eq("email", email))
              .first()
          )?._id ?? null;
      }
      if (userId) {
        await db.patch(userId, {
          name,
          email: email || undefined,
          image,
          emailVerificationTime: email ? Date.now() : undefined,
        });
      } else {
        userId = await db.insert("users", {
          name,
          email: email || undefined,
          image,
          emailVerificationTime: email ? Date.now() : undefined,
        });
      }

      await ensureProfile(ctx as unknown as MutationCtx, userId);
      return userId;
    },
  },
});

// Emails that are always granted superadmin on first sign-in. Set the
// SUPERADMIN_EMAILS env var (comma-separated) on your Convex deployment.
const SUPERADMIN_EMAILS = new Set(
  (process.env.SUPERADMIN_EMAILS ?? "").split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
);

async function ensureProfile(ctx: MutationCtx, userId: string) {
  const existing = await ctx.db
    .query("profiles")
    .withIndex("by_user", (q) => q.eq("userId", userId as any))
    .unique();

  const user = await ctx.db.get(userId as any);
  const email = ((user as any)?.email ?? "").toLowerCase();
  const isDemoUser = isDemoDeployment() && email === DEMO_USER_EMAIL;
  const isSuper = isDemoUser || (email && SUPERADMIN_EMAILS.has(email));

  if (existing) {
    // Keep the designated superadmin elevated even if they were created
    // earlier as something else.
    if (isSuper && existing.role !== "superadmin") {
      await ctx.db.patch(existing._id, { role: "superadmin", status: "active" });
    }
    return;
  }

  const anyProfile = await ctx.db.query("profiles").first();
  const isFirst = anyProfile === null;
  const elevated = isSuper || isFirst;

  const fullName = (user as any)?.name ?? (user as any)?.email ?? "Unknown";
  const [firstName, ...rest] = String(fullName).trim().split(" ");

  await ctx.db.insert("profiles", {
    userId: userId as any,
    name: isDemoUser ? "Demo administrator" : fullName,
    email: (user as any)?.email ?? "",
    firstName: isDemoUser ? "Demo" : firstName || undefined,
    lastName: isDemoUser ? "administrator" : rest.join(" ") || undefined,
    // Superadmin if designated, otherwise the very first account bootstraps
    // as admin so the company can be set up. Everyone else is a member who
    // must complete their profile and be approved.
    role: isSuper ? "superadmin" : isFirst ? "admin" : "member",
    status: elevated ? "active" : "pending",
    active: true,
    hiddenFromRoster: isDemoUser || undefined,
  });
}
