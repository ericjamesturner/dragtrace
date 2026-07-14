import { useReducer, useEffect, useCallback, useMemo, useState, useRef } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id, Doc } from "../../convex/_generated/dataModel";
import { useNav } from "./Layout";
import { useLoadedLogs } from "@/hooks/useLoadedLogs";
import { useTimeslips } from "@/hooks/useTimeslips";
import { useViewerSync } from "@/hooks/useViewerSync";
import { useScatterSuggestions } from "@/hooks/useScatterSuggestions";
import { computeAlignment } from "@/lib/alignment";
import { buildTimeslipZones } from "@/lib/timeslip-zones";
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
import { WorkspaceMenu } from "./viewer/WorkspaceMenu";
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
      workspace={activeWorkspace}
      workspaces={workspaces}
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
  workspaces: Doc<"workspaces">[];
}

function LogViewerReady({
  vehicleId,
  eventId,
  fileIds,
  setFileIds,
  logs,
  errors,
  workspace,
  workspaces,
}: ReadyProps) {
  const { goToFiles } = useNav();
  const sync = useViewerSync();

  // Active workspace: ref for save callbacks, state for the menu UI
  const workspaceIdRef = useRef<Id<"workspaces"> | null>(workspace?._id ?? null);
  const [activeWorkspaceId, setActiveWorkspaceIdState] = useState<Id<"workspaces"> | null>(
    workspace?._id ?? null,
  );
  const setActiveWorkspaceId = useCallback(
    (id: Id<"workspaces"> | null) => {
      workspaceIdRef.current = id;
      setActiveWorkspaceIdState(id);
      try {
        if (id) localStorage.setItem(`dragtrace:ws:${vehicleId}`, id);
        else localStorage.removeItem(`dragtrace:ws:${vehicleId}`);
      } catch {
        // ignore
      }
    },
    [vehicleId],
  );

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

  // Background-fetch AI scatter suggestions for the current channel set and
  // persist them into the config (rides the existing debounced Convex save).
  useScatterSuggestions(
    logs,
    config,
    config.unitSystem ?? "imperial",
    config.unitOverrides,
    (suggestions, key) => dispatch({ type: "setScatterSuggestions", suggestions, key }),
  );

  // Active trace tracking
  const [activeTraceId, setActiveTraceId] = useState<string | null>(null);

  // Sidebar width (drag-resizable, persisted per browser)
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem("dragtrace:sidebarWidth"));
    return Number.isFinite(saved) && saved >= 180 && saved <= 600 ? saved : 256;
  });

  const handleSidebarResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = sidebarWidth;
      const onMove = (ev: MouseEvent) => {
        setSidebarWidth(Math.min(600, Math.max(180, startW + (ev.clientX - startX))));
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        setSidebarWidth((w) => {
          localStorage.setItem("dragtrace:sidebarWidth", String(w));
          return w;
        });
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [sidebarWidth],
  );

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
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const configRef = useRef(config);
  configRef.current = config;
  const unsavedRef = useRef(false);

  const flushSave = useCallback(() => {
    clearTimeout(saveTimerRef.current);
    unsavedRef.current = false;
    void saveWorkspace({
      id: workspaceIdRef.current ?? undefined,
      vehicleId,
      config: JSON.stringify(configRef.current),
    }).then((id) => {
      // Adopt the id of a freshly created workspace, unless the user
      // switched workspaces while the save was in flight.
      if (id && workspaceIdRef.current === null) {
        workspaceIdRef.current = id;
        setActiveWorkspaceIdState(id);
        try {
          localStorage.setItem(`dragtrace:ws:${vehicleId}`, id);
        } catch {
          // ignore
        }
      }
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

  // ── Named workspaces (switch / save-as / rename / delete) ──
  const renameWorkspaceMut = useMutation(api.workspaces.rename);
  const removeWorkspaceMut = useMutation(api.workspaces.remove);

  const handleSelectWorkspace = useCallback(
    (ws: Doc<"workspaces">) => {
      if (ws._id === workspaceIdRef.current) return;
      flushSave(); // persist current edits into the workspace being left
      setActiveWorkspaceId(ws._id);
      try {
        const parsed = remapConfigToFiles(migrateConfig(JSON.parse(ws.config)), logs);
        dispatch({ type: "loadConfig", config: parsed });
      } catch {
        // unreadable config — keep the current layout
      }
    },
    [flushSave, setActiveWorkspaceId, logs],
  );

  const handleSaveAsNew = useCallback(
    (name: string) => {
      void saveWorkspace({
        vehicleId,
        name,
        config: JSON.stringify(configRef.current),
      }).then((id) => {
        if (id) setActiveWorkspaceId(id);
      });
    },
    [saveWorkspace, vehicleId, setActiveWorkspaceId],
  );

  const handleRenameWorkspace = useCallback(
    (id: Id<"workspaces">, name: string) => {
      void renameWorkspaceMut({ id, name });
    },
    [renameWorkspaceMut],
  );

  const handleDeleteWorkspace = useCallback(
    (id: Id<"workspaces">) => {
      void removeWorkspaceMut({ id }).then(() => {
        if (workspaceIdRef.current !== id) return;
        // Fall back to the most recent remaining workspace (and its layout);
        // with none left, the next auto-save creates a fresh "Default".
        const fallback = workspaces
          .filter((w) => w._id !== id)
          .sort((a, b) => b.updatedAt - a.updatedAt)[0];
        if (fallback) {
          setActiveWorkspaceId(fallback._id);
          try {
            dispatch({
              type: "loadConfig",
              config: remapConfigToFiles(migrateConfig(JSON.parse(fallback.config)), logs),
            });
          } catch {
            // unreadable config — keep the current layout
          }
        } else {
          setActiveWorkspaceId(null);
        }
      });
    },
    [removeWorkspaceMut, setActiveWorkspaceId, workspaces, logs],
  );

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

  // Timeslip overlay strips: fetch per-file timeslips and build synthetic zones
  // anchored at each log's detected race-start (+ alignment offset).
  const timeslipsByFile = useTimeslips(fileIds);
  const showTimeslip = config.showTimeslip !== false; // default shown
  const timeslipZones = useMemo(
    () => buildTimeslipZones(logs, timeslipsByFile, alignment.offsets, showTimeslip),
    [logs, timeslipsByFile, alignment.offsets, showTimeslip],
  );

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
        wheelZoomEnabled={config.wheelZoomEnabled ?? true}
        wheelZoomFactor={config.wheelZoomFactor ?? 1.25}
        avgOnSelection={config.avgOnSelection !== false}
        showTimeslip={showTimeslip}
        onToggleAlignment={() => dispatch({ type: "toggleAlignment" })}
        onToggleAxes={() => dispatch({ type: "toggleAxes" })}
        onToggleAxisLabels={() => dispatch({ type: "toggleAxisLabels" })}
        onToggleUnitSystem={() => dispatch({ type: "setUnitSystem", system: (config.unitSystem ?? "imperial") === "imperial" ? "metric" : "imperial" })}
        onToggleWheelZoom={() => dispatch({ type: "setWheelZoomEnabled", enabled: !(config.wheelZoomEnabled ?? true) })}
        onSetWheelZoomFactor={(f) => dispatch({ type: "setWheelZoomFactor", factor: f })}
        onToggleAvgOnSelection={() => dispatch({ type: "toggleAvgOnSelection" })}
        onToggleTimeslip={() => dispatch({ type: "toggleTimeslip" })}
        onAddTrace={() => handleAddTrace()}
        onBack={handleBack}
        workspaceMenu={
          <WorkspaceMenu
            workspaces={workspaces}
            activeId={activeWorkspaceId}
            onSelect={handleSelectWorkspace}
            onSaveAsNew={handleSaveAsNew}
            onRename={handleRenameWorkspace}
            onDelete={handleDeleteWorkspace}
          />
        }
      />

      {errors.length > 0 && (
        <div className="px-3 py-1 bg-destructive/10 text-destructive text-xs">
          {errors.join("; ")}
        </div>
      )}

      <div className="flex flex-1 min-h-0">
        <div className="shrink-0 overflow-hidden" style={{ width: sidebarWidth }}>
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
            onCycleUnit={(metricUnit) => dispatch({ type: "cycleUnit", metricUnit })}
          />
        </div>

        {/* Sidebar width resize handle */}
        <div
          className="w-1 shrink-0 cursor-col-resize hover:bg-primary/30 active:bg-primary/40 transition-colors"
          onMouseDown={handleSidebarResize}
        />

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
          onSetChannelColorBy={(traceId, logFileId, channelName, colorBy, colorByMin, colorByMax) =>
            dispatch({ type: "setChannelColorBy", traceId, logFileId, channelName, colorBy, colorByMin, colorByMax })
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
          wheelZoomEnabled={config.wheelZoomEnabled ?? true}
          wheelZoomFactor={config.wheelZoomFactor ?? 1.25}
          avgOnSelection={config.avgOnSelection !== false}
          persistedSelection={config.pages.find((p) => p.id === config.activePageId)?.selection ?? null}
          onPersistSelection={(sel) => dispatch({ type: "setSelection", selection: sel })}
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
