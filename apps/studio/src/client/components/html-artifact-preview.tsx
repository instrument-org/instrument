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
import { useGuestOverlays } from "@/client/hooks/use-guest-covered";
import { useGuestMenuState } from "@/client/hooks/use-guest-menu-state";
import { useGuestNavigation } from "@/client/hooks/use-guest-navigation";
import { rpcClient } from "@/client/rpc/client";
import { BROWSER_ZOOM_MAX, BROWSER_ZOOM_MIN } from "@/shared/browser";
import {
  type BrowserTargetId,
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
import { skipToken, useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

// How many previews are mounted on each guest *for a given file*. The artifact
// panel and the expand modal over it are two hosts on one guest, and the second
// to arrive has to behave differently from the first (see isSecondaryHost),
// which is not something either can work out from its own props.
//
// Keyed by file and not by target alone, because the count is read while
// rendering the incoming host and React runs every cleanup after that: on a
// file switch the outgoing host is still counted, so a target-keyed entry would
// make the new file look like a second viewer of the old one and adopt the page
// it was showing. Two hosts of the same file are the only pair that should ever
// share a page, and that is exactly what this key admits.
const mountedHosts = new Map<string, number>();

// The file each guest was last pointed at, by whichever host did the pointing.
// Hosts of the same guest can disagree about which file is on screen -- the
// expand modal's carousel moves it while the panel behind still owns the route
// naming a different one -- and this is how the one that becomes visible again
// notices. Sub-page navigation inside a file does not touch it, so following a
// link and coming back from the modal preserves the page.
const lastPointedAt = new Map<BrowserTargetId, string>();

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
  sideGutter = 0,
  taskId,
  zIndex,
}: {
  // The artifact's own page. Carries the version query string, so a file
  // rewritten on disk arrives here as a new URL and re-navigates.
  entryUrl: string;
  // Bumped when the user re-selects the file already on screen, which asks for
  // the entry page back; see TaskView.
  goHomeNonce?: number;
  // Horizontal room to leave on each side of the guest, for a host with
  // controls floating over the viewer area. The guest is composited above the
  // page, so anything drawn under it is unreachable however it is stacked --
  // its own host's controls included, since they cannot escape that host's
  // stacking context. Keeping the guest out of their way is geometry rather
  // than a z-index argument, and it is the only one of the two that holds.
  sideGutter?: number;
  taskId: TaskId;
  // Set only when this preview is inside an overlay the body-mounted guest
  // would otherwise paint behind; see showOverSlot.
  zIndex?: number;
}) {
  const targetId = encodeArtifactTargetId(taskId);
  const isActiveTab = useIsActiveTab();

  // Whether another preview of this same file was already mounted when this one
  // arrived, read once at mount. The expand modal opening over the panel is a
  // second host on a live guest, and it must adopt whatever page that guest is
  // showing rather than pulling it back to the entry page under a reader who
  // followed a link. Switching files is a different key, so it navigates.
  // Registration happens in the effect below.
  const [isSecondaryHost] = useState(
    () => (mountedHosts.get(hostKey(targetId, entryUrl)) ?? 0) > 0,
  );

  useEffect(() => {
    const key = hostKey(targetId, entryUrl);
    mountedHosts.set(key, (mountedHosts.get(key) ?? 0) + 1);
    return () => {
      const next = (mountedHosts.get(key) ?? 1) - 1;
      if (next > 0) {
        mountedHosts.set(key, next);
      } else {
        mountedHosts.delete(key);
      }
    };
  }, [entryUrl, targetId]);

  // Holds the guest alive while this preview is on the foreground tab. Gated the
  // same way the session browser's lease is: every task tab stays mounted when
  // backgrounded, so leasing on mount alone would pin a webContents per tab that
  // once showed an HTML file and the grace period would never run.
  useQuery(
    rpcClient.workspace.artifactPreview.live.presence.experimental_liveOptions({
      input: isActiveTab ? { id: taskId } : skipToken,
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
  // Gated on the foreground tab for the same reason the lease is, and not only
  // to save work: a background tab holds no lease, so re-creating a guest there
  // would just feed the reaper a fresh target every grace period.
  //
  // It cannot spin: the effect is keyed on `active`, so a create that fails, or
  // succeeds without the guest attaching, leaves the deps untouched and fires
  // nothing further.
  useEffect(() => {
    if (!active && isActiveTab) {
      openPreview({ id: taskId });
    }
  }, [active, isActiveTab, openPreview, taskId]);

  // A raised preview is the one inside the expand modal, so that overlay does
  // not cover it and it keeps painting; an unraised one is behind it and has to
  // park. Both are mounted at once when the modal opens over the panel, and
  // they share a single guest -- this is what hands it over and, on close,
  // hands it back. Without it the modal's slot parks the guest as it unmounts
  // and the panel, whose own inputs never changed, never re-claims it. The same
  // signal decides which of the two owns Cmd+F.
  //
  // Being raised is not blanket immunity, though: an app-wide dialog opens over
  // the expand modal too (they are independent slots, so Cmd+, reaches one
  // through the other) and it draws below a guest raised above it. So the
  // raised host ignores only the overlay it lives inside.
  const { fileViewerModalOpen, studioModalOpen } = useGuestOverlays();
  const covered =
    zIndex === undefined
      ? studioModalOpen || fileViewerModalOpen
      : studioModalOpen;

  const guest = useGuestNavigation({ active, targetId });
  const find = useBrowserFind({ active, covered, isActiveTab, targetId });
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
  const [menuOpen, setMenuOpen] = useGuestMenuState();

  // What actually asks the guest to go somewhere: the selected file, and the
  // go-home gesture on a file that is already open.
  const navigationTrigger = `${entryUrl}\n${goHomeNonce ?? 0}`;
  const navigatedForRef = useRef<null | string>(null);

  // A guest that goes away takes the page with it, and a replacement arrives on
  // `about:blank`. Forget what was pointed where, so the effect below treats the
  // next one as somewhere to navigate rather than a page already in place --
  // otherwise backgrounding a tab past the grace period, or a guest crashing,
  // leaves this host showing a blank guest it believes is already correct.
  useEffect(() => {
    if (!active) {
      navigatedForRef.current = null;
      lastPointedAt.delete(targetId);
    }
  }, [active, targetId]);

  // Point the guest at this artifact, but only when something asked for it.
  //
  // Three things share one guest here and the difference between them is the
  // whole of this effect. A *request* (first mount, a different file, go-home)
  // navigates. A host that merely mounted over a guest another preview is
  // already showing -- the expand modal opening over the panel -- adopts the
  // page on screen instead, because navigating would throw a reader who had
  // followed a link back to the entry page. And a host that becomes visible
  // again finding the guest on a different *file* re-asserts its own: the
  // modal's carousel can move the shared guest to another file, and the panel
  // behind it still owns the route that says which file it is showing.
  //
  // Coming back from an overlay with the guest still on this file is none of
  // those, and deliberately does nothing at all -- that is what preserves a
  // sub-page across expand and collapse.
  useEffect(() => {
    if (!active || covered || !isActiveTab) {
      return;
    }
    const isRequest = navigatedForRef.current !== navigationTrigger;
    const guestOnAnotherFile = lastPointedAt.get(targetId) !== entryUrl;
    if (!isRequest && !guestOnAnotherFile) {
      return;
    }
    const isAdoptingLivePage =
      navigatedForRef.current === null &&
      isSecondaryHost &&
      !guestOnAnotherFile &&
      Boolean(guest.currentUrl());
    navigatedForRef.current = navigationTrigger;
    if (!isAdoptingLivePage) {
      lastPointedAt.set(targetId, entryUrl);
      guest.navigateTo(entryUrl);
    }
    // `guest` is rebuilt every render; navigating is keyed on the file, the
    // go-home gesture, and the guest becoming available or visible again, not
    // on that identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    active,
    covered,
    entryUrl,
    isActiveTab,
    isSecondaryHost,
    navigationTrigger,
    targetId,
  ]);

  const atEntry = guest.currentUrl() === entryUrl;

  // This toolbar's own menu and tooltips portal to the body at `z-50`, and a
  // raised guest sits above that -- so inside the expand modal they would open
  // underneath the page they belong to, invisible and unclickable. They cannot
  // be lifted from inside their host (its content is a stacking context the
  // guest is not in), so they are raised to the same layer the guest is.
  const floatingStyle =
    zIndex === undefined ? undefined : { zIndex: zIndex + 1 };

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
          <TooltipContent style={floatingStyle}>Reload</TooltipContent>
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
          <TooltipContent style={floatingStyle}>
            Back to the start of this file
          </TooltipContent>
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
          <DropdownMenuContent align="end" className="w-56" style={floatingStyle}>
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
        <div className="relative flex-1">
          {/* The measured slot, inset from the host's own floating controls.
              The error notice sits outside it so it still fills the area. */}
          <div
            className="absolute inset-y-0"
            ref={slotRef}
            style={{ left: sideGutter, right: sideGutter }}
          />
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
              {/* The open effect deliberately fires once per (active, tab)
                  combination so a failure cannot spin, which also means it will
                  not retry on its own. This is the way back. */}
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

function hostKey(targetId: BrowserTargetId, entryUrl: string) {
  return `${targetId}\n${entryUrl}`;
}
