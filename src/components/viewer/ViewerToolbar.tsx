import type { LoadedLog } from "@/lib/viewer-types";
import type { UnitSystem } from "@/lib/units";
import { Button } from "@/components/ui/button";
import { ChevronLeftIcon, PlusIcon, AlignCenterHorizontalIcon, RulerIcon, TagIcon, ThermometerIcon } from "lucide-react";
import { Tip } from "@/components/ui/tooltip";

interface Props {
  logs: LoadedLog[];
  alignByRaceTime: boolean;
  showAxes: boolean;
  showAxisLabels: boolean;
  unitSystem: UnitSystem;
  onToggleAlignment: () => void;
  onToggleAxes: () => void;
  onToggleAxisLabels: () => void;
  onToggleUnitSystem: () => void;
  onAddTrace: () => void;
  onBack: () => void;
}

export function ViewerToolbar({ logs, alignByRaceTime, showAxes, showAxisLabels, unitSystem, onToggleAlignment, onToggleAxes, onToggleAxisLabels, onToggleUnitSystem, onAddTrace, onBack }: Props) {
  const hasRaceData = logs.some((l) => l.raceStartTime !== null);

  return (
    <div className="flex items-center gap-3 border-b px-3 py-2 shrink-0 bg-background">
      <Button variant="ghost" size="sm" onClick={onBack}>
        <ChevronLeftIcon className="size-4 mr-1" />
        Back
      </Button>

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
