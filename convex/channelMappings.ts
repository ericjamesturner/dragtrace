import { query, mutation, action, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";

export const listByEcuType = query({
  args: { ecuType: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("channelMappings")
      .withIndex("by_ecu_type", (q) => q.eq("ecuType", args.ecuType))
      .collect();
  },
});

export const upsert = mutation({
  args: {
    channelName: v.string(),
    categoryId: v.id("channelCategories"),
    displayName: v.optional(v.string()),
    ecuType: v.string(),
    source: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const existing = await ctx.db
      .query("channelMappings")
      .withIndex("by_channel_ecu", (q) =>
        q.eq("channelName", args.channelName).eq("ecuType", args.ecuType)
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        categoryId: args.categoryId,
        displayName: args.displayName,
        source: args.source,
      });
      return existing._id;
    }

    return await ctx.db.insert("channelMappings", {
      channelName: args.channelName,
      categoryId: args.categoryId,
      displayName: args.displayName,
      ecuType: args.ecuType,
      source: args.source,
      createdAt: Date.now(),
    });
  },
});

export const bulkInsertInternal = internalMutation({
  args: {
    mappings: v.array(v.object({
      channelName: v.string(),
      categoryId: v.id("channelCategories"),
      displayName: v.optional(v.string()),
      aliases: v.optional(v.array(v.string())),
      ecuType: v.string(),
      source: v.string(),
    })),
  },
  handler: async (ctx, args) => {
    for (const m of args.mappings) {
      const existing = await ctx.db
        .query("channelMappings")
        .withIndex("by_channel_ecu", (q) =>
          q.eq("channelName", m.channelName).eq("ecuType", m.ecuType)
        )
        .first();
      if (!existing) {
        await ctx.db.insert("channelMappings", {
          ...m,
          createdAt: Date.now(),
        });
      }
    }
  },
});

export const move = mutation({
  args: {
    channelName: v.string(),
    ecuType: v.string(),
    newCategoryId: v.id("channelCategories"),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const mapping = await ctx.db
      .query("channelMappings")
      .withIndex("by_channel_ecu", (q) =>
        q.eq("channelName", args.channelName).eq("ecuType", args.ecuType)
      )
      .first();
    if (!mapping) throw new Error("Mapping not found");
    await ctx.db.patch(mapping._id, {
      categoryId: args.newCategoryId,
      source: "manual",
    });
  },
});

export const setDisplayName = mutation({
  args: {
    channelName: v.string(),
    ecuType: v.string(),
    displayName: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const mapping = await ctx.db
      .query("channelMappings")
      .withIndex("by_channel_ecu", (q) =>
        q.eq("channelName", args.channelName).eq("ecuType", args.ecuType)
      )
      .first();
    if (!mapping) throw new Error("Mapping not found");
    await ctx.db.patch(mapping._id, { displayName: args.displayName });
  },
});

export const setAliases = mutation({
  args: {
    channelName: v.string(),
    ecuType: v.string(),
    aliases: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const mapping = await ctx.db
      .query("channelMappings")
      .withIndex("by_channel_ecu", (q) =>
        q.eq("channelName", args.channelName).eq("ecuType", args.ecuType)
      )
      .first();
    if (!mapping) throw new Error("Mapping not found");
    await ctx.db.patch(mapping._id, { aliases: args.aliases });
  },
});

export const reorder = mutation({
  args: {
    updates: v.array(v.object({
      channelName: v.string(),
      ecuType: v.string(),
      sortOrder: v.number(),
    })),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    for (const u of args.updates) {
      const mapping = await ctx.db
        .query("channelMappings")
        .withIndex("by_channel_ecu", (q) =>
          q.eq("channelName", u.channelName).eq("ecuType", u.ecuType)
        )
        .first();
      if (mapping) await ctx.db.patch(mapping._id, { sortOrder: u.sortOrder });
    }
  },
});

export const remove = mutation({
  args: {
    channelName: v.string(),
    ecuType: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const mapping = await ctx.db
      .query("channelMappings")
      .withIndex("by_channel_ecu", (q) =>
        q.eq("channelName", args.channelName).eq("ecuType", args.ecuType)
      )
      .first();
    if (mapping) await ctx.db.delete(mapping._id);
  },
});

