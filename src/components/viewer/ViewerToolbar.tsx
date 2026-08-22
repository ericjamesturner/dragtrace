import { Button } from "@/components/ui/button";
import { ChevronLeftIcon, PlusIcon } from "lucide-react";
import { Tip } from "@/components/ui/tooltip";
import { FeedbackDialog } from "./FeedbackDialog";

interface Props {
  onAddTrace: () => void;
  onBack: () => void;
  breadcrumb?: React.ReactNode;
  workspaceMenu?: React.ReactNode;
  feedbackSource: "guest" | "account";
}

export function ViewerToolbar({
  onAddTrace,
  onBack,
  breadcrumb,
  workspaceMenu,
  feedbackSource,
}: Props) {
  return (
    <div className="flex items-center gap-3 border-b px-3 py-2 shrink-0 bg-background">
      <Tip content="Back to the event">
        <Button variant="ghost" size="icon" className="size-7 shrink-0" onClick={onBack}>
          <ChevronLeftIcon className="size-4" />
        </Button>
      </Tip>

      {breadcrumb}

      {workspaceMenu}

      <div className="flex-1" />

      <div className="flex items-center gap-1.5">
        <FeedbackDialog source={feedbackSource} />
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
