import { mutation, query, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { requireAdmin } from "./authz";

const MAX_FILE_BYTES = 125 * 1024 * 1024;
const MAX_SHARES_PER_HOUR = 5;
const MAX_SHARES_PER_DAY = 20;
const MAX_SHARED_FILES = 10;
const MAX_VIEWER_WORKSPACE_LENGTH = 200_000;
const SUPPORTED_EXTENSION = /\.(?:csv|log|txt|dl)$/i;
const sharedFileInputValidator = v.object({
  storageId: v.id("_storage"),
  fileName: v.string(),
  contentType: v.string(),
  fingerprint: v.optional(v.string()),
});

function visitorKey(value: string): string {
  if (!/^[a-zA-Z0-9_-]{16,100}$/.test(value)) {
    throw new Error("This browser could not be identified. Refresh and try again.");
  }
  return `browser:${value}`;
}

function cleanFileName(value: string): string {
  return (value.split(/[\\/]/).pop()?.trim() || "shared-log").slice(0, 200);
}

function cleanSharerName(value: string): string {
  const name = value.trim().replace(/\s+/g, " ");
  if (!name) throw new Error("Enter your name.");
  if (name.length > 100) throw new Error("Name must be 100 characters or less.");
  return name;
}

function cleanSharerEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Enter a valid email address.");
  }
  return email;
}

function cleanOptionalPublicText(
  value: string | undefined,
  label: string,
  maxLength: number,
): string | undefined {
  const cleaned = value?.trim();
  if (!cleaned) return undefined;
  if (cleaned.length > maxLength) {
    throw new Error(
      `${label} must be ${maxLength.toLocaleString()} characters or less.`,
    );
  }
  return cleaned;
}

function cleanViewerWorkspace(value: string | undefined): string | undefined {
  const workspace = value?.trim();
  if (!workspace) return undefined;
  if (workspace.length > MAX_VIEWER_WORKSPACE_LENGTH) {
    throw new Error("The shared viewer workspace is too large.");
  }
  try {
    const parsed: unknown = JSON.parse(workspace);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error();
    }
    const pages = (parsed as { pages?: unknown }).pages;
    if (!Array.isArray(pages) || pages.length === 0 || pages.length > 20) {
      throw new Error();
    }
    for (const page of pages) {
      if (!page || typeof page !== "object" || Array.isArray(page)) throw new Error();
      const item = page as {
        traces?: unknown;
        scatters?: unknown;
        heatmaps?: unknown;
      };
      if (!Array.isArray(item.traces) || item.traces.length > 40) throw new Error();
      if (Array.isArray(item.scatters) && item.scatters.length > 20) throw new Error();
      if (Array.isArray(item.heatmaps) && item.heatmaps.length > 20) throw new Error();
      for (const trace of item.traces) {
        if (!trace || typeof trace !== "object" || Array.isArray(trace)) throw new Error();
        const channels = (trace as { channels?: unknown }).channels;
        if (!Array.isArray(channels) || channels.length > 64) throw new Error();
      }
    }
    return JSON.stringify(parsed);
  } catch {
    throw new Error("The shared viewer workspace is invalid.");
  }
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
    sharerName: v.string(),
    sharerEmail: v.string(),
    vehicleDetails: v.optional(v.string()),
    description: v.optional(v.string()),
    fingerprint: v.optional(v.string()),
    files: v.optional(v.array(sharedFileInputValidator)),
    viewerWorkspace: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const key = visitorKey(args.browserVisitorId);
    const sharerName = cleanSharerName(args.sharerName);
    const sharerEmail = cleanSharerEmail(args.sharerEmail);
    const vehicleDetails = cleanOptionalPublicText(
      args.vehicleDetails,
      "Vehicle details",
      300,
    );
    const description = cleanOptionalPublicText(
      args.description,
      "Description or question",
      2_000,
    );
    const viewerWorkspace = cleanViewerWorkspace(args.viewerWorkspace);
    const requestedFiles = args.files?.length
      ? args.files
      : [
          {
            storageId: args.storageId,
            fileName: args.fileName,
            contentType: args.contentType,
            fingerprint: args.fingerprint,
          },
        ];
    if (requestedFiles.length > MAX_SHARED_FILES) {
      throw new Error(`A share can include up to ${MAX_SHARED_FILES} logs.`);
    }
    if (requestedFiles[0]?.storageId !== args.storageId) {
      throw new Error("The primary shared log does not match the file list.");
    }
    if (new Set(requestedFiles.map((file) => file.storageId)).size !== requestedFiles.length) {
      throw new Error("The same log cannot be included twice.");
    }

    const fileMetadata = await Promise.all(
      requestedFiles.map((file) => ctx.db.system.get(file.storageId)),
    );
    const imageMetadata = await ctx.db.system.get(args.ogImageStorageId);
    if (
      !imageMetadata ||
      imageMetadata.size <= 0 ||
      imageMetadata.size > 5 * 1024 * 1024 ||
      imageMetadata.contentType !== "image/png"
    ) {
      throw new Error("The share preview image could not be created.");
    }

    const files = requestedFiles.map((file, index) => {
      const metadata = fileMetadata[index];
      if (!metadata) throw new Error("An uploaded log could not be found.");
      const fileName = cleanFileName(file.fileName);
      if (!SUPPORTED_EXTENSION.test(fileName)) {
        throw new Error("That log-file extension cannot be shared.");
      }
      if (metadata.size <= 0 || metadata.size > MAX_FILE_BYTES) {
        throw new Error("Shared logs must be 125 MB or smaller.");
      }
      const fingerprint = file.fingerprint?.trim();
      return {
        storageId: file.storageId,
        fileName,
        fileSize: metadata.size,
        contentType: (
          metadata.contentType ||
          file.contentType ||
          "application/octet-stream"
        ).slice(0, 120),
        ...(fingerprint && fingerprint.length <= 100 ? { fingerprint } : {}),
      };
    });
    const primary = files[0];
    if (!primary) throw new Error("Choose at least one log to share.");

    const duplicate = await ctx.db
      .query("sharedLogs")
      .withIndex("by_storage", (q) => q.eq("storageId", args.storageId))
      .unique();
    if (duplicate) throw new Error("This upload already has a share link.");
    await enforceShareRateLimit(ctx, key);

    return await ctx.db.insert("sharedLogs", {
      storageId: primary.storageId,
      ogImageStorageId: args.ogImageStorageId,
      fileName: primary.fileName,
      fileSize: primary.fileSize,
      contentType: primary.contentType,
      files,
      visitorKey: key,
      sharerName,
      sharerEmail,
      ...(vehicleDetails ? { vehicleDetails } : {}),
      ...(description ? { description } : {}),
      ...(primary.fingerprint ? { fingerprint: primary.fingerprint } : {}),
      ...(viewerWorkspace ? { viewerWorkspace } : {}),
      visitCount: 0,
      createdAt: Date.now(),
    });
  },
});

