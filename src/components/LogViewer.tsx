import { useReducer, useEffect, useCallback, useMemo, useState, useRef } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id, Doc } from "../../convex/_generated/dataModel";
import { useNav } from "./Layout";
import { useLoadedLogs } from "@/hooks/useLoadedLogs";
import { useTimeslips } from "@/hooks/useTimeslips";
import { useViewerSync } from "@/hooks/useViewerSync";
import { useScatterSuggestions } from "@/hooks/useScatterSuggestions";
import { useUnitPreferences } from "@/hooks/useUnitPreferences";
import { useMathChannels } from "@/hooks/useMathChannels";
import { useViewerAnalytics } from "@/hooks/useViewerAnalytics";
import { useActivityLog } from "@/hooks/useActivityLog";
import { buildDefaultConfig } from "@/lib/default-layout";
import {
  loadGuestWorkspace,
  saveGuestWorkspace,
} from "@/lib/guest-workspace";
import { computeAlignment } from "@/lib/alignment";
import { buildTimeslipZones } from "@/lib/timeslip-zones";
import {
  migrateConfig,
  remapConfigToFiles,
  getEffectiveTraces,
  getPinnedFromOtherIds,
  type ViewerConfig,
  type ViewerAction,
  type ChannelOnTrace,
  type LoadedLog,
  createViewerReducer,
} from "@/lib/viewer-types";
import { ViewerToolbar } from "./viewer/ViewerToolbar";
import { ViewerBreadcrumb } from "./viewer/ViewerBreadcrumb";
import { TracePanel } from "./viewer/TracePanel";
import { Share2Icon } from "lucide-react";

interface Props {
  vehicleId: Id<"vehicles">;
  eventId: Id<"events">;
  fileIds: Id<"files">[];
}

/** Total traces across every page — the signal that a layout still exists. */
function countTraces(config: ViewerConfig): number {
  return config.pages.reduce((n, p) => n + p.traces.length, 0);
}

function loadSavedConfig(eventId: Id<"events">): ViewerConfig | null {
  try {
    const raw = localStorage.getItem(`viewer:${eventId}`);
    if (raw) return migrateConfig(JSON.parse(raw));
  } catch {
    // ignore
  }
  return null;
}

function saveConfigLocal(eventId: Id<"events">, config: ViewerConfig) {
  try {
    localStorage.setItem(`viewer:${eventId}`, JSON.stringify(config));
  } catch {
    // ignore
  }
}

