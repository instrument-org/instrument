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
import { useMutation, useQuery } from "@tanstack/react-query";
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
 * guest kind for both makes the agent's self-check evidence about what the
 * user will see. See docs/plans/active/html-artifacts-in-the-guest-pool.md.
 *
 * One guest per task, navigated between files, not one per file: `entryUrl`
 * changing is a `loadURL`, exactly as a browser tab would do it.
 *
 * Deliberately no address bar. Back, forward, reload and a way home are what a
 * preview needs; a free-form URL box would turn the agent's output into a
 * general-purpose browser running in a real origin.
 */
export function HtmlArtifactPreview({
  entryUrl,
  goHomeNonce,
  taskId,
  zIndex,
}: {
  // The artifact's own page. Carries the version query string, so a file
  // rewritten on disk arrives here as a new URL and re-navigates.
  entryUrl: string;
  // Bumped when the user re-selects the file already on screen, which asks for
  // the entry page back; see TaskView.
  goHomeNonce?: number;
  taskId: TaskId;
  // Set only when this preview is inside an overlay the body-mounted guest
  // would otherwise paint behind; see showOverSlot.
  zIndex?: number;
}) {
  const targetId = encodeArtifactTargetId(taskId);
  const isActiveTab = useIsActiveTab();

  // Holds the guest alive while this preview is mounted. A subscription, so an
  // unmount (or a dead renderer) releases the lease without anything having to
  // send a close; the machine's own grace period reaps from there.
  useQuery(
    rpcClient.workspace.artifactPreview.live.presence.experimental_liveOptions({
      input: { id: taskId },
    }),
  );

  const attachedTargets = useBrowserTargets();
  const active = attachedTargets.has(targetId);

  const { isError: openFailed, mutate: openPreview } = useMutation(
    rpcClient.workspace.artifactPreview.open.mutationOptions(),
  );

  // Ask the main process for a guest whenever there isn't one: on first mount,
  // and again if a reaped target is re-opened later. Deliberately not a cached
  // query -- one that has already resolved would replay its old answer and
  // leave the preview waiting on a guest nobody asked for a second time.
  //
  // It cannot spin: the effect is keyed on `active`, so a create that fails, or
  // succeeds without the guest attaching, leaves the deps untouched and fires
  // nothing further. Reaps only happen once every lease is released, i.e. while
  // no preview is mounted, so a mounted one never races its own teardown.
  useEffect(() => {
    if (!active) {
      openPreview({ id: taskId });
    }
  }, [active, openPreview, taskId]);

  const guest = useGuestNavigation({ active, targetId });
  const find = useBrowserFind({ active, isActiveTab, targetId });
  // A raised preview is the one inside the overlay, so it keeps painting; an
  // unraised one is behind it and has to park. Both are mounted at once when
  // the expand modal opens over the panel, and they share a single guest --
  // this is what hands it over and, on close, hands it back. Without it the
  // modal's slot parks the guest as it unmounts and the panel, whose own
  // inputs never changed, never re-claims it.
  const covered = useIsGuestCovered() && zIndex === undefined;
  const slotRef = useBrowserSlot({
    active,
    covered,
    hasLoadError: Boolean(guest.loadError),
    isActiveTab,
    targetId,
    zIndex,
  });

  const openExternalLink = useMutation(
    rpcClient.utils.openExternalLink.mutationOptions(),
  );

  // Point the guest at this artifact whenever the selected file changes. Not a
  // remount: the guest is pooled and shared, so switching files is a navigation
  // and re-selecting the open file is how the user gets back to its entry page
  // after following a link inside it.
  useEffect(() => {
    if (active) {
      guest.navigateTo(entryUrl);
    }
    // `guest` is rebuilt every render; navigating is keyed on the file, on the
    // guest becoming available, and on the go-home gesture, not on that
    // identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, entryUrl, goHomeNonce, targetId]);

  const atEntry = guest.currentUrl() === entryUrl;

  return (
    <div className="absolute inset-0 flex flex-col">
      <div className="flex items-center gap-1 border-b px-1.5 py-1">
        <Button
          disabled={!active || !guest.canGoBack}
          onClick={guest.goBack}
          size="icon-sm"
          variant="ghost"
        >
          <ArrowLeftIcon className="size-4" />
        </Button>
        <Button
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
          // WebContents) isn't blocked by the modal body `pointer-events: none`.
          modal={false}
          onOpenChange={(open) => {
            if (open) {
              guest.syncZoomFactor();
            }
          }}
        >
          <DropdownMenuTrigger asChild>
            <Button disabled={!active} size="icon-sm" variant="ghost">
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
                const url = guest.currentUrl() ?? entryUrl;
                openExternalLink.mutate({ url });
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
                guest.navigateTo(entryUrl);
              }}
            />
          )}
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
          {openFailed ? (
            <span>Couldn’t open the preview.</span>
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
