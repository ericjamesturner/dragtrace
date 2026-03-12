import { defineSchema, defineTable } from "convex/server";
import { authTables } from "@convex-dev/auth/server";
import { v } from "convex/values";

export default defineSchema({
  ...authTables,
  logs: defineTable({
    userId: v.id("users"),
    level: v.union(
      v.literal("info"),
      v.literal("warn"),
      v.literal("error"),
      v.literal("debug")
    ),
    message: v.string(),
    timestamp: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_timestamp", ["timestamp"]),
});
