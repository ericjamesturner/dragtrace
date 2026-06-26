import { useMemo, useRef, useEffect } from "react";
import { useQuery, useAction } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { ChannelDef } from "@/lib/log-types";
import { buildTree, type GroupNode, type GroupChannel } from "@/lib/channel-groups";

/**
 * Replaces buildTree() with database-driven channel grouping.
 * Falls back to hardcoded buildTree() while DB data is loading.
 * Supports arbitrary nesting depth.
 */
export function useChannelGroups(
  channelDefs: ChannelDef[],
  ecuType: string,
  vehicleId?: Id<"vehicles">,
): { tree: GroupNode[]; loading: boolean } {
  const categories = useQuery(api.channelCategories.listByEcuType, { ecuType });
  const mappings = useQuery(api.channelMappings.listByEcuType, { ecuType });
  const overrides = useQuery(
    api.vehicleChannelOverrides.listByVehicle,
    vehicleId ? { vehicleId } : "skip",
  );

  const categorizeChannels = useAction(api.channelMappings.categorizeChannels);
  const categorizingRef = useRef(false);

  const dbLoading = categories === undefined || mappings === undefined;

  // Detect unmapped channels and trigger AI categorization (bootstraps from zero)
  useEffect(() => {
    if (dbLoading || categorizingRef.current) return;
    if (!mappings || !categories) return;
    if (channelDefs.length === 0) return;

    const mappedNames = new Set(mappings.map((m) => m.channelName));
    const unmapped = channelDefs
      .map((d) => d.name)
      .filter((name) => !mappedNames.has(name));

    if (unmapped.length === 0) return;

    categorizingRef.current = true;
    categorizeChannels({ channelNames: unmapped, ecuType })
      .catch((err) => console.error("AI categorization failed:", err))
      .finally(() => { categorizingRef.current = false; });
  }, [dbLoading, mappings, categories, channelDefs, ecuType, categorizeChannels]);

  const tree = useMemo(() => {
    // Fallback to hardcoded while loading
    if (dbLoading || !categories || categories.length === 0) {
      return buildTree(channelDefs);
    }

    // Build override lookup
    const overrideMap = new Map<string, {
      categoryId?: Id<"channelCategories">;
      displayName?: string;
      hidden?: boolean;
    }>();
    if (overrides) {
      for (const o of overrides) {
        overrideMap.set(o.channelName, {
          categoryId: o.categoryId ?? undefined,
          displayName: o.displayName ?? undefined,
          hidden: o.hidden ?? undefined,
        });
      }
    }

    // Build mapping lookup
    const mappingByName = new Map<string, typeof mappings[0]>();
    for (const m of mappings!) {
      mappingByName.set(m.channelName, m);
    }

    // Build children-of lookup for categories
    const childrenOf = new Map<string | null, typeof categories>();
    for (const cat of categories) {
      const key = cat.parentId ?? null;
      const list = childrenOf.get(key) ?? [];
      list.push(cat);
      childrenOf.set(key, list);
    }
    for (const list of childrenOf.values()) {
      list.sort((a, b) => a.sortOrder - b.sortOrder);
    }

    // Find root "Other" for unmapped channels
    const rootCats = childrenOf.get(null) ?? [];
    const otherCat = rootCats.find((c) => c.name === "Other");

    // Collect channels per category with sort order
    const channelsByCat = new Map<string, { ch: GroupChannel; sortOrder: number }[]>();

    for (const def of channelDefs) {
      const override = overrideMap.get(def.name);
      if (override?.hidden) continue;

      const mapping = mappingByName.get(def.name);
      if (!mapping) {
        if (otherCat) {
          const list = channelsByCat.get(otherCat._id) ?? [];
          list.push({ ch: { def, displayName: def.name }, sortOrder: 0 });
          channelsByCat.set(otherCat._id, list);
        }
        continue;
      }

      const primaryCatId = override?.categoryId ?? mapping.categoryId;
      const displayName = override?.displayName ?? mapping.displayName ?? def.name;
      const aliases = mapping.aliases;
      const ch: GroupChannel = { def, displayName, aliases };

      const list = channelsByCat.get(primaryCatId) ?? [];
      list.push({ ch, sortOrder: mapping.sortOrder ?? 0 });
      channelsByCat.set(primaryCatId, list);
    }
    // Sort each category's channels
    for (const list of channelsByCat.values()) {
      list.sort((a, b) => a.sortOrder - b.sortOrder);
    }

    // Recursive tree builder
    function buildNode(cat: NonNullable<typeof categories>[number]): GroupNode | null {
      const kids = childrenOf.get(cat._id) ?? [];
      const channels = (channelsByCat.get(cat._id) ?? []).map(({ ch }) => ({
        ...ch,
        displayName: ch.displayName === ch.def.name
          ? stripPrefix(ch.def.name, cat.name)
          : ch.displayName,
      }));

      const childNodes = kids
        .map(buildNode)
        .filter((n): n is GroupNode => n !== null);

      if (channels.length === 0 && childNodes.length === 0) return null;

      return { tag: cat.name, channels, children: childNodes };
    }

    return rootCats
      .map(buildNode)
      .filter((n): n is GroupNode => n !== null);
  }, [dbLoading, categories, mappings, overrides, channelDefs]);

  return { tree, loading: dbLoading };
}

function stripPrefix(name: string, prefix: string): string {
  const lower = name.toLowerCase();
  const prefixLower = prefix.toLowerCase();
  if (lower.startsWith(prefixLower)) {
    const rest = name.substring(prefix.length).trimStart();
    if (rest.length > 0) return rest;
  }
  return name;
}
