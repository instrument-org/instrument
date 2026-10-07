import { bookmarksAtom } from "@/client/atoms/window";
import { OpenInAppMenuItems } from "@/client/components/open-in-app";
import { BrowserFindBar } from "@/client/components/window/browser-find-bar";
import { ToolbarTooltip } from "@/client/components/toolbar-tooltip";
import { Button } from "@/client/components/ui/button";
import { Delayed } from "@/client/components/ui/delayed";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/client/components/ui/input-group";
import { dropdownMenuComponents } from "@/client/components/ui/menu-components";
import { Spinner } from "@/client/components/ui/spinner";
import { WindowContext } from "@/client/components/window/context";
import { TabRowControl } from "@/client/components/window/tab-location-row";
import {
  ZoomLevelMenu,
  ZoomStepperControl,
} from "@/client/components/zoom-controls";
import { useBrowserFind } from "@/client/hooks/use-browser-find";
import { useCloseOnWindowBlur } from "@/client/hooks/use-close-on-window-blur";
import { useBrowserSlot } from "@/client/hooks/use-browser-slot";
import { useIsGuestCovered } from "@/client/hooks/use-guest-covered";
import { useGuest } from "@/client/hooks/use-browser-targets";
import { useGuestNavigation } from "@/client/hooks/use-guest-navigation";
import { openInAppTargetOfUrl } from "@/client/hooks/use-open-in-app";
import { useIsTaskPageVisible } from "@/client/hooks/use-task-page-visible";
import {
  getGuest,
  type GuestEventMap,
  stepPage,
} from "@/client/lib/browser-pool";
import {
  EMULATED_DEVICES,
  type EmulatedDevice,
} from "@/client/lib/emulated-devices";
import { resolveUrlOrSearch } from "@/client/lib/resolve-url-or-search";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { BROWSER_ZOOM_MAX, BROWSER_ZOOM_MIN } from "@/shared/browser";
import { steppedZoom } from "@/shared/zoom";
import { withoutPageEditParam } from "@instrument-org/shared";
import {
  type BrowserTargetId,
  encodeBrowserTargetId,
  type StoreId,
  type TaskId,
} from "@instrument-org/workspace/client";
import { ArrowClockwiseIcon } from "@phosphor-icons/react/ArrowClockwise";
import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react/ArrowCounterClockwise";
import { ArrowLeftIcon } from "@phosphor-icons/react/ArrowLeft";
import { ArrowRightIcon } from "@phosphor-icons/react/ArrowRight";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/ArrowSquareOut";
import { BookmarkSimpleIcon } from "@phosphor-icons/react/BookmarkSimple";
import { CodeIcon } from "@phosphor-icons/react/Code";
import { CopyIcon } from "@phosphor-icons/react/Copy";
import { DeviceMobileIcon } from "@phosphor-icons/react/DeviceMobile";
import { DotsThreeVerticalIcon } from "@phosphor-icons/react/DotsThreeVertical";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass";
import { ShieldCheckIcon } from "@phosphor-icons/react/ShieldCheck";
import { WarningCircleIcon } from "@phosphor-icons/react/WarningCircle";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAtom } from "jotai";
import { type ReactNode, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

/**
 * A page of the in-app browser, hosted in the artifact panel. The guest `<webview>`
 * lives in the body-mounted pool; {@link useBrowserSlot} measures a slot and
 * tells the pool to show the guest over it while the panel is visible, plus
 * navigation controls and an overflow menu (zoom, open externally, copy URL).
 * Either the user (via `browser.open`, fired on mount) or the agent's
 * `agent-browser` command can create the guest; both drive the same target.
 * While the guest is being created or after it's reaped, `active` is false and
 * we show a status body.
 */
export function BrowserPanel({
  active,
  chrome = true,
  className,
  focusAddress = true,
  insideOverlay = false,
  layer,
  menuItems,
  onEditSource,
  pageControls,
  relayoutKey,
  restoreUrl,
  sessionId,
  sliding,
  taskId,
}: {
  active: boolean;
  /**
   * Where the bar goes: over the page as its own row, nowhere, or into
   * elements the window keeps for it. Drawn there it loses the arrows and
   * the address, which that row has of its own; reload goes beside the
   * row's arrows (`reloadInto`), the page's state into the address field
   * (`fieldInto`), and the page's controls and menu to its end.
   */
  chrome?:
    | boolean
    | {
        fieldInto?: HTMLElement | null;
        into: HTMLElement | null;
        reloadInto?: HTMLElement | null;
      };
  // See FileViewer: set when the surface is already drawn around this.
  className?: string;
  /**
   * Whether a blank page this panel opened puts the caret in the address bar.
   * Off for a panel inside a surface with a caret of its own to keep, such as
   * a draft's words: a bar that takes the caret also reads as being edited,
   * which holds the address the page arrives at out of it.
   */
  focusAddress?: boolean;
  /** Drawn inside an overlay (Quick Look), which parks every other guest but not this one. */
  insideOverlay?: boolean;
  /**
   * The window layer the guest is shown on; see showOverSlot. A panel drawn
   * inside a floating surface names a layer above that surface, and while
   * its page is still blank keeps the guest parked rather than showing the
   * guest's own black default over the surface.
   */
  layer?: number;
  /** More of the page's menu, for a page that has more to offer than a site. */
  menuItems?: ReactNode;
  /** Opens the page's text for editing, when the page is a file; the menu offers it. */
  onEditSource?: () => void;
  /** Drawn ahead of the menu in the row the bar is drawn into, for a page with a mode of its own. */
  pageControls?: ReactNode;
  /** Changes whenever the panel moves without resizing, so the guest is placed again; see useBrowserSlot. */
  relayoutKey?: string;
  /**
   * Where the page goes when its guest comes up blank and its session
   * recorded no page of its own: the address a window tab remembers its page
   * at, which brings the page back after a launch or a reap.
   */
  restoreUrl?: string | undefined;
  sessionId: StoreId.Session;
  // The pane is sliding open or shut, so the slot is moving under a guest that
  // only follows it while something is watching. See useBrowserSlot.
  sliding?: boolean;
  taskId: TaskId;
}) {
  const targetId = encodeBrowserTargetId(taskId, sessionId);
  const inputRef = useRef<HTMLInputElement>(null);
  const isVisible = useIsTaskPageVisible();
  const [draftUrl, setDraftUrl] = useState("");
  const [zoomFactor, setZoomFactor] = useState(1);
  const [menuOpen, setMenuOpen] = useState(false);
  const [zoomOpen, setZoomOpen] = useState(false);
  // null = the panel's natural size ("Actual size"). Applied via CDP device
  // emulation with a scale computed from the panel's live bounds (see
  // device-emulation.ts) rather than resizing the webview element, which
  // doesn't reliably re-layout an already-loaded guest.
  const [emulatedDevice, setEmulatedDevice] = useState<EmulatedDevice | null>(
    null,
  );
  // Set when a main-frame navigation fails (bad host, no network, ...). The
  // guest is parked and we show a light error state over the slot instead of its
  // blank error page. Cleared when a new load starts or succeeds.
  //
  // Stamped with the guest it happened on, and read back only for that one:
  // `targetId` changes in place when the selected session changes, with no
  // remount, so a bare error would survive into the next session's guest and
  // both park it behind a notice and name the previous session's URL. Filtered
  // on read rather than cleared in an effect, so it costs no extra render and
  // no failed page is briefly shown as fine.
  const [failure, setFailure] = useState<null | {
    message: string;
    targetId: BrowserTargetId;
    url: string;
  }>(null);
  const loadError = failure?.targetId === targetId ? failure : null;
  // While the user is editing the URL, agent-driven navigations must not
  // overwrite what they're typing.
  const editingUrlRef = useRef(false);
  // Mirror the guest's URL + nav availability into the controls (it navigates
  // from agent CDP commands too, not just user input).
  const nav = useGuestNavigation(active ? targetId : null, {
    onNavigate: (rawUrl) => {
      const url = withoutPageEditParam(rawUrl);
      if (!editingUrlRef.current) {
        setDraftUrl(url === "about:blank" ? "" : url);
      }
    },
  });
  // A real page is not yet loaded (about:blank, or nothing read yet). A newly
  // selected target has no URL read for it until its guest syncs, and that
  // brief handoff counts as blank too, so the guest's black default never
  // flashes through before we learn its URL.
  const blankPage = !nav.url || nav.url === "about:blank";

  // Read once and give both hooks the same answer: a panel that parks its guest
  // under an overlay must also stop being the Cmd+F target, or the overlay's
  // own host claims the single find-opener slot, clears it on unmount, and this
  // panel never re-registers.
  const covered = useIsGuestCovered({ insideOverlay });
  const find = useBrowserFind({ active, covered, isVisible, targetId });
  const slotRef = useBrowserSlot({
    active,
    covered,
    emulatedDeviceHeight: emulatedDevice?.height,
    emulatedDeviceWidth: emulatedDevice?.width,
    // A guest raised above its floating host is above the card this panel
    // draws over a blank page, so it stays parked until the page is there.
    hasLoadError: Boolean(loadError) || (layer !== undefined && blankPage),
    isVisible,
    layer,
    relayoutKey,
    sliding,
    targetId,
  });

  const { data: preferences } = useQuery(
    rpcClient.preferences.live.get.experimental_liveOptions(),
  );
  const setBlockAds = useMutation(
    rpcClient.preferences.setBlockAds.mutationOptions(),
  );
  const openExternalLink = useMutation(
    rpcClient.utils.openExternalLink.mutationOptions(),
  );
  const { mutate: openBrowser, status: openStatus } = useMutation(
    rpcClient.workspace.browser.open.mutationOptions(),
  );

  // Targets this panel has already auto-opened, so a reap (active -> false)
  // doesn't re-create the guest in a loop and defeat the reaper. After a reap
  // the user re-opens explicitly via the "Reopen browser" button.
  //
  // Held until the pane has finished sliding. Opening a target ends in the
  // renderer mounting a `<webview>`, which costs a WebContents and a compositor
  // surface -- work in the browser and GPU processes that the host cannot yield
  // around, so it drops whatever frames are left in the slide. It is a
  // once-per-target cost, which is why only the open that creates the guest ever
  // stutters. Nothing is lost by waiting: this panel shows the same "Opening
  // browser..." state for the round trip either way.
  const autoOpenedRef = useRef<Set<BrowserTargetId>>(new Set());
  useEffect(() => {
    if (sliding || active || autoOpenedRef.current.has(targetId)) {
      return;
    }
    autoOpenedRef.current.add(targetId);
    openBrowser({
      id: taskId,
      sessionId,
      ...(restoreUrl && restoreUrl !== "about:blank" ? { restoreUrl } : {}),
    });
    // Once per target: the address is only where a blank guest goes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, openBrowser, sessionId, sliding, targetId, taskId]);

  // Track main-frame load failures so we can show a light error state.
  const guest = useGuest(active ? targetId : null);
  useEffect(() => {
    if (!guest) {
      return;
    }
    // Clear only a failure stamped with this listener's own guest. These
    // listeners outlive `targetId` changing in place by the frame between the
    // render and the effect teardown, and a bare clear arriving from the
    // previous guest in that window would drop the current guest's error
    // notice and unpark it over the slot. The draft URL these handlers write
    // needs no such guard: the re-run's own read of the new guest follows the
    // teardown.
    const clearFailure = () => {
      setFailure((current) =>
        current?.targetId === targetId ? null : current,
      );
    };
    const onFailLoad = (detail: GuestEventMap["did-fail-load"]) => {
      // Ignore sub-frame failures and user-aborted navigations (ERR_ABORTED),
      // which fire routinely when a new navigation supersedes an in-flight one.
      if (!detail.isMainFrame || detail.errorCode === -3) {
        return;
      }
      setFailure({
        message: detail.errorDescription || "This site can’t be reached",
        targetId,
        url: detail.validatedURL,
      });
      if (!editingUrlRef.current && detail.validatedURL) {
        setDraftUrl(detail.validatedURL);
      }
    };
    // The zoom is the guest's, and moves without the panel: a chord pressed
    // in the page, or a site the guest's zoom was already set for.
    const readZoom = () => {
      setZoomFactor(guest.zoom());
    };
    readZoom();
    const stops = [
      guest.on("did-navigate", readZoom),
      guest.on("zoom-set", readZoom),
      guest.on("did-navigate", clearFailure),
      guest.on("did-navigate-in-page", clearFailure),
      guest.on("did-start-loading", clearFailure),
      guest.on("did-fail-load", onFailLoad),
    ];
    return () => {
      for (const stop of stops) {
        stop();
      }
    };
  }, [guest, targetId]);

  // Focus the URL bar on a blank page ONLY when this panel opened the browser
  // (autoOpenedRef), i.e. a user-initiated open, so they can type immediately.
  // For an agent-initiated open we must not steal focus: a focused bar reads as
  // "user editing" and would block the agent's navigation from syncing into it.
  useEffect(() => {
    if (!active || !focusAddress || !autoOpenedRef.current.has(targetId)) {
      return;
    }
    const url = getGuest(targetId)?.url();
    const activeElement = document.activeElement;
    // isContentEditable also covers contenteditable="" / "plaintext-only",
    // which an attribute selector would miss.
    const hostInputFocused =
      activeElement instanceof HTMLElement &&
      (activeElement.isContentEditable ||
        activeElement.matches("input, textarea, select"));
    if ((!url || url === "about:blank") && !hostInputFocused) {
      inputRef.current?.focus();
    }
  }, [active, focusAddress, targetId]);

  useCloseOnWindowBlur(menuOpen, () => {
    setMenuOpen(false);
  });
  useCloseOnWindowBlur(zoomOpen, () => {
    setZoomOpen(false);
  });

  const guestNow = () => getGuest(targetId);

  // loadURL rejects on a failed navigation (bad host, offline, ...); the
  // did-fail-load listener already surfaces the error, so swallow the rejection
  // to avoid an unhandled promise error.
  const navigateTo = (url: string) => {
    void guestNow()
      ?.load(url)
      .catch(() => {
        // Surfaced by the did-fail-load listener; nothing to do here.
      });
  };

  const applyZoom = (factor: number) => {
    const current = guestNow();
    if (!current) {
      return;
    }
    current.setZoom(factor);
    setZoomFactor(factor);
  };
  const stepZoom = (direction: "in" | "out") => {
    applyZoom(
      steppedZoom({
        direction,
        factor: zoomFactor,
        max: BROWSER_ZOOM_MAX,
        min: BROWSER_ZOOM_MIN,
      }),
    );
  };

  const currentUrl = () => {
    const url = guestNow()?.url();
    return url && url !== "about:blank" ? withoutPageEditParam(url) : undefined;
  };

  // A real page is loaded (not about:blank). Zoom, copy, and open-external all
  // act on the current page, so they're only meaningful once one exists; zoom in
  // particular is per-page and doesn't carry to the next navigation.
  const pageUrl = active ? currentUrl() : undefined;
  const openInTarget = openInAppTargetOfUrl(pageUrl);

  // Bookmarks are the window's, shown on its browser's starting view; a
  // task's own browser has no such view to keep them on.
  const inWindow = useContext(WindowContext) !== null;
  const [bookmarks, setBookmarks] = useAtom(bookmarksAtom);
  const isBookmarked = bookmarks.some((bookmark) => bookmark.url === pageUrl);
  const toggleBookmark = () => {
    if (!pageUrl) {
      return;
    }
    if (isBookmarked) {
      setBookmarks((current) =>
        current.filter((bookmark) => bookmark.url !== pageUrl),
      );
      toast("Removed from Bookmarks");
      return;
    }
    // Untitled until the guest is ready; the start view names it by its site instead.
    const title = guestNow()?.title() ?? "";
    setBookmarks((current) => [
      ...current,
      { id: crypto.randomUUID(), title, url: pageUrl },
    ]);
    // Said, since nothing on the page itself changes: it shows on the
    // browser's starting view, where it can be renamed.
    toast("Added to Bookmarks", { description: title || undefined });
  };

  return (
    <div
      className={cn(
        "flex h-full flex-col overflow-hidden rounded-xl bg-card shadow-sm",
        className,
      )}
    >
      {(() => {
        // The page's menu, the same in either shape of the bar.
        const menu = (
          <DropdownMenu
            // Non-modal so clicking into the guest `<webview>` (a separate
            // WebContents) isn't blocked by the modal body `pointer-events: none`;
            // combined with the window-blur close above, that dismisses the menu.
            modal={false}
            onOpenChange={(open) => {
              // No live page -> nothing to act on; refuse to open even if the
              // disabled trigger is bypassed.
              if (open && !pageUrl) {
                return;
              }
              // Not ready yet: the last known zoom stands.
              const current = open ? guestNow() : null;
              if (current) {
                setZoomFactor(current.zoom());
              }
              setMenuOpen(open);
            }}
            open={menuOpen}
          >
            <DropdownMenuTrigger asChild>
              <Button
                aria-label="More actions"
                disabled={!pageUrl}
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
                  canZoomIn={zoomFactor < BROWSER_ZOOM_MAX}
                  canZoomOut={zoomFactor > BROWSER_ZOOM_MIN}
                  onZoomIn={() => {
                    stepZoom("in");
                  }}
                  onZoomOut={() => {
                    stepZoom("out");
                  }}
                  readout={
                    <ZoomLevelMenu
                      max={BROWSER_ZOOM_MAX}
                      min={BROWSER_ZOOM_MIN}
                      nested
                      onSelect={applyZoom}
                      zoom={zoomFactor}
                    />
                  }
                />
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <DeviceMobileIcon className="size-4" />
                  View as
                  {emulatedDevice && (
                    <span className="ml-auto text-xs whitespace-nowrap text-muted-foreground">
                      {emulatedDevice.label}
                    </span>
                  )}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuRadioGroup
                    onValueChange={(value) => {
                      setEmulatedDevice(
                        EMULATED_DEVICES.find(
                          (device) => device.id === value,
                        ) ?? null,
                      );
                    }}
                    value={emulatedDevice?.id ?? "actual-size"}
                  >
                    <DropdownMenuRadioItem value="actual-size">
                      Actual size
                    </DropdownMenuRadioItem>
                    <DropdownMenuSeparator />
                    {EMULATED_DEVICES.map((device) => (
                      <DropdownMenuRadioItem key={device.id} value={device.id}>
                        {device.label}
                        <span className="ml-auto text-xs text-muted-foreground">
                          {device.width}×{device.height}
                        </span>
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => {
                  find.setFindOpen(true);
                }}
              >
                <MagnifyingGlassIcon className="size-4" />
                Find in page
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  guestNow()?.reload({ ignoreCache: true });
                }}
              >
                <ArrowCounterClockwiseIcon className="size-4" />
                Hard reload
              </DropdownMenuItem>
              <DropdownMenuCheckboxItem
                checked={preferences?.blockAds ?? true}
                onCheckedChange={(enabled) => {
                  // The blocker reads the choice per request, so the page
                  // reloads to show it the way it looks under the new one.
                  setBlockAds.mutate(
                    { enabled },
                    { onSuccess: () => guestNow()?.reload() },
                  );
                }}
              >
                <ShieldCheckIcon className="size-4" />
                Block ads
              </DropdownMenuCheckboxItem>
              {menuItems}
              {onEditSource && (
                <DropdownMenuItem onSelect={onEditSource}>
                  <CodeIcon className="size-4" />
                  Edit source
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              {inWindow && (
                <DropdownMenuItem onSelect={toggleBookmark}>
                  <BookmarkSimpleIcon className="size-4" />
                  {isBookmarked ? "Remove from bookmarks" : "Add to bookmarks"}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onSelect={() => {
                  const url = currentUrl();
                  if (url) {
                    void navigator.clipboard.writeText(url);
                  }
                }}
              >
                <CopyIcon className="size-4" />
                Copy URL
              </DropdownMenuItem>
              {/* In a row of the window's the app is the address field's own
                  button, and the menu names it too, with the others that
                  could open a page's file. */}
              {typeof chrome === "object" && openInTarget ? (
                <OpenInAppMenuItems
                  menuComponents={dropdownMenuComponents}
                  target={openInTarget}
                />
              ) : (
                <DropdownMenuItem
                  disabled={!pageUrl}
                  onSelect={() => {
                    if (pageUrl) {
                      openExternalLink.mutate({ url: pageUrl });
                    }
                  }}
                >
                  <ArrowSquareOutIcon className="size-4" />
                  Open in external browser
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        );
        // The page's controls and the menu, which the row above can carry as
        // they are, and reload, which it keeps beside its arrows; the
        // address, and the way out to the app that opens the page, are drawn
        // there by the row itself.
        const controls = (
          <>
            {pageControls}
            {menu}
          </>
        );
        // The zoom, said in the address field only while the page is not at
        // its own size, the one setting people forget they changed. A press
        // on it is the zoom's stepper, the same one the menu holds.
        const isZoomed = Math.abs(zoomFactor - 1) > 0.001;
        const fieldZoom = isZoomed && (
          <DropdownMenu
            modal={false}
            onOpenChange={setZoomOpen}
            open={zoomOpen}
          >
            <DropdownMenuTrigger
              aria-label="Zoom"
              className="flex h-5 shrink-0 items-center rounded-full bg-foreground/8 px-1.5 font-medium text-foreground/70 tabular-nums hover:bg-foreground/12 hover:text-foreground data-[state=open]:bg-foreground/12"
            >
              {Math.round(zoomFactor * 100)}%
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="flex items-center gap-1.5 p-1.5"
            >
              <ZoomStepperControl
                canZoomIn={zoomFactor < BROWSER_ZOOM_MAX}
                canZoomOut={zoomFactor > BROWSER_ZOOM_MIN}
                onZoomIn={() => {
                  stepZoom("in");
                }}
                onZoomOut={() => {
                  stepZoom("out");
                }}
                readout={
                  <ZoomLevelMenu
                    compact
                    max={BROWSER_ZOOM_MAX}
                    min={BROWSER_ZOOM_MIN}
                    nested
                    onSelect={applyZoom}
                    zoom={zoomFactor}
                  />
                }
                size="sm"
              />
              <Button
                onClick={() => {
                  applyZoom(1);
                }}
                size="sm"
                variant="ghost"
              >
                Reset
              </Button>
            </DropdownMenuContent>
          </DropdownMenu>
        );
        const rowReload = (
          <TabRowControl
            chord="reloadPage"
            disabled={!active}
            icon={<ArrowClockwiseIcon className="size-4" />}
            label="Reload"
            onClick={() => guestNow()?.reload()}
          />
        );
        const bar = (
          <>
            <ToolbarTooltip chord="reloadPage">
              <Button
                disabled={!active}
                onClick={() => guestNow()?.reload()}
                size="icon-sm"
                variant="ghost"
              >
                <ArrowClockwiseIcon className="size-4" />
              </Button>
            </ToolbarTooltip>
            <form
              className="min-w-0 flex-1"
              onSubmit={(event) => {
                event.preventDefault();
                const target = resolveUrlOrSearch(draftUrl);
                if (target) {
                  navigateTo(target);
                  // Blur so the "editing" guard releases and the resolved final URL
                  // (after normalization/redirects) syncs back into the bar once the
                  // navigation commits, instead of leaving what the user typed.
                  inputRef.current?.blur();
                }
              }}
            >
              <InputGroup className="h-8 rounded-lg border border-input from-transparent to-transparent shadow-none dark:bg-transparent">
                <InputGroupInput
                  className="h-full bg-none text-ellipsis dark:border-0"
                  disabled={!active}
                  onBlur={() => {
                    editingUrlRef.current = false;
                  }}
                  onChange={(event) => {
                    setDraftUrl(event.target.value);
                  }}
                  onFocus={() => {
                    editingUrlRef.current = true;
                  }}
                  placeholder="Enter a URL or search"
                  ref={inputRef}
                  spellCheck={false}
                  value={draftUrl}
                />
                <InputGroupAddon
                  align="inline-end"
                  className="hidden group-focus-within/input-group:flex group-hover/input-group:flex"
                >
                  <ToolbarTooltip label="Open in external browser">
                    <InputGroupButton
                      disabled={!pageUrl}
                      onClick={() => {
                        if (pageUrl) {
                          openExternalLink.mutate({ url: pageUrl });
                        }
                      }}
                      size="icon-xs"
                    >
                      <ArrowSquareOutIcon />
                    </InputGroupButton>
                  </ToolbarTooltip>
                </InputGroupAddon>
              </InputGroup>
            </form>
            {menu}
          </>
        );
        if (typeof chrome === "object") {
          return (
            <>
              {chrome.reloadInto && createPortal(rowReload, chrome.reloadInto)}
              {chrome.into && createPortal(controls, chrome.into)}
              {chrome.fieldInto && createPortal(fieldZoom, chrome.fieldInto)}
            </>
          );
        }
        return chrome ? (
          <div className="flex items-center gap-1 border-b p-1.5">
            <ToolbarTooltip chord="back">
              <Button
                disabled={!active || !nav.canGoBack}
                onClick={() => {
                  stepPage(targetId, "back");
                }}
                size="icon-sm"
                variant="ghost"
              >
                <ArrowLeftIcon className="size-4" />
              </Button>
            </ToolbarTooltip>
            <ToolbarTooltip chord="forward">
              <Button
                disabled={!active || !nav.canGoForward}
                onClick={() => {
                  stepPage(targetId, "forward");
                }}
                size="icon-sm"
                variant="ghost"
              >
                <ArrowRightIcon className="size-4" />
              </Button>
            </ToolbarTooltip>
            {bar}
          </div>
        ) : null;
      })()}
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
          {blankPage && !loadError && (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 z-10 bg-card"
            />
          )}
          {loadError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-card p-6 text-center">
              <WarningCircleIcon className="size-8 text-muted-foreground" />
              <div className="space-y-1">
                <p className="text-sm font-medium">
                  This site can’t be reached
                </p>
                <p className="max-w-xs truncate text-xs text-muted-foreground">
                  {loadError.url}
                </p>
                <p className="text-xs text-muted-foreground">
                  {loadError.message}
                </p>
              </div>
              <Button
                onClick={() => {
                  navigateTo(loadError.url);
                }}
                size="sm"
                variant="outline"
              >
                Try again
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
          {openStatus === "error" ? (
            <>
              <span>Couldn’t open the browser.</span>
              <Button
                onClick={() => {
                  openBrowser({
                    id: taskId,
                    sessionId,
                  });
                }}
                size="sm"
                variant="outline"
              >
                Try again
              </Button>
            </>
          ) : openStatus === "success" ? (
            <Button
              onClick={() => {
                openBrowser({
                  id: taskId,
                  sessionId,
                });
              }}
              size="sm"
              variant="outline"
            >
              Reopen browser
            </Button>
          ) : (
            // Most pages open well inside a beat, and a line flashed up and
            // away for them reads as a flicker rather than as progress.
            <Delayed ms={800}>
              <Spinner className="size-5" delay={0} />
              <span>Opening browser…</span>
            </Delayed>
          )}
        </div>
      )}
    </div>
  );
}
