import { mutation, query, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";

const MAX_FILE_BYTES = 125 * 1024 * 1024;
const MAX_SHARES_PER_HOUR = 5;
const MAX_SHARES_PER_DAY = 20;
const SUPPORTED_EXTENSION = /\.(?:csv|log|txt|dl)$/i;

function visitorKey(value: string): string {
  if (!/^[a-zA-Z0-9_-]{16,100}$/.test(value)) {
    throw new Error("This browser could not be identified. Refresh and try again.");
  }
  return `browser:${value}`;
}

function cleanFileName(value: string): string {
  return (value.split(/[\\/]/).pop()?.trim() || "shared-log").slice(0, 200);
}

async function enforceShareRateLimit(
  ctx: MutationCtx,
  key: string,
) {
  const now = Date.now();
  const recent = await ctx.db
    .query("sharedLogs")
    .withIndex("by_visitor_created", (q) => q.eq("visitorKey", key))
    .order("desc")
    .take(MAX_SHARES_PER_DAY);
  const hourCount = recent.filter((item) => item.createdAt > now - 60 * 60 * 1000).length;
  const dayCount = recent.filter((item) => item.createdAt > now - 24 * 60 * 60 * 1000).length;
  if (hourCount >= MAX_SHARES_PER_HOUR || dayCount >= MAX_SHARES_PER_DAY) {
    throw new Error("You have created several share links recently. Try again later.");
  }
}

export const generateUploadUrl = mutation({
  args: { browserVisitorId: v.string() },
  handler: async (ctx, args) => {
    const key = visitorKey(args.browserVisitorId);
    await enforceShareRateLimit(ctx, key);
    return await ctx.storage.generateUploadUrl();
  },
});

export const create = mutation({
  args: {
    storageId: v.id("_storage"),
    ogImageStorageId: v.id("_storage"),
    fileName: v.string(),
    contentType: v.string(),
    browserVisitorId: v.string(),
    fingerprint: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const key = visitorKey(args.browserVisitorId);
    const fileName = cleanFileName(args.fileName);
    const metadata = await ctx.db.system.get(args.storageId);
    const imageMetadata = await ctx.db.system.get(args.ogImageStorageId);
    if (!metadata) throw new Error("The uploaded log could not be found.");
    if (
      !imageMetadata ||
      imageMetadata.size <= 0 ||
      imageMetadata.size > 5 * 1024 * 1024 ||
      imageMetadata.contentType !== "image/png"
    ) {
      throw new Error("The share preview image could not be created.");
    }

    const invalid =
      !SUPPORTED_EXTENSION.test(fileName) ||
      metadata.size <= 0 ||
      metadata.size > MAX_FILE_BYTES;
    if (invalid) {
      await ctx.storage.delete(args.storageId);
      if (!SUPPORTED_EXTENSION.test(fileName)) {
        throw new Error("That log-file extension cannot be shared.");
      }
      throw new Error("Shared logs must be 125 MB or smaller.");
    }

    const duplicate = await ctx.db
      .query("sharedLogs")
      .withIndex("by_storage", (q) => q.eq("storageId", args.storageId))
      .unique();
    if (duplicate) throw new Error("This upload already has a share link.");
    await enforceShareRateLimit(ctx, key);

    const fingerprint = args.fingerprint?.trim();
    return await ctx.db.insert("sharedLogs", {
      storageId: args.storageId,
      ogImageStorageId: args.ogImageStorageId,
      fileName,
      fileSize: metadata.size,
      contentType: (metadata.contentType || args.contentType || "application/octet-stream").slice(0, 120),
      visitorKey: key,
      ...(fingerprint && fingerprint.length <= 100 ? { fingerprint } : {}),
      createdAt: Date.now(),
    });
  },
});

export const get = query({
  args: { shareId: v.string() },
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("sharedLogs", args.shareId);
    if (!id) return null;
    const item = await ctx.db.get(id);
    if (!item) return null;
    const [url, ogImageUrl] = await Promise.all([
      ctx.storage.getUrl(item.storageId),
      ctx.storage.getUrl(item.ogImageStorageId),
    ]);
    if (!url) return null;
    return {
      fileName: item.fileName,
      fileSize: item.fileSize,
      contentType: item.contentType,
      createdAt: item.createdAt,
      url,
      ogImageUrl,
    };
  },
});
