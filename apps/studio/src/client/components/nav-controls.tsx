import { ToolbarTooltip } from "@/client/components/toolbar-tooltip";
import { Button } from "@/client/components/ui/button";
import { type TabSteps } from "@/client/components/window/use-tab-steps";
import { ArrowLeftIcon } from "@phosphor-icons/react/ArrowLeft";
import { ArrowRightIcon } from "@phosphor-icons/react/ArrowRight";

/** The window's back and forward, over the steps of the tab up. */
export function NavControls({ steps }: { steps: TabSteps }) {
  // The pair sits tighter than the rest of the row: their 28px hit boxes meet,
  // which leaves the arrows themselves 12px apart.
  return (
    <div className="flex items-center">
      <ToolbarTooltip chord="back">
        <Button
          className="size-7 text-foreground/80"
          disabled={!steps.canGoBack}
          onClick={() => {
            steps.go("back");
          }}
          size="icon"
          variant="ghost-toolbar"
        >
          <ArrowLeftIcon className="size-4" />
        </Button>
      </ToolbarTooltip>
      <ToolbarTooltip chord="forward">
        <Button
          className="size-7 text-foreground/80"
          disabled={!steps.canGoForward}
          onClick={() => {
            steps.go("forward");
          }}
          size="icon"
          variant="ghost-toolbar"
        >
          <ArrowRightIcon className="size-4" />
        </Button>
      </ToolbarTooltip>
    </div>
  );
}
