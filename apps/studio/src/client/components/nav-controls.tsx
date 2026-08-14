import { ToolbarTooltip } from "@/client/components/toolbar-tooltip";
import { Button } from "@/client/components/ui/button";
import { ArrowLeftIcon } from "@phosphor-icons/react/ArrowLeft";
import { ArrowRightIcon } from "@phosphor-icons/react/ArrowRight";
import {
  useCanGoBack,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";

export function NavControls() {
  // Each tab has its own router/history, and NavControls renders inside that
  // tab's RouterProvider, so back/forward act on this tab's stack directly.
  const router = useRouter();
  const canGoBack = useCanGoBack();
  // No `useCanGoForward` in this router version; derive it from the history
  // index vs length (memory history, so length is the real entry count).
  const canGoForward = useRouterState({
    select: (s) => s.location.state.__TSR_index < router.history.length - 1,
  });

  // The pair sits tighter than the rest of the row: their 28px hit boxes meet,
  // which leaves the arrows themselves 12px apart.
  return (
    <div className="flex items-center">
      <ToolbarTooltip shortcut="goBack">
        <Button
          className="size-7 text-foreground/80"
          disabled={!canGoBack}
          onClick={() => {
            router.history.back();
          }}
          size="icon"
          variant="ghost-toolbar"
        >
          <ArrowLeftIcon className="size-4" />
        </Button>
      </ToolbarTooltip>
      <ToolbarTooltip shortcut="goForward">
        <Button
          className="size-7 text-foreground/80"
          disabled={!canGoForward}
          onClick={() => {
            router.history.forward();
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
