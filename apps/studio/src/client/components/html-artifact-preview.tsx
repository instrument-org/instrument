import { BrowserFindBar } from "@/client/components/task/browser-find-bar";
import { GuestLoadErrorNotice } from "@/client/components/task/guest-load-error";
import { Button } from "@/client/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { Spinner } from "@/client/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import {
  ZoomLevelMenu,
  ZoomStepperControl,
} from "@/client/components/zoom-controls";
import { useIsActiveTab } from "@/client/hooks/use-active-tab";
import { useBrowserFind } from "@/client/hooks/use-browser-find";
import { useBrowserSlot } from "@/client/hooks/use-browser-slot";
import { useBrowserTargets } from "@/client/hooks/use-browser-targets";
import { useIsGuestCovered } from "@/client/hooks/use-guest-covered";
import { useGuestMenuState } from "@/client/hooks/use-guest-menu-state";
import { useGuestNavigation } from "@/client/hooks/use-guest-navigation";
import { rpcClient } from "@/client/rpc/client";
import { BROWSER_ZOOM_MAX, BROWSER_ZOOM_MIN } from "@/shared/browser";
import {
  encodeArtifactTargetId,
  type TaskId,
} from "@instrument-org/workspace/client";
import {
  ArrowClockwiseIcon,
  ArrowCounterClockwiseIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowSquareOutIcon,
  DotsThreeVerticalIcon,
  HouseIcon,
  MagnifyingGlassIcon,
} from "@phosphor-icons/react";
import { useMutation } from "@tanstack/react-query";
import { useEffect } from "react";

/**
 * An HTML file artifact, rendered in the same `<webview>` guest the agent
 * browses in rather than a sandboxed `<iframe>`.
 *
 * The point is not the back/forward chrome, though that is what shows: the
 * agent and the user load the identical asset URL, so rendering them on
 * different primitives meant everything origin-scoped -- `localStorage`,
 * cookies, same-origin `fetch` of a sibling file -- behaved one way when the
 * agent screenshotted its own work and another way in front of the user. One
 * guest kind for both makes the agent's self-check evidence about what the user
 * will see.
 *
 * One guest per task, navigated between files, not one per file: `entryUrl`
 * changing is a `loadURL`, exactly as a browser tab would do it. Exactly one
 * preview is ever mounted for a task -- the artifact panel -- which is why
 * nothing here has to arbitrate between hosts; `FileViewer` withholds Expand
 * for HTML to keep it that way.
 *
 * Deliberately no address bar. Back, forward, reload and a way home are what a
 * preview needs; a free-form URL box would turn the agent's output into a
 * general-purpose browser running in a real origin.
 */
