import { BrowserFindBar } from "@/client/components/task/browser-find-bar";
import { GuestLoadErrorNotice } from "@/client/components/task/guest-load-error";
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
import { useGuestNavigation } from "@/client/hooks/use-guest-navigation";
import {
  EMULATED_DEVICES,
  type EmulatedDevice,
} from "@/client/lib/emulated-devices";
import { resolveUrlOrSearch } from "@/client/lib/resolve-url-or-search";
import { rpcClient } from "@/client/rpc/client";
import { BROWSER_ZOOM_MAX, BROWSER_ZOOM_MIN } from "@/shared/browser";
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
  XIcon,
} from "@phosphor-icons/react";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

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
  const [menuOpen, setMenuOpen] = useState(false);
  // null = the panel's natural size ("Actual size"). Applied via CDP device
  // emulation with a scale computed from the panel's live bounds (see
  // device-emulation.ts) rather than resizing the webview element, which
  // doesn't reliably re-layout an already-loaded guest.
  const [emulatedDevice, setEmulatedDevice] = useState<EmulatedDevice | null>(
    null,
  );
  // While the user is editing the URL, agent-driven navigations must not
  // overwrite what they're typing.
  const editingUrlRef = useRef(false);

  const guest = useGuestNavigation({
    active,
    isUrlEditing: () => editingUrlRef.current,
    targetId,
  });
  const find = useBrowserFind({ active, isActiveTab, targetId });
  const slotRef = useBrowserSlot({
    active,
    covered: useIsGuestCovered(),
    emulatedDeviceHeight: emulatedDevice?.height,
    emulatedDeviceWidth: emulatedDevice?.width,
    hasLoadError: Boolean(guest.loadError),
    isActiveTab,
    targetId,
  });

  // Mirror the guest's URL into the address bar. Held in local state (rather
  // than read straight off the hook) because the user types into the same box.
  useEffect(() => {
    if (!editingUrlRef.current) {
      setDraftUrl(guest.url);
    }
  }, [guest.url]);

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

  // Focus the URL bar on a blank page ONLY when this panel opened the browser
  // (autoOpenedRef), i.e. a user-initiated open, so they can type immediately.
  // For an agent-initiated open we must not steal focus: a focused bar reads as
  // "user editing" and would block the agent's navigation from syncing into it.
  useEffect(() => {
    if (!active || !autoOpenedRef.current.has(targetId)) {
      return;
    }
    try {
      const url = guest.currentUrl();
      const activeElement = document.activeElement;
      // isContentEditable also covers contenteditable="" / "plaintext-only",
      // which an attribute selector would miss.
      const hostInputFocused =
        activeElement instanceof HTMLElement &&
        (activeElement.isContentEditable ||
          activeElement.matches("input, textarea, select"));
      if (!url && !hostInputFocused) {
        inputRef.current?.focus();
      }
    } catch {
      // Not attached yet; nothing to focus into.
    }
    // `guest` is rebuilt every render and this is a one-shot read at the moment
    // the guest becomes available, not something to redo as it navigates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // A real page is loaded (not about:blank). Zoom, copy, and open-external all
  // act on the current page, so they're only meaningful once one exists; zoom in
  // particular is per-page and doesn't carry to the next navigation.
  const pageUrl = active ? guest.currentUrl() : undefined;

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl bg-card shadow-sm">
      <div className="flex items-center gap-1 border-b p-1.5">
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
        <Button
          disabled={!active}
          onClick={guest.reload}
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
              guest.navigateTo(target);
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
              guest.syncZoomFactor();
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
            <DropdownMenuItem onSelect={guest.hardReload}>
              <ArrowCounterClockwiseIcon className="size-4" />
              Hard reload
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                const url = guest.currentUrl();
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
          {guest.loadError && (
            <GuestLoadErrorNotice
              error={guest.loadError}
              onRetry={() => {
                if (guest.loadError) {
                  guest.navigateTo(guest.loadError.url);
                }
              }}
            />
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
