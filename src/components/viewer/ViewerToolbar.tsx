import { Button } from "@/components/ui/button";
import { ChevronLeftIcon, PlusIcon, SigmaIcon, FlagIcon } from "lucide-react";
import { Tip } from "@/components/ui/tooltip";

interface Props {
  avgOnSelection: boolean;
  showTimeslip: boolean;
  onToggleAvgOnSelection: () => void;
  onToggleTimeslip: () => void;
  onAddTrace: () => void;
  onBack: () => void;
  workspaceMenu?: React.ReactNode;
}

export function ViewerToolbar({ avgOnSelection, showTimeslip, onToggleAvgOnSelection, onToggleTimeslip, onAddTrace, onBack, workspaceMenu }: Props) {
  return (
    <div className="flex items-center gap-3 border-b px-3 py-2 shrink-0 bg-background">
      <Button variant="ghost" size="sm" onClick={onBack}>
        <ChevronLeftIcon className="size-4 mr-1" />
        Back
      </Button>

      {workspaceMenu}

      <div className="flex-1" />

      <div className="flex items-center gap-1.5">
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