// Internal mutation for creating categories during AI categorization
export const createCategoryInternal = internalMutation({
  args: {
    name: v.string(),
    parentId: v.optional(v.id("channelCategories")),
    ecuType: v.string(),
    sortOrder: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("channelCategories", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

export const categorizeChannels = action({
  args: {
    channelNames: v.array(v.string()),
    ecuType: v.string(),
  },
  handler: async (ctx, args) => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");

    // Fetch existing state
    let categories = await ctx.runQuery(
      internal.channelMappings.listCategoriesInternal,
      { ecuType: args.ecuType }
    );
    const existingMappings = await ctx.runQuery(
      internal.channelMappings.listMappingsInternal,
      { ecuType: args.ecuType }
    );
    const mappedNames = new Set(existingMappings.map((m: { channelName: string }) => m.channelName));
    const unmapped = args.channelNames.filter((n) => !mappedNames.has(n));
    if (unmapped.length === 0) return;

    // Ensure "Other" category exists (fallback for unresolvable paths)
    let otherCat = categories.find((c: { name: string; parentId?: string }) => c.name === "Other" && !c.parentId);
    if (!otherCat) {
      const otherId = await ctx.runMutation(
        internal.channelMappings.createCategoryInternal,
        { name: "Other", ecuType: args.ecuType, sortOrder: 9999 }
      );
      otherCat = { _id: otherId, name: "Other", ecuType: args.ecuType, sortOrder: 9999, createdAt: Date.now() } as any;
    }

    // Mutable lookup — grows as AI creates new categories
    const rootCatByName = new Map<string, string>();
    // parentId:childName → childId
    const childCatKey = (parentId: string, name: string) => `${parentId}::${name}`;
    const childCatByKey = new Map<string, string>();
    let nextSortOrder = categories.length * 10;

    for (const cat of categories) {
      if (!cat.parentId) rootCatByName.set(cat.name, cat._id);
      else childCatByKey.set(childCatKey(cat.parentId, cat.name), cat._id);
    }

    // Build tree description for the prompt
    const rootCats = categories.filter((c: { parentId?: string }) => !c.parentId);
    const childCats = categories.filter((c: { parentId?: string }) => c.parentId);
    const treeDesc = rootCats.length > 0
      ? rootCats.map((root: { _id: string; name: string }) => {
          const children = childCats
            .filter((c: { parentId?: string }) => c.parentId === root._id)
            .map((c: { name: string }) => c.name);
          return children.length > 0
            ? `${root.name} (subcategories: ${children.join(", ")})`
            : root.name;
        }).join("\n")
      : "(No categories yet — create whatever makes sense for Haltech ECU data)";

    // Batch: max 50 channels per call
    const batches: string[][] = [];
    for (let i = 0; i < unmapped.length; i += 50) {
      batches.push(unmapped.slice(i, i + 50));
    }

    // Helper: resolve a category path like "Engine/Knock" to an ID, creating as needed
    const resolveCategory = async (path: string): Promise<string> => {
      const parts = path.split("/").map((s) => s.trim()).filter(Boolean);
      if (parts.length === 0) return otherCat!._id;

      // Resolve or create root
      let rootId = rootCatByName.get(parts[0]);
      if (!rootId) {
        nextSortOrder += 10;
        rootId = await ctx.runMutation(
          internal.channelMappings.createCategoryInternal,
          { name: parts[0], ecuType: args.ecuType, sortOrder: nextSortOrder }
        );
        rootCatByName.set(parts[0], rootId);
      }

      if (parts.length === 1) return rootId;

      // Resolve or create each child level
      let parentId = rootId;
      for (let i = 1; i < parts.length; i++) {
        const key = childCatKey(parentId, parts[i]);
        let childId = childCatByKey.get(key);
        if (!childId) {
          childId = await ctx.runMutation(
            internal.channelMappings.createCategoryInternal,
            { name: parts[i], parentId: parentId as any, ecuType: args.ecuType, sortOrder: i * 10 }
          );
          childCatByKey.set(key, childId);
        }
        parentId = childId;
      }
      return parentId;
    };

    for (const batch of batches) {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 4096,
          system: `You categorize Haltech ECU datalog channels. These are real channel names from Haltech Elite ECUs used in drag racing.

Existing categories:
${treeDesc}

Categorize each channel. Use "Category" or "Category/Subcategory" paths. Create new categories freely — group related channels logically. Keep category names short and clear.`,
          tools: [
            {
              name: "categorize_channels",
              description: "Categorize a batch of ECU channels",
              input_schema: {
                type: "object",
                properties: {
                  channels: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        channelName: { type: "string" },
                        categoryPath: { type: "string", description: "Category or Category/Subcategory path" },
                        displayName: { type: "string", description: "Short name like TPS, RPM, MAP, IAT" },
                        aliases: { type: "array", items: { type: "string" }, description: "Alternate search names" },
                      },
                      required: ["channelName", "categoryPath"],
                    },
                  },
                },
                required: ["channels"],
              },
            },
          ],
          tool_choice: { type: "tool", name: "categorize_channels" },
          messages: [
            {
              role: "user",
              content: `Categorize these Haltech channels:\n${batch.join("\n")}`,
            },
          ],
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Claude API error: ${response.status} ${errorText}`);
      }

      const result = await response.json() as {
        content: Array<{ type: string; input?: { channels: Array<{ channelName: string; categoryPath: string; displayName?: string; aliases?: string[] }> } }>;
      };

      const toolUse = result.content?.find((c) => c.type === "tool_use");
      if (!toolUse?.input?.channels) continue;

      const mappingsToInsert: Array<{
        channelName: string;
        categoryId: string;
        displayName?: string;
        aliases?: string[];
        ecuType: string;
        source: string;
      }> = [];

      for (const ch of toolUse.input.channels) {
        const categoryId = await resolveCategory(ch.categoryPath);
        mappingsToInsert.push({
          channelName: ch.channelName,
          categoryId,
          displayName: ch.displayName,
          aliases: ch.aliases,
          ecuType: args.ecuType,
          source: "ai",
        });
      }

      if (mappingsToInsert.length > 0) {
        await ctx.runMutation(internal.channelMappings.bulkInsertInternal, {
          mappings: mappingsToInsert as any,
        });
      }
    }
  },
});

// Internal queries used by the action
export const listCategoriesInternal = internalQuery({
  args: { ecuType: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("channelCategories")
      .withIndex("by_ecu_type", (q) => q.eq("ecuType", args.ecuType))
      .collect();
  },
});

export const listMappingsInternal = internalQuery({
  args: { ecuType: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("channelMappings")
      .withIndex("by_ecu_type", (q) => q.eq("ecuType", args.ecuType))
      .collect();
  },
});
