import { action, internalMutation, internalQuery, mutation } from "./_generated/server";
import {
  getAuthUserId,
  modifyAccountCredentials,
  retrieveAccount,
} from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

/**
 * Profile management: name, email, password. Email and password changes both
 * require the current password, verified through the auth library against the
 * stored hash — never our own comparison.
 */

export const updateName = mutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const name = args.name.trim();
    await ctx.db.patch(userId, { name: name || undefined });
  },
});

export const emailInternal = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    return (user as { email?: string } | null)?.email ?? null;
  },
});

export const emailTakenInternal = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", args.email))
      .unique();
    return existing !== null;
  },
});

/**
 * Sign-in identity lives in two places: the user document's email, and the
 * password account's id. Both must move together or the account breaks in
 * half — able to see the old email, only able to sign in with the new one.
 */
export const applyEmailChangeInternal = internalMutation({
  args: { userId: v.id("users"), oldEmail: v.string(), newEmail: v.string() },
  handler: async (ctx, args) => {
    const account = await ctx.db
      .query("authAccounts")
      .withIndex("providerAndAccountId", (q) =>
        q.eq("provider", "password").eq("providerAccountId", args.oldEmail)
      )
      .unique();
    if (!account || account.userId !== args.userId) {
      throw new Error("Account not found");
    }
    await ctx.db.patch(account._id, { providerAccountId: args.newEmail });
    await ctx.db.patch(args.userId, { email: args.newEmail });
  },
});

export const changeEmail = action({
  args: { newEmail: v.string(), currentPassword: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");

    const newEmail = args.newEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
      throw new Error("That does not look like an email address.");
    }

    const oldEmail = await ctx.runQuery(internal.profile.emailInternal, { userId });
    if (!oldEmail) throw new Error("Account has no email");
    if (newEmail === oldEmail) return;

    if (await ctx.runQuery(internal.profile.emailTakenInternal, { email: newEmail })) {
      throw new Error("That email already has an account.");
    }

    // Throws if the password is wrong.
    try {
      await retrieveAccount(ctx, {
        provider: "password",
        account: { id: oldEmail, secret: args.currentPassword },
      });
    } catch {
      throw new Error("Current password is not right.");
    }

    await ctx.runMutation(internal.profile.applyEmailChangeInternal, {
      userId,
      oldEmail,
      newEmail,
    });
    // Note: the Stripe customer keeps the old email; receipts still arrive.
  },
});

export const changePassword = action({
  args: { currentPassword: v.string(), newPassword: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    if (args.newPassword.length < 8) {
      throw new Error("New password needs at least 8 characters.");
    }

    const email = await ctx.runQuery(internal.profile.emailInternal, { userId });
    if (!email) throw new Error("Account has no email");

    try {
      await retrieveAccount(ctx, {
        provider: "password",
        account: { id: email, secret: args.currentPassword },
      });
    } catch {
      throw new Error("Current password is not right.");
    }

    await modifyAccountCredentials(ctx, {
      provider: "password",
      account: { id: email, secret: args.newPassword },
    });
  },
});
