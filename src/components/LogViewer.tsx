import { useReducer, useEffect, useCallback, useMemo, useState, useRef } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id, Doc } from "../../convex/_generated/dataModel";
import { useNav } from "./Layout";
import { useLoadedLogs } from "@/hooks/useLoadedLogs";
import { useViewerSync } from "@/hooks/useViewerSync";
import { computeAlignment } from "@/lib/alignment";
import {
  defaultViewerConfig,
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
import { ViewerSidebar } from "./viewer/ViewerSidebar";
import { TracePanel } from "./viewer/TracePanel";

interface Props {
  vehicleId: Id<"vehicles">;
  eventId: Id<"events">;
  fileIds: Id<"files">[];
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
  const { goToFiles } = useNav();

  const [fileIds, setFileIds] = useState<Id<"files">[]>(initialFileIds);
  const { logs, loading, errors } = useLoadedLogs(fileIds);

  // Load workspace from DB
  const workspaces = useQuery(api.workspaces.getForVehicle, { vehicleId });
  const workspacesLoading = workspaces === undefined;

  if (loading || workspacesLoading) {
    return (
      <div className="flex h-screen items-center justify-center text-muted-foreground">
        <div className="text-center">
          <div className="text-sm">Loading log file{fileIds.length > 1 ? "s" : ""}...</div>
        </div>
      </div>
    );
  }

  if (logs.length === 0) {
    return (
      <div className="flex h-screen items-center justify-center text-muted-foreground">
        <div className="text-center">
          <div className="text-sm mb-2">No valid Haltech logs found</div>
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
      workspace={workspaces[0] ?? null}
    />
  );
}

interface ReadyProps {
  vehicleId: Id<"vehicles">;
  eventId: Id<"events">;
  fileIds: Id<"files">[];
  setFileIds: React.Dispatch<React.SetStateAction<Id<"files">[]>>;
  logs: LoadedLog[];
  errors: string[];
  workspace: Doc<"workspaces"> | null;
}

function LogViewerReady({
  vehicleId,
  eventId,
  fileIds,
  setFileIds,
  logs,
  errors,
  workspace,
}: ReadyProps) {
  const { goToFiles } = useNav();
  const sync = useViewerSync();

  // Track workspace ID for updates
  const workspaceIdRef = useRef<Id<"workspaces"> | null>(workspace?._id ?? null);

  // Build available channels map for mirror sync
  const channelsByLogRef = useRef<Map<string, Set<string>>>(new Map());
  channelsByLogRef.current = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const log of logs) {
      map.set(log.fileId, new Set(log.parsed.channelDefs.map((d) => d.name)));
    }
    return map;
  }, [logs]);

  // Reducer with mirror sync
  const reducerWithMirror = useCallback(
    (state: ViewerConfig, action: ViewerAction) => {
      const reducer = createViewerReducer(channelsByLogRef.current);
      return reducer(state, action);
    },
    []
  );

  // Initialize config: DB workspace > localStorage > default
  const [config, dispatch] = useReducer(reducerWithMirror, null, () => {
    if (workspace) {
      try {
        const saved = migrateConfig(JSON.parse(workspace.config));
        return remapConfigToFiles(saved, logs);
      } catch {
        // invalid config, fall through
      }
    }
    return loadSavedConfig(eventId) ?? defaultViewerConfig;
  });

  // Compute effective traces
  const effectiveTraces = useMemo(() => getEffectiveTraces(config), [config]);
  const pinnedFromOtherIds = useMemo(() => getPinnedFromOtherIds(config), [config]);

  // Active trace tracking
  const [activeTraceId, setActiveTraceId] = useState<string | null>(null);

  useEffect(() => {
    if (activeTraceId && !effectiveTraces.some((t) => t.id === activeTraceId)) {
      setActiveTraceId(effectiveTraces[effectiveTraces.length - 1]?.id ?? null);
    }
  }, [effectiveTraces, activeTraceId]);

  // Save to localStorage (immediate)
  useEffect(() => {
    saveConfigLocal(eventId, config);
  }, [eventId, config]);

  // Save to DB (debounced, flushed on unmount)
  const saveWorkspace = useMutation(api.workspaces.save);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const configRef = useRef(config);
  configRef.current = config;
  const unsavedRef = useRef(false);

  const flushSave = useCallback(() => {
    clearTimeout(saveTimerRef.current);
    unsavedRef.current = false;
    void saveWorkspace({
      id: workspaceIdRef.current ?? undefined,
      vehicleId,
      name: "Default",
      config: JSON.stringify(configRef.current),
    }).then((id) => {
      if (id) workspaceIdRef.current = id;
    });
  }, [vehicleId, saveWorkspace]);

  useEffect(() => {
    unsavedRef.current = true;
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      unsavedRef.current = false;
      flushSave();
    }, 2000);
    return () => clearTimeout(saveTimerRef.current);
  }, [config, flushSave]);

  // Flush save on unmount so navigating away doesn't lose changes
  useEffect(() => {
    return () => {
      if (unsavedRef.current) {
        flushSave();
      }
    };
  }, [flushSave]);

  // Re-apply mirror sync when logs load/change
  const prevLogsLenRef = useRef(0);
  useEffect(() => {
    if (logs.length > 0 && logs.length !== prevLogsLenRef.current && (config.mirroredLogIds?.length ?? 0) > 0) {
      dispatch({ type: "loadConfig", config });
    }
    prevLogsLenRef.current = logs.length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logs.length]);

  // Update URL when fileIds change
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const currentViewer = params.get("viewer");
    const newViewer = fileIds.join(",");
    if (currentViewer !== newViewer) {
      params.set("vehicle", vehicleId);
      params.set("event", eventId);
      params.set("viewer", newViewer);
      window.history.replaceState(null, "", `?${params.toString()}`);
    }
  }, [fileIds, vehicleId, eventId]);

  // Compute alignment
  const alignment = useMemo(() => {
    if (logs.length === 0) return { offsets: new Map(), globalRange: [0, 1] as [number, number] };
    return computeAlignment(logs, config.alignByRaceTime);
  }, [logs, config.alignByRaceTime]);

  const handleBack = useCallback(() => {
    goToFiles(vehicleId, eventId);
  }, [goToFiles, vehicleId, eventId]);

  const handleAddFile = useCallback((fileId: Id<"files">) => {
    setFileIds((prev) => {
      if (prev.includes(fileId)) return prev;
      return [...prev, fileId];
    });
    // Auto-mirror new logs so they show the same channels
    dispatch({ type: "toggleMirrorLog", logFileId: fileId });
  }, [setFileIds]);

  const handleRemoveFile = useCallback((fileId: Id<"files">) => {
    setFileIds((prev) => {
      const next = prev.filter((id) => id !== fileId);
      return next.length > 0 ? next : prev;
    });
    dispatch({ type: "purgeFile", logFileId: fileId });
  }, [setFileIds]);

  const handleAddTrace = useCallback(
    (channels?: ChannelOnTrace[]) => {
      const id = `trace-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      dispatch({ type: "addTrace", id, channels });
      setActiveTraceId(id);
    },
    []
  );

  const handleAddChannel = useCallback((traceId: string, channel: ChannelOnTrace) => {
    dispatch({ type: "addChannel", traceId, channel });
    setActiveTraceId(traceId);
  }, []);

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
    <div className="flex flex-col h-screen">
      <ViewerToolbar
        logs={logs}
        alignByRaceTime={config.alignByRaceTime}
        showAxes={!!config.showAxes}
        showAxisLabels={!!config.showAxisLabels}
        unitSystem={config.unitSystem ?? "imperial"}
        onToggleAlignment={() => dispatch({ type: "toggleAlignment" })}
        onToggleAxes={() => dispatch({ type: "toggleAxes" })}
        onToggleAxisLabels={() => dispatch({ type: "toggleAxisLabels" })}
        onToggleUnitSystem={() => dispatch({ type: "setUnitSystem", system: (config.unitSystem ?? "imperial") === "imperial" ? "metric" : "imperial" })}
        onAddTrace={() => handleAddTrace()}
        onBack={handleBack}
      />

      {errors.length > 0 && (
        <div className="px-3 py-1 bg-destructive/10 text-destructive text-xs">
          {errors.join("; ")}
        </div>
      )}

      <div className="flex flex-1 min-h-0">
        <div className="w-64 shrink-0 overflow-hidden">
          <ViewerSidebar
            logs={logs}
            vehicleId={vehicleId}
            loadedFileIds={fileIds}
            traces={effectiveTraces}
            hiddenLogIds={config.hiddenLogIds ?? []}
            mirroredLogIds={config.mirroredLogIds ?? []}
            onAddFile={handleAddFile}
            onRemoveFile={handleRemoveFile}
            onAddChannel={handleAddChannel}
            onAddTraceWithChannel={handleAddTraceWithChannel}
            onRemoveChannel={(traceId, logFileId, channelName) =>
              dispatch({ type: "removeChannel", traceId, logFileId, channelName })
            }
            onToggleLogVisibility={(logFileId) =>
              dispatch({ type: "toggleLogVisibility", logFileId })
            }
            onToggleMirrorLog={(logFileId) =>
              dispatch({ type: "toggleMirrorLog", logFileId })
            }
            activeTraceId={activeTraceId}
            unitSystem={config.unitSystem ?? "imperial"}
            unitOverrides={config.unitOverrides}
          />
        </div>

        <TracePanel
          traces={effectiveTraces}
          pinnedFromOtherIds={pinnedFromOtherIds}
          pages={config.pages}
          activePageId={config.activePageId}
          onAddPage={() => dispatch({ type: "addPage" })}
          onRemovePage={(pageId) => dispatch({ type: "removePage", pageId })}
          onRenamePage={(pageId, label) => dispatch({ type: "renamePage", pageId, label })}
          onSwitchPage={(pageId) => dispatch({ type: "switchPage", pageId })}
          onToggleTracePin={(traceId) => dispatch({ type: "toggleTracePin", traceId })}
          logs={logs}
          syncKey={sync.key}
          offsets={alignment.offsets}
          globalRange={alignment.globalRange}
          activeTraceId={activeTraceId}
          hiddenLogIds={config.hiddenLogIds ?? []}
          mirroredLogIds={config.mirroredLogIds ?? []}
          showAxes={!!config.showAxes}
          showAxisLabels={!!config.showAxisLabels}
          onSetActiveTrace={setActiveTraceId}
          onRemoveTrace={(traceId) => dispatch({ type: "removeTrace", traceId })}
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
          unitSystem={config.unitSystem ?? "imperial"}
          unitOverrides={config.unitOverrides}
        />
      </div>
    </div>
  );
}
