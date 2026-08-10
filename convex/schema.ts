import { defineSchema, defineTable } from "convex/server";
import { authTables } from "@convex-dev/auth/server";
import { v } from "convex/values";

export default defineSchema({
  ...authTables,

  // How this user wants values displayed, everywhere, unless a vehicle says
  // otherwise. `unitSystem` is the baseline preset rather than a frozen set of
  // choices, so a quantity we haven't seen before still picks a sensible unit.
  // `unitOverrides` is JSON: { [quantitySlug]: alternateKey }.
  userPreferences: defineTable({
    userId: v.id("users"),
    unitSystem: v.optional(v.string()),
    unitOverrides: v.optional(v.string()),
  }).index("by_user", ["userId"]),

  vehicles: defineTable({
    userId: v.id("users"),
    name: v.string(),
    description: v.optional(v.string()),
    createdAt: v.number(),
    /** Sparse per-quantity overrides layered over the user's preferences. */
    unitOverrides: v.optional(v.string()),
  }).index("by_user", ["userId"]),

  // Derived channels the user defined, computed from logged ones at load time.
  // Scoped per vehicle: an expression referencing this car's channels is
  // meaningless against a different combo.
  mathChannels: defineTable({
    vehicleId: v.id("vehicles"),
    name: v.string(),
    expression: v.string(),
    /** Quantity slug for display units; omitted when the result is unitless. */
    quantitySlug: v.optional(v.string()),
    /** The prompt it came from, kept so it can be regenerated or edited. */
    prompt: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_vehicle", ["vehicleId"]),

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
    /** Which round the pass was — free text the racer types: T1, Q2, E3... */
    round: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    order: v.optional(v.number()),
    uploadedAt: v.number(),
    // Precomputed dashboard preview (JSON blob) — logs never change, so
    // this is computed once client-side and reused.
    preview: v.optional(v.string()),
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

  // Active admin impersonation sessions: while a row exists, the admin's
  // queries/mutations operate on the target user's data.
  impersonations: defineTable({
    adminUserId: v.id("users"),
    targetUserId: v.id("users"),
  }).index("by_admin", ["adminUserId"]),

  // Ownership record for freshly-uploaded scratch files (timeslip photos) that
  // have no `files` row yet. A bare storage id carries no owner, so anything
  // that reads or deletes one by id must check the claim first.
  tempUploads: defineTable({
    userId: v.id("users"),
    storageId: v.id("_storage"),
    createdAt: v.number(),
  })
    .index("by_storage", ["storageId"])
    .index("by_created", ["createdAt"]),

  timeslips: defineTable({
    userId: v.id("users"),
    fileId: v.id("files"),
    /** Which round the pass was — free text the racer types: T1, Q2, E3... */
    round: v.optional(v.string()),
    /** The delay box setting used on this pass. */
    delayBox: v.optional(v.number()),
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

  /**
   * One row per user once they reach checkout. Stripe is the source of truth —
   * this is a local cache kept current by the webhook, so a query never has to
   * call Stripe to decide whether someone is paid up.
   *
   * `compedUntil` is the escape hatch for accounts we let in without paying
   * (our own, early testers). It is checked before Stripe status.
   */
  subscriptions: defineTable({
    userId: v.id("users"),
    stripeCustomerId: v.optional(v.string()),
    stripeSubscriptionId: v.optional(v.string()),
    // trialing | active | past_due | canceled | incomplete | incomplete_expired | unpaid
    status: v.optional(v.string()),
    // Seconds since epoch, straight from Stripe.
    currentPeriodEnd: v.optional(v.number()),
    cancelAtPeriodEnd: v.optional(v.boolean()),
    compedUntil: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_customer", ["stripeCustomerId"]),
});
