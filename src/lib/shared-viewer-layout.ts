import type { Id } from "../../convex/_generated/dataModel";
import {
  remapConfigToFiles,
  type ChannelOnTrace,
  type LoadedLog,
  type ViewerConfig,
} from "./viewer-types";

const SHARED_FILE_PREFIX = "shared-workspace-file-";
const MAX_WORKSPACE_LENGTH = 200_000;
const MAX_PAGES = 20;
const MAX_TRACES_PER_PAGE = 40;
const MAX_CHANNELS_PER_TRACE = 64;
const MAX_PANELS_PER_PAGE = 20;

function sharedFileId(index: number): Id<"files"> {
  return `${SHARED_FILE_PREFIX}${index}` as Id<"files">;
}

function sharedFileIndex(value: string): number | null {
  if (value === "shared-workspace-file") return 0;
  if (!value.startsWith(SHARED_FILE_PREFIX)) return null;
  const index = Number(value.slice(SHARED_FILE_PREFIX.length));
  return Number.isSafeInteger(index) && index >= 0 ? index : null;
}

/**
 * Create a publishable copy of the sender's workspace for the chosen logs.
 * Local file ids are replaced with stable slots, so compared/overlaid logs
 * reopen in the same places without exposing any files that were not shared.
 */
export function captureSharedViewerWorkspace(
  config: ViewerConfig | null,
  logs: LoadedLog[],
): string | undefined {
  if (!config || logs.length === 0) return undefined;
  const indexByFileId = new Map(
    logs.map((log, index) => [log.fileId as string, index]),
  );
  const availableByFileId = new Map(
    logs.map((log) => [
      log.fileId as string,
      new Set(log.parsed.channelDefs.map((definition) => definition.name)),
    ]),
  );
  const allAvailable = new Set(
    logs.flatMap((log) =>
      log.parsed.channelDefs.map((definition) => definition.name),
    ),
  );

  const pages = config.pages.slice(0, MAX_PAGES).flatMap((page) => {
    const traces = page.traces
      .slice(0, MAX_TRACES_PER_PAGE)
      .flatMap((trace) => {
        const channels = trace.channels
          .filter((channel) => {
            const available = availableByFileId.get(channel.logFileId as string);
            return available?.has(channel.channelName) ?? false;
          })
          .filter(
            (channel, index, all) =>
              all.findIndex(
                (candidate) =>
                  candidate.logFileId === channel.logFileId &&
                  candidate.channelName === channel.channelName,
              ) === index,
          )
          .slice(0, MAX_CHANNELS_PER_TRACE)
          .map((channel) => {
            const index = indexByFileId.get(channel.logFileId as string)!;
            const available = availableByFileId.get(channel.logFileId as string)!;
            return {
              ...channel,
              logFileId: sharedFileId(index),
              ...(channel.colorBy && !available.has(channel.colorBy)
                ? {
                    colorBy: undefined,
                    colorByMin: undefined,
                    colorByMax: undefined,
                    colorByLowColor: undefined,
                    colorByHighColor: undefined,
                  }
                : {}),
            };
          });
        if (channels.length === 0) return [];

        const visible = new Set(
          channels.map((channel) => `${channel.logFileId}:${channel.channelName}`),
        );
        const hiddenChannels = (trace.hiddenChannels ?? []).flatMap((key) => {
          for (const log of logs) {
            const prefix = `${log.fileId}:`;
            if (!key.startsWith(prefix)) continue;
            const channelName = key.slice(prefix.length);
            const index = indexByFileId.get(log.fileId as string)!;
            const mapped = `${sharedFileId(index)}:${channelName}`;
            return visible.has(mapped) ? [mapped] : [];
          }
          return [];
        });
        return [
          {
            ...trace,
            channels,
            hiddenChannels:
              hiddenChannels.length > 0 ? hiddenChannels : undefined,
          },
        ];
      });

    const scatters = (page.scatters ?? [])
      .flatMap((scatter) => {
        const index = indexByFileId.get(scatter.logFileId as string);
        const available = availableByFileId.get(scatter.logFileId as string);
        if (
          index === undefined ||
          !available?.has(scatter.xChannel) ||
          !available.has(scatter.yChannel) ||
          (scatter.colorChannel && !available.has(scatter.colorChannel))
        ) {
          return [];
        }
        return [{ ...scatter, logFileId: sharedFileId(index) }];
      })
      .slice(0, MAX_PANELS_PER_PAGE);
    const heatmaps = (page.heatmaps ?? [])
      .flatMap((heatmap) => {
        const index = indexByFileId.get(heatmap.logFileId as string);
        const available = availableByFileId.get(heatmap.logFileId as string);
        if (
          index === undefined ||
          !available?.has(heatmap.xChannel) ||
          !available.has(heatmap.yChannel) ||
          !available.has(heatmap.valueChannel)
        ) {
          return [];
        }
        return [{ ...heatmap, logFileId: sharedFileId(index) }];
      })
      .slice(0, MAX_PANELS_PER_PAGE);

    if (traces.length === 0 && scatters.length === 0 && heatmaps.length === 0) {
      return [];
    }
    return [
      {
        ...page,
        traces,
        scatters: scatters.length > 0 ? scatters : undefined,
        heatmaps: heatmaps.length > 0 ? heatmaps : undefined,
        selection: undefined,
        zoom: undefined,
      },
    ];
  });

  if (pages.length === 0) return undefined;
  const mapTopLevelIds = (ids: string[] | undefined) =>
    ids?.flatMap((id) => {
      const index = indexByFileId.get(id);
      return index === undefined ? [] : [sharedFileId(index) as string];
    });
  const activePageId = pages.some((page) => page.id === config.activePageId)
    ? config.activePageId
    : pages[0].id;
  const snapshot: ViewerConfig = {
    ...config,
    pages,
    activePageId,
    hiddenLogIds: mapTopLevelIds(config.hiddenLogIds),
    mirroredLogIds: mapTopLevelIds(config.mirroredLogIds),
    expandedTimeslipIds: undefined,
    scatterSuggestions: config.scatterSuggestions?.filter(
      (suggestion) =>
        allAvailable.has(suggestion.xChannel) &&
        allAvailable.has(suggestion.yChannel) &&
        (!suggestion.colorChannel || allAvailable.has(suggestion.colorChannel)),
    ),
  };
  const serialized = JSON.stringify(snapshot);
  return serialized.length <= MAX_WORKSPACE_LENGTH ? serialized : undefined;
}

