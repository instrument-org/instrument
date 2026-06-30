import { Button } from "@/client/components/ui/button";
import { ArrowLeftIcon, ArrowRightIcon } from "@phosphor-icons/react";
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

  return (
    <div className="flex items-center gap-1 pr-1">
      <Button
        className="size-6 text-foreground/80"
        disabled={!canGoBack}
        onClick={() => {
          router.history.back();
        }}
        size="icon"
        title="Go back"
        variant="ghost"
      >
        <ArrowLeftIcon className="size-4" />
      </Button>
      <Button
        className="size-6 text-foreground/80"
        disabled={!canGoForward}
        onClick={() => {
          router.history.forward();
        }}
        size="icon"
        title="Go forward"
        variant="ghost"
      >
        <ArrowRightIcon className="size-4" />
      </Button>
    </div>
  );
}
