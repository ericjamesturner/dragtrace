import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { recordAuthSignIn } from "./activity";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Password],
  callbacks: {
    async beforeSessionCreation(ctx, { userId }) {
      await recordAuthSignIn(
        ctx as unknown as MutationCtx,
        userId as Id<"users">,
      );
    },
  },
});