/** Restore a published workspace and bind each stored slot to its public log. */
export function configFromSharedViewerWorkspace(
  serialized: string | undefined,
  logs: LoadedLog[],
): ViewerConfig | null {
  if (!serialized || serialized.length > MAX_WORKSPACE_LENGTH || logs.length === 0) {
    return null;
  }
  try {
    const raw: unknown = JSON.parse(serialized);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const candidate = raw as Record<string, unknown>;
    if (!Array.isArray(candidate.pages) || candidate.pages.length === 0) {
      return null;
    }
    // This was captured from the current ViewerConfig shape, so running the
    // general legacy migration here would intentionally discard modern custom
    // channel colors. Keep the published visual styling intact.
    const migrated = candidate as unknown as ViewerConfig;
    const mapId = (value: string): Id<"files"> | null => {
      const index = sharedFileIndex(value);
      return index === null ? null : logs[index]?.fileId ?? null;
    };
    const pages = migrated.pages.map((page) => ({
      ...page,
      traces: page.traces.map((trace) => {
        const channels = trace.channels.flatMap((channel) => {
          const logFileId = mapId(channel.logFileId as string);
          if (!logFileId) return [];
          const log = logs.find((item) => item.fileId === logFileId);
          const available = log?.parsed.channelDefs.some(
            (definition) => definition.name === channel.channelName,
          );
          return available ? [{ ...channel, logFileId }] : [];
        });
        const hiddenChannels = (trace.hiddenChannels ?? []).flatMap((key) => {
          const match = key.match(/^shared-workspace-file(?:-(\d+))?:(.*)$/);
          if (!match) return [];
          const index = Number(match[1] ?? 0);
          const fileId = logs[index]?.fileId;
          return fileId ? [`${fileId}:${match[2]}`] : [];
        });
        return {
          ...trace,
          channels: channels as ChannelOnTrace[],
          hiddenChannels:
            hiddenChannels.length > 0 ? hiddenChannels : undefined,
        };
      }),
      scatters: page.scatters?.flatMap((scatter) => {
        const logFileId = mapId(scatter.logFileId as string);
        return logFileId ? [{ ...scatter, logFileId }] : [];
      }),
      heatmaps: page.heatmaps?.flatMap((heatmap) => {
        const logFileId = mapId(heatmap.logFileId as string);
        return logFileId ? [{ ...heatmap, logFileId }] : [];
      }),
    }));
    const mapTopLevelIds = (ids: string[] | undefined) =>
      ids?.flatMap((id) => {
        const mapped = mapId(id);
        return mapped ? [mapped as string] : [];
      });
    return remapConfigToFiles(
      {
        ...migrated,
        pages,
        hiddenLogIds: mapTopLevelIds(migrated.hiddenLogIds),
        mirroredLogIds: mapTopLevelIds(migrated.mirroredLogIds),
      },
      logs,
    );
  } catch {
    return null;
  }
}

export function sharedViewerWorkspaceKey(shareId: string): string {
  return `dragtrace:shared-viewer-workspace:v1:${shareId}`;
}
