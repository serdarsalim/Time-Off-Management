import { ConvexError } from "convex/values";
import { query } from "./_generated/server";
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { resolveActingProfile, isSuperadmin } from "./model";

// Paginated activity log, newest first. Superadmins only — it spans the whole
// company rather than an admin's own team. When a search term is given, uses
// the full-text index over the frozen searchText.
export const list = query({
  args: {
    search: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
    asUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, { search, paginationOpts, asUserId }) => {
    const { profile: me } = await resolveActingProfile(ctx, asUserId);
    if (!isSuperadmin(me.role)) throw new ConvexError("Superadmins only.");
    const s = search?.trim().toLowerCase() ?? "";
    if (s) {
      return await ctx.db
        .query("auditLog")
        .withSearchIndex("search", (q) => q.search("searchText", s))
        .paginate(paginationOpts);
    }
    return await ctx.db
      .query("auditLog")
      .withIndex("by_timestamp")
      .order("desc")
      .paginate(paginationOpts);
  },
});
