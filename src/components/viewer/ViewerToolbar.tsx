import { Button } from "@/components/ui/button";
import { ChevronLeftIcon, PlusIcon } from "lucide-react";
import { Tip } from "@/components/ui/tooltip";

interface Props {
  onAddTrace: () => void;
  onBack: () => void;
  workspaceMenu?: React.ReactNode;
}

export function ViewerToolbar({ onAddTrace, onBack, workspaceMenu }: Props) {
  return (
    <div className="flex items-center gap-3 border-b px-3 py-2 shrink-0 bg-background">
      <Button variant="ghost" size="sm" onClick={onBack}>
        <ChevronLeftIcon className="size-4 mr-1" />
        Back
      </Button>

      {workspaceMenu}

      <div className="flex-1" />

      <div className="flex items-center gap-1.5">
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