export default function LogViewer({ vehicleId, eventId, fileIds: initialFileIds }: Props) {
  const { goToFiles, goToViewer } = useNav();

  const [fileIds, setFileIds] = useState<Id<"files">[]>(initialFileIds);

  // Navigation can hand us a different set — "Open" on a pass does exactly
  // that. useState keeps only its first value, so without this the viewer
  // quietly ignored being told where to go. Keyed by the ids themselves, so
  // adding or removing a pass in here isn't clobbered by a re-render.
  const navFileKey = initialFileIds.join(",");
  useEffect(() => {
    setFileIds(initialFileIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navFileKey]);

  const { logs, loading, errors } = useLoadedLogs(fileIds);

  // Load workspaces from DB; active = last used for this vehicle, else most recent
  const workspaces = useQuery(api.workspaces.getForVehicle, { vehicleId });
  const workspacesLoading = workspaces === undefined;

  const activeWorkspace = useMemo(() => {
    if (!workspaces || workspaces.length === 0) return null;
    const storedId = localStorage.getItem(`dragtrace:ws:${vehicleId}`);
    return (
      workspaces.find((w) => w._id === storedId) ??
      [...workspaces].sort((a, b) => b.updatedAt - a.updatedAt)[0]
    );
  }, [workspaces, vehicleId]);

  if (loading || workspacesLoading) {
    return (
      <div className="flex h-dvh items-center justify-center text-muted-foreground">
        <div className="text-center">
          <div className="text-sm">Loading log file{fileIds.length > 1 ? "s" : ""}...</div>
        </div>
      </div>
    );
  }

  if (logs.length === 0) {
    return (
      <div className="flex h-dvh items-center justify-center text-muted-foreground">
        <div className="text-center">
          <div className="text-sm mb-2">No supported ECU logs found</div>
          {errors.map((e, i) => (
            <div key={i} className="text-xs text-destructive">{e}</div>
          ))}
          <button onClick={() => goToFiles(vehicleId, eventId)} className="mt-4 text-sm text-primary hover:underline cursor-pointer">
            Go back
          </button>
        </div>
      </div>
    );
  }

  return (
    <LogViewerReady
      key={vehicleId}
      vehicleId={vehicleId}
      eventId={eventId}
      fileIds={fileIds}
      setFileIds={setFileIds}
      logs={logs}
      errors={errors}
      workspace={activeWorkspace}
      goToFiles={goToFiles}
      goToViewer={goToViewer}
    />
  );
}

interface ReadyProps {
  vehicleId?: Id<"vehicles">;
  eventId?: Id<"events">;
  fileIds: Id<"files">[];
  setFileIds?: React.Dispatch<React.SetStateAction<Id<"files">[]>>;
  logs: LoadedLog[];
  errors: string[];
  workspace: Doc<"workspaces"> | null;
  publicMode?: boolean;
  publicLoading?: boolean;
  onAddPublicFiles?: () => void;
  onSharePublicLog?: () => void;
  publicLabel?: string;
  publicDetails?: {
    vehicleDetails?: string;
    description?: string;
  };
  initialPublicConfig?: ViewerConfig | null;
  publicWorkspaceStorageKey?: string;
  onPublicConfigChange?: (config: ViewerConfig) => void;
  autoFitPass?: boolean;
  onBack?: () => void;
  goToFiles?: (vehicleId: Id<"vehicles">, eventId: Id<"events">) => void;
  goToViewer?: (
    vehicleId: Id<"vehicles">,
    eventId: Id<"events">,
    fileIds: Id<"files">[],
  ) => void;
}

export function LogViewerReady({
  vehicleId,
  eventId,
  fileIds,
  setFileIds,
  logs,
  errors,
  workspace,
  publicMode = false,
  publicLoading = false,
  onAddPublicFiles,
  onSharePublicLog,
  publicLabel,
  publicDetails,
  initialPublicConfig,
  publicWorkspaceStorageKey,
  onPublicConfigChange,
  autoFitPass = false,
  onBack,
  goToFiles,
  goToViewer,
}: ReadyProps) {
  const sync = useViewerSync();
  const recordActivity = useActivityLog();
  useViewerAnalytics(
    publicMode ? "guest" : "account",
    logs.map((log) => log.contentFingerprint),
  );

  const activityFileKey = fileIds.join(",");
  useEffect(() => {
    if (publicMode || !vehicleId || !eventId || fileIds.length === 0) return;
    void recordActivity(
      fileIds.length > 1 ? "log_comparison_changed" : "log_opened",
      { vehicleId, eventId, fileIds },
    );
    // The joined key is the meaningful change; fileIds is stable between edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicMode, vehicleId, eventId, activityFileKey, recordActivity]);

  // A vehicle has one layout and it saves itself, so this is only ever the id
  // the auto-save writes back to.
  const workspaceIdRef = useRef<Id<"workspaces"> | null>(workspace?._id ?? null);

  // Computed before the channel map below, which mirror sync reads to decide
  // what each log has: a math channel added afterwards would be invisible to it
  // and never appear on the overlaid log.
  const math = useMathChannels(vehicleId, logs, !publicMode);

  // Build available channels map for mirror sync
  const channelsByLogRef = useRef<Map<string, Set<string>>>(new Map());
  channelsByLogRef.current = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const log of logs) {
      map.set(log.fileId, new Set(log.parsed.channelDefs.map((d) => d.name)));
    }
    return map;
  }, [logs, math.version]);

  // Reducer with mirror sync
  const reducerWithMirror = useCallback(
    (state: ViewerConfig, action: ViewerAction) => {
      const reducer = createViewerReducer(channelsByLogRef.current);
      return reducer(state, action);
    },
    []
  );

  // Guest files remain session-only, but their lightweight workspace is saved
  // in this browser and remapped by channel name onto the next logs they open.
  const [config, dispatch] = useReducer(reducerWithMirror, null, () => {
    if (publicMode) {
      const linkWorkspace = publicWorkspaceStorageKey
        ? loadGuestWorkspace(logs, undefined, publicWorkspaceStorageKey)
        : null;
      if (linkWorkspace) return linkWorkspace;
      if (initialPublicConfig) {
        return remapConfigToFiles(initialPublicConfig, logs);
      }
      return loadGuestWorkspace(logs) ?? buildDefaultConfig(logs);
    }
    if (!publicMode && workspace) {
      try {
        const saved = migrateConfig(JSON.parse(workspace.config));
        return remapConfigToFiles(saved, logs);
      } catch {
        // invalid config, fall through
      }
    }
    return !publicMode && eventId ? loadSavedConfig(eventId) ?? buildDefaultConfig(logs) : buildDefaultConfig(logs);
  });

  // Quantity preferences are the default. A channel can then choose its own
  // alternate without changing every other channel of the same quantity.
  const units = useUnitPreferences(vehicleId, !publicMode);
  const vehicleChannelOverrides = useQuery(
    api.vehicleChannelOverrides.listByVehicle,
    !publicMode && vehicleId ? { vehicleId } : "skip",
  );
  const setVehicleChannelOverride = useMutation(api.vehicleChannelOverrides.setOverride);
  const channelUnitOverrides = useMemo(() => {
    if (publicMode) return config.channelUnitOverrides ?? {};
    return Object.fromEntries(
      (vehicleChannelOverrides ?? [])
        .filter((override) => override.unitKey)
        .map((override) => [override.channelName, override.unitKey!]),
    );
  }, [publicMode, config.channelUnitOverrides, vehicleChannelOverrides]);
  const seedPrefs = useMutation(api.userPreferences.seedFromWorkspace);
  const seededRef = useRef(false);
  useEffect(() => {
    // One-time lift of unit choices that predate preferences existing.
    if (publicMode || seededRef.current || units.loading) return;
    seededRef.current = true;
    if (config.unitSystem || config.unitOverrides) {
      void seedPrefs({
        unitSystem: config.unitSystem,
        unitOverrides: config.unitOverrides ? JSON.stringify(config.unitOverrides) : undefined,
      });
    }
  }, [publicMode, units.loading, config.unitSystem, config.unitOverrides, seedPrefs]);

  // Selected but not yet fetched and parsed. Adding a pass is not instant on a
  // multi-megabyte log, and without this the card checks itself immediately
  // while the chart stays unchanged, which reads as nothing having happened.
  const pendingFileIds = useMemo(() => {
    const have = new Set(logs.map((l) => l.fileId as string));
    return fileIds.filter((id) => !have.has(id as string));
  }, [fileIds, logs]);

  // Compute effective traces
  const effectiveTraces = useMemo(() => getEffectiveTraces(config), [config]);
  const pinnedFromOtherIds = useMemo(() => getPinnedFromOtherIds(config), [config]);

  // Background-fetch AI scatter suggestions for the current channel set and
  // persist them into the config (rides the existing debounced Convex save).
  useScatterSuggestions(
    logs,
    config,
    publicMode ? (config.unitSystem ?? "imperial") : units.unitSystem,
    publicMode ? (config.unitOverrides ?? {}) : units.resolved,
    (suggestions, key) => dispatch({ type: "setScatterSuggestions", suggestions, key }),
    !publicMode,
  );

  // Active trace tracking
  const [activeTraceId, setActiveTraceId] = useState<string | null>(null);

  useEffect(() => {
    if (activeTraceId && !effectiveTraces.some((t) => t.id === activeTraceId)) {
      setActiveTraceId(effectiveTraces[effectiveTraces.length - 1]?.id ?? null);
    }
  }, [effectiveTraces, activeTraceId]);

  // Save to localStorage (immediate). Account viewers keep the existing
  // event-local fallback; guests get one reusable browser-local workspace.
  useEffect(() => {
    if (publicMode) {
      saveGuestWorkspace(config, undefined, publicWorkspaceStorageKey);
    }
    else if (eventId) saveConfigLocal(eventId, config);
  }, [publicMode, publicWorkspaceStorageKey, eventId, config]);

  useEffect(() => {
    if (publicMode) onPublicConfigChange?.(config);
  }, [publicMode, onPublicConfigChange, config]);

  // Save to DB (debounced, flushed on unmount)
  const saveWorkspace = useMutation(api.workspaces.save);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const configRef = useRef(config);
  configRef.current = config;
  const unsavedRef = useRef(false);

  // A workspace that has lost every trace is almost always the result of a
  // failed remap or mirror sync rather than the user emptying it by hand, and
  // persisting it destroys the layout irrecoverably. Refuse to write that; the
  // in-memory config still reflects what's on screen, so nothing is frozen.
  const savedTraceCountRef = useRef(countTraces(config));
  const isDestructiveSave = useCallback(() => {
    const now = countTraces(configRef.current);
    return now === 0 && savedTraceCountRef.current > 0;
  }, []);

  const flushSave = useCallback(() => {
    if (publicMode || !vehicleId) return;
    clearTimeout(saveTimerRef.current);
    unsavedRef.current = false;
    if (isDestructiveSave()) {
      console.warn(
        "[dragtrace] Skipped saving a workspace that lost all of its traces — " +
          "keeping the stored layout instead.",
      );
      return;
    }
    savedTraceCountRef.current = countTraces(configRef.current);
    void saveWorkspace({
      id: workspaceIdRef.current ?? undefined,
      vehicleId,
      config: JSON.stringify(configRef.current),
    }).then((id) => {
      // Adopt the id the first save creates, so the next one updates it in
      // place instead of making another.
      if (id && workspaceIdRef.current === null) {
        workspaceIdRef.current = id;
        try {
          localStorage.setItem(`dragtrace:ws:${vehicleId}`, id);
        } catch {
          // ignore
        }
      }
    });
  }, [publicMode, vehicleId, saveWorkspace, isDestructiveSave]);

  useEffect(() => {
    if (publicMode) return;
    unsavedRef.current = true;
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      unsavedRef.current = false;
      flushSave();
    }, 2000);
    return () => clearTimeout(saveTimerRef.current);
  }, [publicMode, config, flushSave]);

  // Flush save on unmount so navigating away doesn't lose changes
  useEffect(() => {
    if (publicMode) return;
    return () => {
      if (unsavedRef.current) {
        flushSave();
      }
    };
  }, [publicMode, flushSave]);

  // Opening a different pass swaps the loaded logs, but the layout still names
  // the old one — every channel on every trace is keyed to a file id that is no
  // longer here, so the charts come up empty. Remap by channel name onto what's
  // loaded now. Removing a pass is already handled by purgeFile, and adding one
  // leaves nothing stale, so this only fires on a genuine swap.
  const loadedLogKey = logs.map((l) => l.fileId as string).join(",");
  useEffect(() => {
    if (publicMode) return;
    const here = new Set(logs.map((l) => l.fileId as string));
    if (here.size === 0) return;
    const stale = configRef.current.pages.some((page) =>
      page.traces.some((t) => t.channels.some((c) => !here.has(c.logFileId as string))),
    );
    if (!stale) return;
    dispatch({ type: "loadConfig", config: remapConfigToFiles(configRef.current, logs) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicMode, loadedLogKey]);

  // Overlaying a pass is always about comparing the same channels, so every log
  // after the first mirrors the first rather than carrying its own selection.
  // Derived from what's loaded — the first log is the source, and if it's
  // unloaded the next one inherits that role with the channels already on it.
  useEffect(() => {
    if (logs.length === 0) return;
    const want = logs.slice(1).map((l) => l.fileId as string);
    const have = config.mirroredLogIds ?? [];
    if (want.length === have.length && want.every((id, i) => have[i] === id)) return;
    dispatch({ type: "setMirroredLogs", logFileIds: want });
  }, [logs, config.mirroredLogIds]);

  // Math definitions mutate the parsed channel lists after the logs are loaded,
  // so re-apply mirror sync when those definitions change. Log additions are
  // handled by setMirroredLogs above; replaying a stale config here would race
  // that action and leave the newest comparison log loaded but not drawn.
  const prevMathVersionRef = useRef(math.version);
  useEffect(() => {
    if (
      math.version !== prevMathVersionRef.current &&
      (config.mirroredLogIds?.length ?? 0) > 0
    ) {
      dispatch({ type: "loadConfig", config });
    }
    prevMathVersionRef.current = math.version;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [math.version]);

  // Update URL when fileIds change
  useEffect(() => {
    if (publicMode || !vehicleId || !eventId) return;
    const params = new URLSearchParams(window.location.search);
    const currentViewer = params.get("viewer");
    const newViewer = fileIds.join(",");
    if (currentViewer !== newViewer) {
      params.set("vehicle", vehicleId);
      params.set("event", eventId);
      params.set("viewer", newViewer);
      window.history.replaceState(null, "", `?${params.toString()}`);
    }
  }, [publicMode, fileIds, vehicleId, eventId]);

  // Compute alignment
  const alignment = useMemo(() => {
    if (logs.length === 0) return { offsets: new Map(), globalRange: [0, 1] as [number, number] };
    return computeAlignment(logs, config.alignByRaceTime);
  }, [logs, config.alignByRaceTime]);

  // Timeslip overlay strips: fetch per-file timeslips and build synthetic zones
  // anchored at each log's detected race-start (+ alignment offset).
  const timeslipsByFile = useTimeslips(fileIds, !publicMode);
  const showTimeslip = true;
  const timeslipZones = useMemo(
    () => buildTimeslipZones(logs, timeslipsByFile, alignment.offsets, showTimeslip),
    [logs, timeslipsByFile, alignment.offsets, showTimeslip],
  );

  const handleBack = useCallback(() => {
    if (onBack) onBack();
    else if (goToFiles && vehicleId && eventId) goToFiles(vehicleId, eventId);
  }, [onBack, goToFiles, vehicleId, eventId]);

  const handleAddFile = useCallback((fileId: Id<"files">) => {
    setFileIds?.((prev) => {
      if (prev.includes(fileId)) return prev;
      return [...prev, fileId];
    });
  }, [setFileIds]);

  const handleRemoveFile = useCallback((fileId: Id<"files">) => {
    // A viewer with no log has nothing to draw, so unloading the last one is a
    // no-op. Crucially it must not purge either: the old code refused to drop
    // the file but purged anyway, stripping every channel from every trace
    // while the log stayed loaded — and since the file was still in fileIds,
    // re-selecting it did nothing.
    if (fileIds.length <= 1) return;
    setFileIds?.((prev) => prev.filter((id) => id !== fileId));
    dispatch({ type: "purgeFile", logFileId: fileId });
  }, [fileIds, setFileIds]);

  const unitSystem = publicMode ? (config.unitSystem ?? "imperial") : units.unitSystem;
  const unitOverrides = publicMode ? (config.unitOverrides ?? {}) : units.resolved;

  // A trace made from the toolbar has nothing on it, and the next thing anyone
  // wants is to say what goes on it — so the picker opens with it.
  const [pickChannelsFor, setPickChannelsFor] = useState<string | null>(null);

  const handleAddTrace = useCallback(
    (channels?: ChannelOnTrace[]) => {
      const id = `trace-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      dispatch({ type: "addTrace", id, channels });
      setActiveTraceId(id);
      if (!channels || channels.length === 0) setPickChannelsFor(id);
    },
    []
  );

  const handleAddTraceWithChannel = useCallback(
    (channel: ChannelOnTrace) => {
      const id = `trace-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      dispatch({ type: "addTrace", id, channels: [channel] });
      setActiveTraceId(id);
    },
    []
  );

  useEffect(() => {
    if (effectiveTraces.length > 0 && !activeTraceId) {
      setActiveTraceId(effectiveTraces[effectiveTraces.length - 1].id);
    }
  }, [effectiveTraces, activeTraceId]);

  return (
    <div className="flex flex-col h-dvh">
      <ViewerToolbar
        onAddTrace={() => handleAddTrace()}
        onBack={handleBack}
        feedbackSource={publicMode ? "guest" : "account"}
        breadcrumb={
          publicMode ? (
            <div className="flex min-w-0 items-center gap-2">
              <div
                className="min-w-0"
                title={logs.map((log) => log.fileName).join("\n")}
              >
                <div className="truncate text-sm font-medium">
                  {logs.length === 1 ? logs[0]?.fileName : `${logs.length} logs`}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {publicLabel ?? "Guest viewer · layout saved locally"}
                </div>
              </div>
              {onSharePublicLog && (
                <button
                  type="button"
                  onClick={onSharePublicLog}
                  className="flex shrink-0 cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <Share2Icon className="size-3.5" />
                  Share log
                </button>
              )}
              {onAddPublicFiles && (
                <button
                  type="button"
                  disabled={publicLoading}
                  onClick={onAddPublicFiles}
                  className="shrink-0 cursor-pointer rounded-md border px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-wait disabled:opacity-60"
                >
                  {publicLoading ? "Opening…" : "+ Add logs"}
                </button>
              )}
            </div>
          ) : vehicleId && eventId ? (
            <ViewerBreadcrumb
              vehicleId={vehicleId}
              eventId={eventId}
              loadedFileIds={fileIds}
              pendingFileIds={pendingFileIds}
              onOpen={(v, e, fileId) => goToViewer?.(v, e, [fileId])}
              onCompare={handleAddFile}
              onRemove={handleRemoveFile}
              hiddenLogIds={config.hiddenLogIds ?? []}
              onToggleVisibility={(logFileId) =>
                dispatch({ type: "toggleLogVisibility", logFileId })
              }
            />
          ) : null
        }
      />

      {publicMode &&
        (publicDetails?.vehicleDetails || publicDetails?.description) && (
          <div className="max-h-32 overflow-y-auto border-b bg-muted/30 px-3 py-2.5">
            <div className="flex flex-col gap-1.5 text-xs sm:flex-row sm:items-start sm:gap-5">
              {publicDetails.vehicleDetails && (
                <p className="shrink-0">
                  <span className="font-medium text-foreground">Vehicle:</span>{" "}
                  <span className="text-muted-foreground">
                    {publicDetails.vehicleDetails}
                  </span>
                </p>
              )}
              {publicDetails.description && (
                <p className="whitespace-pre-wrap text-muted-foreground">
                  <span className="font-medium text-foreground">
                    Description / question:
                  </span>{" "}
                  {publicDetails.description}
                </p>
              )}
            </div>
          </div>
        )}

      {errors.length > 0 && (
        <div className="px-3 py-1 bg-destructive/10 text-destructive text-xs">
          {errors.join("; ")}
        </div>
      )}

      {/* No sidebar: the toolbar picks passes, and a trace owns its channels.
          The charts get the whole window. */}
      <div className="flex flex-1 min-h-0">
        <TracePanel
          logs={logs}
          avgOnSelection
          showAxes={!!config.showAxes}
          showAxisLabels={!!config.showAxisLabels}
          unitSystem={unitSystem}
          traces={effectiveTraces}
          pinnedFromOtherIds={pinnedFromOtherIds}
          pages={config.pages}
          activePageId={config.activePageId}
          onAddPage={() => dispatch({ type: "addPage" })}
          onRemovePage={(pageId) => dispatch({ type: "removePage", pageId })}
          onRenamePage={(pageId, label) => dispatch({ type: "renamePage", pageId, label })}
          onSwitchPage={(pageId) => dispatch({ type: "switchPage", pageId })}
          onToggleTracePin={(traceId) => dispatch({ type: "toggleTracePin", traceId })}
            syncKey={sync.key}
          offsets={alignment.offsets}
          globalRange={alignment.globalRange}
          autoFitPass={autoFitPass}
          activeTraceId={activeTraceId}
          hiddenLogIds={config.hiddenLogIds ?? []}
          mirroredLogIds={config.mirroredLogIds ?? []}
              onSetActiveTrace={setActiveTraceId}
          onRemoveTrace={(traceId) => dispatch({ type: "removeTrace", traceId })}
          onReorderTrace={(traceId, beforeTraceId) =>
            dispatch({ type: "reorderTrace", traceId, beforeTraceId })
          }
          onRemoveChannel={(traceId, logFileId, channelName) =>
            dispatch({ type: "removeChannel", traceId, logFileId, channelName })
          }
          onAddChannel={(traceId, channel) =>
            dispatch({ type: "addChannel", traceId, channel })
          }
          onResizeTrace={(traceId, height) =>
            dispatch({ type: "setTraceHeight", traceId, height })
          }
          onAddTraceWithChannel={handleAddTraceWithChannel}
          onSetChannelColor={(traceId, logFileId, channelName, color) =>
            dispatch({ type: "setChannelColor", traceId, logFileId, channelName, color })
          }
          onSetChannelOpacity={(traceId, logFileId, channelName, opacity) =>
            dispatch({ type: "setChannelOpacity", traceId, logFileId, channelName, opacity })
          }
          onSetChannelWidth={(traceId, logFileId, channelName, width) =>
            dispatch({ type: "setChannelWidth", traceId, logFileId, channelName, width })
          }
          onSetChannelDash={(traceId, logFileId, channelName, dash) =>
            dispatch({ type: "setChannelDash", traceId, logFileId, channelName, dash })
          }
          onSetChannelAxisRange={(traceId, logFileId, channelName, axisMin, axisMax) =>
            dispatch({ type: "setChannelAxisRange", traceId, logFileId, channelName, axisMin, axisMax })
          }
          onSetChannelSignalFilter={(traceId, logFileId, channelName, signalFilter) =>
            dispatch({ type: "setChannelSignalFilter", traceId, logFileId, channelName, signalFilter })
          }
          onSetChannelColorBy={(traceId, logFileId, channelName, colorBy, colorByMin, colorByMax, colorByLowColor, colorByHighColor) =>
            dispatch({ type: "setChannelColorBy", traceId, logFileId, channelName, colorBy, colorByMin, colorByMax, colorByLowColor, colorByHighColor })
          }
          onAddZone={(traceId, zone) =>
            dispatch({ type: "addZone", traceId, zone })
          }
          onUpdateZone={(traceId, zoneId, updates) =>
            dispatch({ type: "updateZone", traceId, zoneId, updates })
          }
          onRemoveZone={(traceId, zoneId) =>
            dispatch({ type: "removeZone", traceId, zoneId })
          }
          onToggleZone={(traceId, zoneId) =>
            dispatch({ type: "toggleZone", traceId, zoneId })
          }
            unitOverrides={unitOverrides}
          channelUnitOverrides={channelUnitOverrides}
                    onSetTraceHeights={(heights) => dispatch({ type: "setTraceHeights", heights })}
          onToggleTraceCollapsed={(traceId) => dispatch({ type: "toggleTraceCollapsed", traceId })}
          onToggleTraceTimeslip={(traceId) => dispatch({ type: "toggleTraceTimeslip", traceId })}
          onToggleTraceZones={(traceId) => dispatch({ type: "toggleTraceZones", traceId })}
          pickChannelsFor={pickChannelsFor}
          vehicleId={vehicleId}
          accountFeatures={!publicMode}
          mathChannels={math.definitions}
          mathVersion={math.version}
          onSetUnit={(channelName, unitKey) => {
            if (publicMode) {
              dispatch({
                type: "setChannelUnitOverride",
                channelName,
                alternateKey: unitKey,
              });
            } else if (vehicleId) {
              void setVehicleChannelOverride({ vehicleId, channelName, unitKey });
            }
          }}
          onSetTraceChannelOrder={(traceId, channelNames) =>
            dispatch({ type: "setTraceChannelOrder", traceId, channelNames })
          }
          legendWidth={config.legendWidth}
          legendCollapsed={config.legendCollapsed}
          onSetLegendWidth={(width) => dispatch({ type: "setLegendWidth", width })}
          onToggleLegendCollapsed={() => dispatch({ type: "toggleLegendCollapsed" })}
          onSetChannelsHidden={(traceId, keys, hidden) =>
            dispatch({ type: "setChannelsHidden", traceId, keys, hidden })
          }
            persistedSelection={config.selection ?? null}
          onPersistSelection={(sel) => dispatch({ type: "setSelection", selection: sel })}
          persistedZoom={config.zoom ?? null}
          onPersistZoom={(zoom) => dispatch({ type: "setZoom", zoom })}
          timeslipZones={timeslipZones}
          expandedTimeslipIds={config.expandedTimeslipIds ?? []}
          onToggleTimeslipExpand={(id) => dispatch({ type: "toggleTimeslipExpand", id })}
          raceLine={{ color: config.raceLineColor, width: config.raceLineWidth, dash: config.raceLineDash }}
          onSetRaceLineStyle={(s) => dispatch({ type: "setRaceLineStyle", color: s.color, width: s.width, dash: s.dash })}
          scatterSuggestions={config.scatterSuggestions ?? []}
          onAddScatter={(scatter) => dispatch({ type: "addScatter", scatter })}
          onRemoveScatter={(scatterId) => dispatch({ type: "removeScatter", scatterId })}
          onUpdateScatter={(scatterId, updates) => dispatch({ type: "updateScatter", scatterId, updates })}
          onAddHeatmap={(heatmap) => dispatch({ type: "addHeatmap", heatmap })}
          onRemoveHeatmap={(heatmapId) => dispatch({ type: "removeHeatmap", heatmapId })}
          onUpdateHeatmap={(heatmapId, updates) => dispatch({ type: "updateHeatmap", heatmapId, updates })}
        />
      </div>
    </div>
  );
}
