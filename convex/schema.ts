import { defineSchema, defineTable } from "convex/server";
import { authTables } from "@convex-dev/auth/server";
import { v } from "convex/values";

export default defineSchema({
  ...authTables,

  vehicles: defineTable({
    userId: v.id("users"),
    name: v.string(),
    description: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_user", ["userId"]),

  events: defineTable({
    userId: v.id("users"),
    vehicleId: v.id("vehicles"),
    name: v.string(),
    date: v.string(),
    endDate: v.optional(v.string()),
    notes: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_vehicle", ["vehicleId"])
    .index("by_user", ["userId"]),

  files: defineTable({
    userId: v.id("users"),
    vehicleId: v.id("vehicles"),
    eventId: v.id("events"),
    storageId: v.id("_storage"),
    fileName: v.string(),
    fileSize: v.number(),
    contentType: v.string(),
    notes: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    order: v.optional(v.number()),
    uploadedAt: v.number(),
  })
    .index("by_event", ["eventId"])
    .index("by_vehicle", ["vehicleId"])
    .index("by_user", ["userId"]),

  workspaces: defineTable({
    userId: v.id("users"),
    vehicleId: v.id("vehicles"),
    name: v.string(),
    config: v.string(),
    updatedAt: v.number(),
  })
    .index("by_vehicle_user", ["vehicleId", "userId"]),

  channelCategories: defineTable({
    name: v.string(),
    parentId: v.optional(v.id("channelCategories")),
    ecuType: v.string(),
    color: v.optional(v.string()),
    sortOrder: v.number(),
    createdAt: v.number(),
  })
    .index("by_ecu_type", ["ecuType"])
    .index("by_parent", ["parentId"]),

  channelMappings: defineTable({
    channelName: v.string(),
    categoryId: v.id("channelCategories"),
    displayName: v.optional(v.string()),
    aliases: v.optional(v.array(v.string())),
    ecuType: v.string(),
    source: v.string(),
    sortOrder: v.optional(v.number()),
    shortcutCategoryIds: v.optional(v.array(v.id("channelCategories"))),
    createdAt: v.number(),
  })
    .index("by_ecu_type", ["ecuType"])
    .index("by_channel_ecu", ["channelName", "ecuType"])
    .index("by_category", ["categoryId"]),

  vehicleChannelOverrides: defineTable({
    vehicleId: v.id("vehicles"),
    channelName: v.string(),
    categoryId: v.optional(v.id("channelCategories")),
    displayName: v.optional(v.string()),
    hidden: v.optional(v.boolean()),
    createdAt: v.number(),
  }).index("by_vehicle", ["vehicleId"]),

  timeslips: defineTable({
    userId: v.id("users"),
    fileId: v.id("files"),
    rt: v.optional(v.number()),
    sixtyFt: v.optional(v.number()),
    threeThirty: v.optional(v.number()),
    eighthEt: v.optional(v.number()),
    eighthMph: v.optional(v.number()),
    thousandFt: v.optional(v.number()),
    et: v.optional(v.number()),
    mph: v.optional(v.number()),
    dialIn: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_file", ["fileId"]),
});