export const recordVisit = mutation({
  args: { shareId: v.string() },
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("sharedLogs", args.shareId);
    if (!id) return null;
    const item = await ctx.db.get(id);
    if (!item) return null;
    const visitCount = (item.visitCount ?? 0) + 1;
    await ctx.db.patch(id, { visitCount });
    return visitCount;
  },
});

export const updateViewerWorkspace = mutation({
  args: {
    shareId: v.string(),
    browserVisitorId: v.string(),
    viewerWorkspace: v.string(),
  },
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("sharedLogs", args.shareId);
    if (!id) throw new Error("The shared log could not be found.");
    const item = await ctx.db.get(id);
    if (!item) throw new Error("The shared log could not be found.");
    if (item.visitorKey !== visitorKey(args.browserVisitorId)) {
      throw new Error("Only the original sharer can update this workspace.");
    }
    const viewerWorkspace = cleanViewerWorkspace(args.viewerWorkspace);
    if (!viewerWorkspace) throw new Error("The shared viewer workspace is empty.");
    await ctx.db.patch(id, { viewerWorkspace });
    return null;
  },
});

export const get = query({
  args: { shareId: v.string() },
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("sharedLogs", args.shareId);
    if (!id) return null;
    const item = await ctx.db.get(id);
    if (!item) return null;
    const storedFiles = item.files?.length
      ? item.files
      : [
          {
            storageId: item.storageId,
            fileName: item.fileName,
            fileSize: item.fileSize,
            contentType: item.contentType,
            fingerprint: item.fingerprint,
          },
        ];
    const [fileUrls, ogImageUrl] = await Promise.all([
      Promise.all(storedFiles.map((file) => ctx.storage.getUrl(file.storageId))),
      ctx.storage.getUrl(item.ogImageStorageId),
    ]);
    if (fileUrls.some((url) => !url)) return null;
    const files = storedFiles.map((file, index) => ({
      fileName: file.fileName,
      fileSize: file.fileSize,
      contentType: file.contentType,
      url: fileUrls[index]!,
    }));
    const primary = files[0];
    if (!primary) return null;
    return {
      fileName: primary.fileName,
      fileSize: primary.fileSize,
      contentType: primary.contentType,
      files,
      fileCount: files.length,
      createdAt: item.createdAt,
      vehicleDetails: item.vehicleDetails,
      description: item.description,
      viewerWorkspace: item.viewerWorkspace,
      visitCount: item.visitCount ?? 0,
      url: primary.url,
      ogImageUrl,
    };
  },
});

export const listForAdmin = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return await ctx.db.query("sharedLogs").order("desc").take(100);
  },
});