export function HtmlArtifactPreview({
  entryUrl,
  goHomeNonce,
  taskId,
}: {
  // The artifact's own page. Carries the version query string, so a file
  // rewritten on disk arrives here as a new URL and re-navigates.
  entryUrl: string;
  // Bumped when the user re-selects the file already on screen, which asks for
  // the entry page back; see TaskView.
  goHomeNonce?: number;
  taskId: TaskId;
}) {
  const targetId = encodeArtifactTargetId(taskId);
  const isActiveTab = useIsActiveTab();
  const covered = useIsGuestCovered();

  const attachedTargets = useBrowserTargets();
  const active = attachedTargets.has(targetId);

  const { isError: openFailed, mutate: openPreview } = useMutation(
    rpcClient.workspace.artifactPreview.open.mutationOptions(),
  );

  // Ask the main process for a guest whenever there isn't one: on mount, and
  // again if this one goes away (a crash in untrusted artifact HTML, the task
  // being trashed). Deliberately a mutation and not a cached query -- one that
  // had already resolved would replay its old answer and leave the preview
  // waiting on a guest nobody asked for a second time.
  //
  // It cannot spin: the effect is keyed on `active`, so a create that fails, or
  // succeeds without the guest attaching, leaves the deps untouched.
  useEffect(() => {
    if (!active) {
      openPreview({ id: taskId });
    }
  }, [active, openPreview, taskId]);

  const guest = useGuestNavigation({ active, targetId });
  const find = useBrowserFind({ active, covered, isActiveTab, targetId });
  const slotRef = useBrowserSlot({
    active,
    covered,
    hasLoadError: Boolean(guest.loadError),
    isActiveTab,
    targetId,
  });

  const openExternalLink = useMutation(
    rpcClient.utils.openExternalLink.mutationOptions(),
  );
  const [menuOpen, setMenuOpen] = useGuestMenuState();

  // Point the guest at this artifact: on mount, when the selected file changes,
  // and when the user asks to go home. A fresh guest arrives on `about:blank`,
  // so `active` becoming true is one of the triggers -- otherwise a preview
  // whose guest was replaced would sit on a blank page it believed was correct.
  useEffect(() => {
    if (active) {
      guest.navigateTo(entryUrl);
    }
    // `guest` is rebuilt every render; navigating is keyed on the file, the
    // go-home gesture, and the guest becoming available, not on that identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, entryUrl, goHomeNonce, targetId]);

  const atEntry = guest.currentUrl() === entryUrl;

  return (
    <div className="absolute inset-0 flex flex-col">
      <div className="flex items-center gap-1 border-b px-1.5 py-1">
        <Button
          aria-label="Back"
          disabled={!active || !guest.canGoBack}
          onClick={guest.goBack}
          size="icon-sm"
          variant="ghost"
        >
          <ArrowLeftIcon className="size-4" />
        </Button>
        <Button
          aria-label="Forward"
          disabled={!active || !guest.canGoForward}
          onClick={guest.goForward}
          size="icon-sm"
          variant="ghost"
        >
          <ArrowRightIcon className="size-4" />
        </Button>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label="Reload"
              disabled={!active}
              onClick={guest.reload}
              size="icon-sm"
              variant="ghost"
            >
              <ArrowClockwiseIcon className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Reload</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label="Back to the start of this file"
              disabled={!active || atEntry}
              onClick={() => {
                guest.navigateTo(entryUrl);
              }}
              size="icon-sm"
              variant="ghost"
            >
              <HouseIcon className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Back to the start of this file</TooltipContent>
        </Tooltip>
        {/* Read-only: says where a followed link landed, and is not a way to
            navigate somewhere else. */}
        <div className="min-w-0 flex-1 truncate px-2 text-xs text-muted-foreground">
          {guest.url}
        </div>
        <DropdownMenu
          // Non-modal so clicking into the guest `<webview>` (a separate
          // WebContents) isn't blocked by the modal body `pointer-events: none`;
          // useGuestMenuState is what then dismisses it, since that click gives
          // Radix nothing its own outside-dismiss can see.
          modal={false}
          onOpenChange={(open) => {
            if (open) {
              guest.syncZoomFactor();
            }
            setMenuOpen(open);
          }}
          open={menuOpen}
        >
          <DropdownMenuTrigger asChild>
            <Button
              aria-label="Preview options"
              disabled={!active}
              size="icon-sm"
              variant="ghost"
            >
              <DotsThreeVerticalIcon className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <div className="flex items-center justify-between px-2 py-1.5">
              <span className="text-sm">Zoom</span>
              <ZoomStepperControl
                canZoomIn={guest.zoomFactor < BROWSER_ZOOM_MAX}
                canZoomOut={guest.zoomFactor > BROWSER_ZOOM_MIN}
                onZoomIn={guest.zoomIn}
                onZoomOut={guest.zoomOut}
                readout={
                  <ZoomLevelMenu
                    max={BROWSER_ZOOM_MAX}
                    min={BROWSER_ZOOM_MIN}
                    nested
                    onSelect={guest.applyZoom}
                    zoom={guest.zoomFactor}
                  />
                }
              />
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                find.setFindOpen(true);
              }}
            >
              <MagnifyingGlassIcon className="size-4" />
              Find in page
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={guest.hardReload}>
              <ArrowCounterClockwiseIcon className="size-4" />
              Hard reload
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                openExternalLink.mutate({
                  url: guest.currentUrl() ?? entryUrl,
                });
              }}
            >
              <ArrowSquareOutIcon className="size-4" />
              Open in external browser
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {active && find.findOpen && (
        <BrowserFindBar
          closeFind={find.closeFind}
          findInputRef={find.findInputRef}
          findQuery={find.findQuery}
          findResult={find.findResult}
          runFind={find.runFind}
          setFindQuery={find.setFindQuery}
        />
      )}
      {active ? (
        <div className="relative flex-1" ref={slotRef}>
          {guest.loadError && (
            <GuestLoadErrorNotice
              error={guest.loadError}
              onRetry={() => {
                // Retry what failed -- which is the URL the notice names, and
                // after a followed link is not this artifact's entry page.
                guest.navigateTo(guest.loadError?.url ?? entryUrl);
              }}
            />
          )}
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
          {openFailed ? (
            <>
              <span>Couldn’t open the preview.</span>
              {/* The open effect fires once per state by design, so it will not
                  retry on its own. This is the way back. */}
              <Button
                onClick={() => {
                  openPreview({ id: taskId });
                }}
                size="sm"
                variant="outline"
              >
                Try again
              </Button>
            </>
          ) : (
            <>
              <Spinner className="size-5" />
              <span>Opening preview…</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
