import type { LoadedLog } from "@/lib/viewer-types";
import type { UnitSystem } from "@/lib/units";
import { Button } from "@/components/ui/button";
import { ChevronLeftIcon, PlusIcon, AlignCenterHorizontalIcon, RulerIcon, TagIcon, ThermometerIcon, ZoomInIcon, SigmaIcon, FlagIcon } from "lucide-react";
import { Tip } from "@/components/ui/tooltip";

interface Props {
  logs: LoadedLog[];
  alignByRaceTime: boolean;
  showAxes: boolean;
  showAxisLabels: boolean;
  unitSystem: UnitSystem;
  wheelZoomEnabled: boolean;
  wheelZoomFactor: number;
  avgOnSelection: boolean;
  showTimeslip: boolean;
  onToggleAlignment: () => void;
  onToggleAxes: () => void;
  onToggleAxisLabels: () => void;
  onToggleUnitSystem: () => void;
  onToggleWheelZoom: () => void;
  onSetWheelZoomFactor: (factor: number) => void;
  onToggleAvgOnSelection: () => void;
  onToggleTimeslip: () => void;
  onAddTrace: () => void;
  onBack: () => void;
  workspaceMenu?: React.ReactNode;
}

export function ViewerToolbar({ logs, alignByRaceTime, showAxes, showAxisLabels, unitSystem, wheelZoomEnabled, wheelZoomFactor, avgOnSelection, showTimeslip, onToggleAlignment, onToggleAxes, onToggleAxisLabels, onToggleUnitSystem, onToggleWheelZoom, onSetWheelZoomFactor, onToggleAvgOnSelection, onToggleTimeslip, onAddTrace, onBack, workspaceMenu }: Props) {
  const hasRaceData = logs.some((l) => l.raceStartTime !== null);

  return (
    <div className="flex items-center gap-3 border-b px-3 py-2 shrink-0 bg-background">
      <Button variant="ghost" size="sm" onClick={onBack}>
        <ChevronLeftIcon className="size-4 mr-1" />
        Back
      </Button>

      {workspaceMenu}

      <div className="flex-1" />

      <div className="flex items-center gap-1.5">
        {hasRaceData && (
          <Tip content="Align logs by race start time">
            <Button
              variant={alignByRaceTime ? "default" : "outline"}
              size="sm"
              onClick={onToggleAlignment}
            >
              <AlignCenterHorizontalIcon className="size-4 mr-1" />
              Align
            </Button>
          </Tip>
        )}
        <Tip content="Show Y-axis scales">
          <Button
            variant={showAxes ? "default" : "outline"}
            size="sm"
            onClick={onToggleAxes}
          >
            <RulerIcon className="size-4 mr-1" />
            Axes
          </Button>
        </Tip>
        {showAxes && (
          <Tip content="Show axis labels">
            <Button
              variant={showAxisLabels ? "default" : "outline"}
              size="sm"
              onClick={onToggleAxisLabels}
            >
              <TagIcon className="size-4 mr-1" />
              Labels
            </Button>
          </Tip>
        )}
        <Tip content={unitSystem === "imperial" ? "Switch to metric units" : "Switch to imperial units"}>
          <Button
            variant="outline"
            size="sm"
            onClick={onToggleUnitSystem}
          >
            <ThermometerIcon className="size-4 mr-1" />
            {unitSystem === "imperial" ? "Imperial" : "Metric"}
          </Button>
        </Tip>
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
        )}
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
