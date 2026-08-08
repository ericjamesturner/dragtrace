import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { ChannelDef } from "@/lib/log-types";
import {
  buildTree,
  buildTreeFromPaths,
  dedupeDisplayNames,
  type GroupNode,
  type GroupChannel,
} from "@/lib/channel-groups";
import { useChannelDefinitions } from "./useChannelDefinitions";

/**
 * Channel grouping, in order of preference:
 *
 *   1. the admin-curated taxonomy in Convex, when one exists for this ECU;
 *   2. the ECU manufacturer's own object paths from the definition pack;
 *   3. the hand-maintained keyword tree, as a last resort.
 *
 * Per-vehicle overrides apply on top of whichever produced the tree.
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

  const { identities } = useChannelDefinitions(channelDefs, ecuType);

  const dbLoading = categories === undefined || mappings === undefined;

  // Computed (math) channels live in their own group — they aren't real ECU
  // channels, so they never carry a definition-pack identity.
  const realDefs = useMemo(() => channelDefs.filter((d) => !d.computed), [channelDefs]);
  const computedDefs = useMemo(() => channelDefs.filter((d) => d.computed), [channelDefs]);

  const tree = useMemo(() => {
    const withMathGroup = (roots: GroupNode[]): GroupNode[] => {
      if (computedDefs.length === 0) return roots;
      return [
        ...roots,
        {
          tag: "Math",
          channels: computedDefs.map((def) => ({ def, displayName: def.name })),
          children: [],
        },
      ];
    };

    if (dbLoading || !categories || categories.length === 0) {
      const hidden = new Set(
        (overrides ?? []).filter((o) => o.hidden).map((o) => o.channelName),
      );
      const renamed = new Map(
        (overrides ?? [])
          .filter((o) => o.displayName)
          .map((o) => [o.channelName, o.displayName!]),
      );
      const visible = hidden.size ? realDefs.filter((d) => !hidden.has(d.name)) : realDefs;
      const roots =
        identities.size > 0
          ? buildTreeFromPaths(visible, identities)
          : buildTree(visible);
      return withMathGroup(renamed.size ? applyRenames(roots, renamed) : roots);
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

    for (const def of realDefs) {
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

    return withMathGroup(
      dedupeDisplayNames(
        rootCats.map(buildNode).filter((n): n is GroupNode => n !== null),
      ),
    );
  }, [dbLoading, categories, mappings, overrides, realDefs, computedDefs, identities]);

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

/** Apply the user's per-vehicle channel names to an already-built tree. */
function applyRenames(nodes: GroupNode[], renamed: Map<string, string>): GroupNode[] {
  return nodes.map((node) => ({
    ...node,
    channels: node.channels.map((ch) =>
      renamed.has(ch.def.name) ? { ...ch, displayName: renamed.get(ch.def.name)! } : ch,
    ),
    children: applyRenames(node.children, renamed),
  }));
}
