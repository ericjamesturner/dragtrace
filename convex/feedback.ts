import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAdmin } from "./authz";

const MAX_ATTACHMENTS = 3;
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
const MAX_TOTAL_BYTES = 25 * 1024 * 1024;
const sourceValidator = v.union(v.literal("guest"), v.literal("account"));

function cleanFileName(value: string): string {
  const name = value.split(/[\\/]/).pop()?.trim() || "attachment";
  return name.slice(0, 200);
}

function browserVisitorKey(value: string): string | undefined {
  return /^[a-zA-Z0-9_-]{16,100}$/.test(value)
    ? `browser:${value}`
    : undefined;
}

export const generateAttachmentUploadUrl = mutation({
  args: {},
  handler: async (ctx) => ctx.storage.generateUploadUrl(),
});

export const submit = mutation({
  args: {
    message: v.string(),
    rating: v.number(),
    allowTestimonial: v.boolean(),
    testimonialName: v.optional(v.string()),
    source: sourceValidator,
    page: v.optional(v.string()),
    browserVisitorId: v.optional(v.string()),
    attachments: v.array(
      v.object({
        storageId: v.id("_storage"),
        fileName: v.string(),
        contentType: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const message = args.message.trim();
    const testimonialName = args.testimonialName?.trim();
    if (!message) throw new Error("Please enter some feedback");
    if (message.length > 5000) throw new Error("Feedback is too long");
    if (!Number.isInteger(args.rating) || args.rating < 0 || args.rating > 5) {
      throw new Error("Rating must be between 0 and 5 stars");
    }
    if (testimonialName && testimonialName.length > 80) {
      throw new Error("Testimonial name is too long");
    }
    if (args.attachments.length > MAX_ATTACHMENTS) {
      throw new Error(`Attach no more than ${MAX_ATTACHMENTS} files`);
    }
    if (args.page && args.page.length > 500) throw new Error("Page value is too long");

    const seen = new Set<string>();
    let totalBytes = 0;
    const attachments = [];
    for (const attachment of args.attachments) {
      if (seen.has(attachment.storageId)) throw new Error("Duplicate attachment");
      seen.add(attachment.storageId);
      const metadata = await ctx.db.system.get(attachment.storageId);
      if (!metadata) throw new Error("An attachment could not be found");
      if (metadata.size > MAX_ATTACHMENT_BYTES) {
        throw new Error("Each attachment must be 15 MB or smaller");
      }
      totalBytes += metadata.size;
      if (totalBytes > MAX_TOTAL_BYTES) {
        throw new Error("Attachments must total 25 MB or less");
      }
      attachments.push({
        storageId: attachment.storageId,
        fileName: cleanFileName(attachment.fileName),
        fileSize: metadata.size,
        contentType: (metadata.contentType || attachment.contentType || "application/octet-stream").slice(
          0,
          120,
        ),
      });
    }

    const userId = await getAuthUserId(ctx);
    const source = args.source === "account" && userId ? "account" : "guest";
    const visitorKey = userId
      ? `user:${userId}`
      : args.browserVisitorId
        ? browserVisitorKey(args.browserVisitorId)
        : undefined;
    const now = Date.now();
    const feedbackId = await ctx.db.insert("feedback", {
      ...(userId ? { userId } : {}),
      ...(visitorKey ? { visitorKey } : {}),
      source,
      rating: args.rating,
      message,
      allowTestimonial: args.allowTestimonial,
      ...(args.allowTestimonial && testimonialName ? { testimonialName } : {}),
      ...(args.page ? { page: args.page.slice(0, 500) } : {}),
      status: "new",
      createdAt: now,
    });
    for (const attachment of attachments) {
      await ctx.db.insert("feedbackAttachments", {
        feedbackId,
        ...attachment,
        createdAt: now,
      });
    }
    return feedbackId;
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const items = await ctx.db
      .query("feedback")
      .withIndex("by_created")
      .order("desc")
      .take(100);
    return Promise.all(
      items.map(async (item) => {
        const [user, attachments] = await Promise.all([
          item.userId ? ctx.db.get(item.userId) : null,
          ctx.db
            .query("feedbackAttachments")
            .withIndex("by_feedback", (q) => q.eq("feedbackId", item._id))
            .collect(),
        ]);
        return {
          ...item,
          userEmail: user?.email,
          attachments: await Promise.all(
            attachments.map(async (attachment) => ({
              ...attachment,
              url: await ctx.storage.getUrl(attachment.storageId),
            })),
          ),
        };
      }),
    );
  },
});

export const markReviewed = mutation({
  args: { feedbackId: v.id("feedback"), reviewed: v.boolean() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const item = await ctx.db.get(args.feedbackId);
    if (!item) throw new Error("Feedback not found");
    await ctx.db.patch(args.feedbackId, {
      status: args.reviewed ? "reviewed" : "new",
    });
  },
});
