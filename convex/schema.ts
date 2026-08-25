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
    year: v.optional(v.number()),
    make: v.optional(v.string()),
    model: v.optional(v.string()),
    /** Total race-ready weight: vehicle, driver, fuel and ballast. */
    raceWeightLb: v.optional(v.number()),
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
    /** Alternate unit key for this channel; other channels of the same quantity are unaffected. */
    unitKey: v.optional(v.string()),
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
    /** The lane used for this pass. Unset when it was not recorded. */
    lane: v.optional(v.union(v.literal("left"), v.literal("right"))),
    /** Trackside weather readings, stored in conventional US drag-racing units. */
    airTemperatureF: v.optional(v.number()),
    trackTemperatureF: v.optional(v.number()),
    humidityPct: v.optional(v.number()),
    barometricPressureInHg: v.optional(v.number()),
    densityAltitudeFt: v.optional(v.number()),
    windSpeedMph: v.optional(v.number()),
    windDirection: v.optional(v.string()),
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

  // Feedback is intentionally writable from the guest viewer. Reads are
  // guarded by the admin query in feedback.ts, so customer reports and their
  // attachments never become public data.
  feedback: defineTable({
    userId: v.optional(v.id("users")),
    visitorKey: v.optional(v.string()),
    source: v.union(v.literal("guest"), v.literal("account")),
    /** 0 means the sender skipped the optional 1–5 star rating. */
    rating: v.optional(v.number()),
    message: v.string(),
    contactEmail: v.optional(v.string()),
    /** Explicit permission to quote this response publicly. */
    allowTestimonial: v.optional(v.boolean()),
    testimonialName: v.optional(v.string()),
    page: v.optional(v.string()),
    status: v.union(v.literal("new"), v.literal("reviewed")),
    createdAt: v.number(),
  })
    .index("by_created", ["createdAt"])
    .index("by_status_created", ["status", "createdAt"]),

  feedbackAttachments: defineTable({
    feedbackId: v.id("feedback"),
    storageId: v.id("_storage"),
    fileName: v.string(),
    fileSize: v.number(),
    contentType: v.string(),
    createdAt: v.number(),
  }).index("by_feedback", ["feedbackId"]),

  // Logs a visitor explicitly chose to publish. Guest-viewer files otherwise
  // remain browser-only; this table is the opt-in path that powers /share/…
  // links. Contact details stay private; the creator's random browser key is
  // retained for rate limiting and future removal of their own shares.
  sharedLogs: defineTable({
    storageId: v.id("_storage"),
    ogImageStorageId: v.id("_storage"),
    fileName: v.string(),
    fileSize: v.number(),
    contentType: v.string(),
    /** All logs in a comparison share. Older links use the fields above. */
    files: v.optional(
      v.array(
        v.object({
          storageId: v.id("_storage"),
          fileName: v.string(),
          fileSize: v.number(),
          contentType: v.string(),
          fingerprint: v.optional(v.string()),
        }),
      ),
    ),
    visitorKey: v.string(),
    /** Private contact details supplied when the public link was created. */
    sharerName: v.optional(v.string()),
    sharerEmail: v.optional(v.string()),
    /** Optional context intentionally shown to anyone opening the public link. */
    vehicleDetails: v.optional(v.string()),
    description: v.optional(v.string()),
    fingerprint: v.optional(v.string()),
    /** Selected logs' viewer workspace, intentionally published with the link. */
    viewerWorkspace: v.optional(v.string()),
    /** Public viewer opens for this share link; social-card crawlers do not run it. */
    visitCount: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_storage", ["storageId"])
    .index("by_visitor_created", ["visitorKey", "createdAt"]),

  // A signed-in account is one visitor across devices. Signed-out use is
  // counted by a random browser id; no IP address, filename, or log contents
  // are stored for analytics.
  viewerVisitors: defineTable({
    visitorKey: v.string(),
    userId: v.optional(v.id("users")),
    firstSeenAt: v.number(),
    lastSeenAt: v.number(),
    sessionCount: v.number(),
  }).index("by_visitor", ["visitorKey"]),

  viewerSessions: defineTable({
    visitorKey: v.string(),
    userId: v.optional(v.id("users")),
    source: v.union(v.literal("guest"), v.literal("account")),
    startedAt: v.number(),
    lastSeenAt: v.number(),
    activeMs: v.number(),
    uniqueLogsLoaded: v.number(),
  })
    .index("by_started", ["startedAt"])
    .index("by_visitor", ["visitorKey"]),

  // The fingerprint is a one-way SHA-256 digest computed in the browser. It
  // lets us recognize the same log twice without uploading the guest's file.
  viewerLogs: defineTable({
    fingerprint: v.string(),
    firstSource: v.union(v.literal("guest"), v.literal("account")),
    firstSeenAt: v.number(),
    lastSeenAt: v.number(),
    sessionCount: v.number(),
  }).index("by_fingerprint", ["fingerprint"]),

  viewerLogLoads: defineTable({
    sessionId: v.id("viewerSessions"),
    fingerprint: v.string(),
    loadedAt: v.number(),
  })
    .index("by_session", ["sessionId"])
    .index("by_session_log", ["sessionId", "fingerprint"])
    .index("by_loaded", ["loadedAt"]),

  // A single roll-up keeps the lifetime dashboard cheap even after the raw
  // session history grows large.
  viewerMetrics: defineTable({
    key: v.string(),
    uniqueVisitors: v.number(),
    uniqueLogs: v.number(),
    sessions: v.number(),
    guestSessions: v.number(),
    accountSessions: v.number(),
    totalLogLoads: v.number(),
    totalActiveMs: v.number(),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),

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
