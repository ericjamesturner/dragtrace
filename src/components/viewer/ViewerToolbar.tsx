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
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-background px-3 py-2 sm:flex-nowrap sm:gap-3">
      <Tip content="Back to the event">
        <Button variant="ghost" size="icon" className="size-7 shrink-0" onClick={onBack}>
          <ChevronLeftIcon className="size-4" />
        </Button>
      </Tip>

      {breadcrumb && (
        <div className="order-3 min-w-0 basis-full overflow-x-auto sm:order-none sm:flex-1 sm:basis-auto">
          {breadcrumb}
        </div>
      )}

      {workspaceMenu}

      <div className="ml-auto flex shrink-0 items-center gap-1.5">
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
