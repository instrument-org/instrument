import { BrowserFindBar } from "@/client/components/task/browser-find-bar";
import { Button } from "@/client/components/ui/button";
import {
  DropdownMenu,
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
import { Spinner } from "@/client/components/ui/spinner";
import {
  ZoomLevelMenu,
  ZoomStepperControl,
} from "@/client/components/zoom-controls";
import { useIsActiveTab } from "@/client/hooks/use-active-tab";
import { useBrowserFind } from "@/client/hooks/use-browser-find";
import { useBrowserSlot } from "@/client/hooks/use-browser-slot";
import { useIsGuestCovered } from "@/client/hooks/use-guest-covered";
import { getWebviewElement } from "@/client/lib/browser-pool";
import {
  EMULATED_DEVICES,
  type EmulatedDevice,
} from "@/client/lib/emulated-devices";
import { resolveUrlOrSearch } from "@/client/lib/resolve-url-or-search";
import { rpcClient } from "@/client/rpc/client";
import { BROWSER_ZOOM_MAX, BROWSER_ZOOM_MIN } from "@/shared/browser";
import { steppedZoom } from "@/shared/zoom";
import {
  type BrowserTargetId,
  encodeBrowserTargetId,
  type StoreId,
  type TaskId,
} from "@instrument-org/workspace/client";
import {
  ArrowClockwiseIcon,
  ArrowCounterClockwiseIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowSquareOutIcon,
  CopyIcon,
  DeviceMobileIcon,
  DotsThreeVerticalIcon,
  MagnifyingGlassIcon,
  WarningCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

// Shape of the `<webview>` `did-fail-load` DOM event (Electron adds these
// fields; the DOM lib types it as a plain Event).
interface DidFailLoadEvent extends Event {
  errorCode: number;
  errorDescription: string;
  isMainFrame: boolean;
  validatedURL: string;
}

/**
 * The task's in-app browser, hosted in the artifact panel. The guest `<webview>`
 * lives in the body-mounted pool; {@link useBrowserSlot} measures a slot and
 * tells the pool to show the guest over it while the panel is visible, plus
 * navigation controls and an overflow menu (zoom, open externally, copy URL).
 * Either the user (via `browser.open`, fired on mount) or the agent's
 * `agent-browser` command can create the guest; both drive the same target.
 * While the guest is being created or after it's reaped, `active` is false and
 * we show a status body.
 */
export function TaskBrowserPanel({
  active,
  onClose,
  sessionId,
  taskId,
}: {
  active: boolean;
  onClose: () => void;
  sessionId: StoreId.Session;
  taskId: TaskId;
}) {
  const targetId = encodeBrowserTargetId(taskId, sessionId);
  const inputRef = useRef<HTMLInputElement>(null);
  const isActiveTab = useIsActiveTab();
  const [draftUrl, setDraftUrl] = useState("");
  const [nav, setNav] = useState({ back: false, forward: false });
  const [zoomFactor, setZoomFactor] = useState(1);
  const [menuOpen, setMenuOpen] = useState(false);
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

  // Read once and give both hooks the same answer: a panel that parks its guest
  // under an overlay must also stop being the Cmd+F target, or the overlay's
  // own host claims the single find-opener slot, clears it on unmount, and this
  // panel never re-registers.
  const covered = useIsGuestCovered();
  const find = useBrowserFind({ active, covered, isActiveTab, targetId });
  const slotRef = useBrowserSlot({
    active,
    covered,
    emulatedDeviceHeight: emulatedDevice?.height,
    emulatedDeviceWidth: emulatedDevice?.width,
    hasLoadError: Boolean(loadError),
    isActiveTab,
    targetId,
  });

  const openExternalLink = useMutation(
    rpcClient.utils.openExternalLink.mutationOptions(),
  );
  const { mutate: openBrowser, status: openStatus } = useMutation(
    rpcClient.workspace.browser.open.mutationOptions(),
  );

  // Targets this panel has already auto-opened, so a reap (active -> false)
  // doesn't re-create the guest in a loop and defeat the reaper. After a reap
  // the user re-opens explicitly via the "Reopen browser" button.
  const autoOpenedRef = useRef<Set<BrowserTargetId>>(new Set());
  useEffect(() => {
    if (active || autoOpenedRef.current.has(targetId)) {
      return;
    }
    autoOpenedRef.current.add(targetId);
    openBrowser({ id: taskId, sessionId });
  }, [active, openBrowser, sessionId, targetId, taskId]);

  // Mirror the guest's URL + nav availability into the controls (it navigates
  // from agent CDP commands too, not just user input), and track main-frame
  // load failures so we can show a light error state.
  useEffect(() => {
    if (!active) {
      return;
    }
    const webview = getWebviewElement(targetId);
    if (!webview) {
      return;
    }
    const sync = () => {
      // getURL/canGoBack throw if the guest hasn't attached its WebContents yet;
      // the did-navigate events that also drive this only fire once it has.
      try {
        if (!editingUrlRef.current) {
          const url = webview.getURL();
          setDraftUrl(url === "about:blank" ? "" : url);
        }
        setNav({ back: webview.canGoBack(), forward: webview.canGoForward() });
      } catch {
        // Not attached yet; a did-navigate will re-run sync once it is.
      }
    };
    const onNavigate = () => {
      setFailure(null);
      sync();
    };
    const onStartLoading = () => {
      setFailure(null);
    };
    const onFailLoad = (event: Event) => {
      const detail = event as DidFailLoadEvent;
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
      // A committed error page makes the prior page a back entry, but
      // did-navigate doesn't reliably fire on error-page commit, so refresh the
      // nav buttons here instead of leaving them stale (back stuck disabled).
      try {
        setNav({ back: webview.canGoBack(), forward: webview.canGoForward() });
      } catch {
        // Guest not attached yet; a later did-navigate will sync.
      }
    };
    sync();
    webview.addEventListener("did-navigate", onNavigate);
    webview.addEventListener("did-navigate-in-page", onNavigate);
    webview.addEventListener("did-start-loading", onStartLoading);
    webview.addEventListener("did-fail-load", onFailLoad);
    return () => {
      webview.removeEventListener("did-navigate", onNavigate);
      webview.removeEventListener("did-navigate-in-page", onNavigate);
      webview.removeEventListener("did-start-loading", onStartLoading);
      webview.removeEventListener("did-fail-load", onFailLoad);
    };
  }, [active, targetId]);

  // Focus the URL bar on a blank page ONLY when this panel opened the browser
  // (autoOpenedRef), i.e. a user-initiated open, so they can type immediately.
  // For an agent-initiated open we must not steal focus: a focused bar reads as
  // "user editing" and would block the agent's navigation from syncing into it.
  useEffect(() => {
    if (!active || !autoOpenedRef.current.has(targetId)) {
      return;
    }
    try {
      const url = getWebviewElement(targetId)?.getURL();
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
    } catch {
      // Not attached yet; nothing to focus into.
    }
  }, [active, targetId]);

  // Close the overflow menu when the host window loses focus. Clicking into the
  // guest `<webview>` (a separate WebContents) blurs the host window but never
  // dispatches a pointer/focus event Radix can see, so its own outside-dismiss
  // never fires and the menu would otherwise stay stuck open over the page.
  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const close = () => {
      setMenuOpen(false);
    };
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("blur", close);
    };
  }, [menuOpen]);

  const webviewFor = () => getWebviewElement(targetId);

  // loadURL rejects on a failed navigation (bad host, offline, ...); the
  // did-fail-load listener already surfaces the error, so swallow the rejection
  // to avoid an unhandled promise error.
  const navigateTo = (url: string) => {
    void webviewFor()
      ?.loadURL(url)
      .catch(() => {
        // Surfaced by the did-fail-load listener; nothing to do here.
      });
  };

  const applyZoom = (factor: number) => {
    const webview = webviewFor();
    if (!webview) {
      return;
    }
    webview.setZoomFactor(factor);
    setZoomFactor(factor);
  };

  const currentUrl = () => {
    try {
      // getURL throws until the guest's WebContents is dom-ready; `active` can
      // lead that (it round-trips through main), so treat a throw as "no page".
      const url = webviewFor()?.getURL();
      return url && url !== "about:blank" ? url : undefined;
    } catch {
      return;
    }
  };

  // A real page is loaded (not about:blank). Zoom, copy, and open-external all
  // act on the current page, so they're only meaningful once one exists; zoom in
  // particular is per-page and doesn't carry to the next navigation.
  const pageUrl = active ? currentUrl() : undefined;

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl bg-card shadow-sm">
      <div className="flex items-center gap-1 border-b p-1.5">
        <Button
          disabled={!active || !nav.back}
          onClick={() => webviewFor()?.goBack()}
          size="icon-sm"
          variant="ghost"
        >
          <ArrowLeftIcon className="size-4" />
        </Button>
        <Button
          disabled={!active || !nav.forward}
          onClick={() => webviewFor()?.goForward()}
          size="icon-sm"
          variant="ghost"
        >
          <ArrowRightIcon className="size-4" />
        </Button>
        <Button
          disabled={!active}
          onClick={() => webviewFor()?.reload()}
          size="icon-sm"
          variant="ghost"
        >
          <ArrowClockwiseIcon className="size-4" />
        </Button>
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
              <InputGroupButton
                aria-label="Open in external browser"
                disabled={!pageUrl}
                onClick={() => {
                  if (pageUrl) {
                    openExternalLink.mutate({ url: pageUrl });
                  }
                }}
                size="icon-xs"
                title="Open in external browser"
              >
                <ArrowSquareOutIcon />
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </form>
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
            if (open) {
              const webview = webviewFor();
              if (webview) {
                try {
                  setZoomFactor(webview.getZoomFactor());
                } catch {
                  // Not dom-ready yet; keep the last known zoom.
                }
              }
            }
            setMenuOpen(open);
          }}
          open={menuOpen}
        >
          <DropdownMenuTrigger asChild>
            <Button disabled={!pageUrl} size="icon-sm" variant="ghost">
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
                  applyZoom(
                    steppedZoom({
                      direction: "in",
                      factor: zoomFactor,
                      max: BROWSER_ZOOM_MAX,
                      min: BROWSER_ZOOM_MIN,
                    }),
                  );
                }}
                onZoomOut={() => {
                  applyZoom(
                    steppedZoom({
                      direction: "out",
                      factor: zoomFactor,
                      max: BROWSER_ZOOM_MAX,
                      min: BROWSER_ZOOM_MIN,
                    }),
                  );
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
                      EMULATED_DEVICES.find((device) => device.id === value) ??
                        null,
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
                webviewFor()?.reloadIgnoringCache();
              }}
            >
              <ArrowCounterClockwiseIcon className="size-4" />
              Hard reload
            </DropdownMenuItem>
            <DropdownMenuSeparator />
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
          </DropdownMenuContent>
        </DropdownMenu>
        <Button onClick={onClose} size="icon-sm" variant="ghost">
          <XIcon className="size-4" />
        </Button>
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
                  openBrowser({ id: taskId, sessionId });
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
                openBrowser({ id: taskId, sessionId });
              }}
              size="sm"
              variant="outline"
            >
              Reopen browser
            </Button>
          ) : (
            <>
              <Spinner className="size-5" />
              <span>Opening browser…</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
