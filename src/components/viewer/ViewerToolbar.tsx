import { Button } from "@/components/ui/button";
import { ChevronLeftIcon, PlusIcon, ZoomInIcon, SigmaIcon, FlagIcon, StretchVerticalIcon, ListIcon } from "lucide-react";
import { Tip } from "@/components/ui/tooltip";

interface Props {
  wheelZoomEnabled: boolean;
  wheelZoomFactor: number;
  wheelMode: "zoom" | "scroll";
  fitTraces: boolean;
  compactLegend: boolean;
  avgOnSelection: boolean;
  showTimeslip: boolean;
  onToggleWheelZoom: () => void;
  onSetWheelZoomFactor: (factor: number) => void;
  onSetWheelMode: (mode: "zoom" | "scroll") => void;
  onToggleFitTraces: () => void;
  onApplyLayoutPreset: (preset: "focusTop" | "equal") => void;
  onToggleCompactLegend: () => void;
  onToggleAvgOnSelection: () => void;
  onToggleTimeslip: () => void;
  onAddTrace: () => void;
  onBack: () => void;
  workspaceMenu?: React.ReactNode;
}

export function ViewerToolbar({ wheelZoomEnabled, wheelZoomFactor, wheelMode, fitTraces, compactLegend, avgOnSelection, showTimeslip, onToggleWheelZoom, onSetWheelZoomFactor, onSetWheelMode, onToggleFitTraces, onApplyLayoutPreset, onToggleCompactLegend, onToggleAvgOnSelection, onToggleTimeslip, onAddTrace, onBack, workspaceMenu }: Props) {
  return (
    <div className="flex items-center gap-3 border-b px-3 py-2 shrink-0 bg-background">
      <Button variant="ghost" size="sm" onClick={onBack}>
        <ChevronLeftIcon className="size-4 mr-1" />
        Back
      </Button>

      {workspaceMenu}

      <div className="flex-1" />

      <div className="flex items-center gap-1.5">
        <Tip content="Cursor-centered mouse-wheel zoom">
          <Button
            variant={wheelZoomEnabled ? "default" : "outline"}
            size="sm"
            onClick={onToggleWheelZoom}
          >
            <ZoomInIcon className="size-4 mr-1" />
            Wheel
          </Button>
        </Tip>
        {wheelZoomEnabled && (
          <>
            <Tip content="Wheel zoom sensitivity">
              <select
                value={String(wheelZoomFactor)}
                onChange={(e) => onSetWheelZoomFactor(Number(e.target.value))}
                className="h-8 rounded-md border border-input bg-background px-2 text-sm cursor-pointer"
              >
                <option value="1.1">Low</option>
                <option value="1.25">Med</option>
                <option value="1.5">High</option>
              </select>
            </Tip>
            <Tip
              content={
                wheelMode === "zoom"
                  ? "Wheel zooms time; shift+wheel scrolls the trace list"
                  : "Wheel scrolls the trace list; shift/ctrl+wheel zooms time"
              }
            >
              <select
                value={wheelMode}
                onChange={(e) => onSetWheelMode(e.target.value as "zoom" | "scroll")}
                className="h-8 rounded-md border border-input bg-background px-2 text-sm cursor-pointer"
              >
                <option value="zoom">Zoom</option>
                <option value="scroll">Scroll</option>
              </select>
            </Tip>
          </>
        )}
        <Tip content="Size traces to fill the panel instead of using fixed heights">
          <Button
            variant={fitTraces ? "default" : "outline"}
            size="sm"
            onClick={onToggleFitTraces}
          >
            <StretchVerticalIcon className="size-4 mr-1" />
            Fit
          </Button>
        </Tip>
        {fitTraces && (
          <Tip content="Preset trace proportions">
            <select
              value=""
              onChange={(e) => {
                if (e.target.value) onApplyLayoutPreset(e.target.value as "focusTop" | "equal");
                e.target.value = "";
              }}
              className="h-8 rounded-md border border-input bg-background px-2 text-sm cursor-pointer"
            >
              <option value="">Layout…</option>
              <option value="focusTop">Focus top</option>
              <option value="equal">Equal</option>
            </select>
          </Tip>
        )}
        <Tip content="Compact the channel legend into each trace's header so it stops covering the plot (the full readout returns while a range is selected)">
          <Button
            variant={compactLegend ? "default" : "outline"}
            size="sm"
            onClick={onToggleCompactLegend}
          >
            <ListIcon className="size-4 mr-1" />
            Compact
          </Button>
        </Tip>
        <Tip content="Show average over a drag-selected range in the channel readout">
          <Button
            variant={avgOnSelection ? "default" : "outline"}
            size="sm"
            onClick={onToggleAvgOnSelection}
          >
            <SigmaIcon className="size-4 mr-1" />
            Avg
          </Button>
        </Tip>
        <Tip content="Show timeslip distance markers as a colored strip on every trace">
          <Button
            variant={showTimeslip ? "default" : "outline"}
            size="sm"
            onClick={onToggleTimeslip}
          >
            <FlagIcon className="size-4 mr-1" />
            Timeslip
          </Button>
        </Tip>
        <Tip content="Add a new trace">
          <Button variant="outline" size="sm" onClick={onAddTrace}>
            <PlusIcon className="size-4 mr-1" />
            Trace
          </Button>
        </Tip>
      </div>
    </div>
  );
}
