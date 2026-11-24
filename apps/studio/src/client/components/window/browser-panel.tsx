import { BrowserDownloadsButton } from "@/client/components/window/browser-downloads";
import { BrowserExtensionButtons } from "@/client/components/window/browser-extension-buttons";
import { BrowserFindCard } from "@/client/components/window/browser-find-card";
import { BrowserPageMenu } from "@/client/components/window/browser-page-menu";
import {
  CertificateErrorNotice,
  SignInSheet,
  useGuestSignIn,
} from "@/client/components/window/browser-guest-security";
import { ShortcutKeys } from "@/client/components/shortcut-keys";
import { ToolbarTooltip } from "@/client/components/toolbar-tooltip";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import { Button } from "@/client/components/ui/button";
import { Delayed } from "@/client/components/ui/delayed";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/client/components/ui/input-group";
import { Spinner } from "@/client/components/ui/spinner";
import { WindowContext } from "@/client/components/window/context";
import { LoadProgress } from "@/client/components/window/load-progress";
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
  agentZoomOf,
  getGuest,
  type GuestEventMap,
  stepPage,
} from "@/client/lib/browser-pool";
import { emulatedDevicesAtom } from "@/client/lib/emulated-devices";
import { PageZoomStepper } from "@/client/components/window/page-menu-items";
import {
  type LocatedPath,
  locateTypedPath,
  missedPathNotice,
  typedPathHere,
} from "@/client/lib/locate-typed-path";
import {
  resolveUrlOrSearch,
  webSearchUrl,
} from "@/client/lib/resolve-url-or-search";
import { focusScreenHome } from "@/client/lib/keyboard-home";
import { showInFolder } from "@/client/lib/show-in-files";
import {
  type FailedLoad,
  failedLoadCopy,
  isEmptyResponseDocument,
  isResponseDocument,
  READ_RESPONSE_DOCUMENT,
} from "@/client/lib/failed-load-copy";
import { segmentsOf } from "@/client/components/window/host-path";
import { isSiteGroup } from "@/client/components/window/app-tabs";
import { windowTabsAtom } from "@/client/components/window/window-tabs";
import { type TypedPath } from "@/client/lib/typed-path";
import { fileHref } from "@/shared/computer-href";
import { displayHostPath } from "@instrument-org/shared";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { safe } from "@orpc/client";
import {
  BROWSER_ZOOM_MAX,
  BROWSER_ZOOM_MIN,
  isCertificateError,
} from "@/shared/browser";
import { WINDOW_MENU_SHORTCUTS } from "@/shared/window-shortcuts";
import { steppedZoom } from "@/shared/zoom";
import { withoutPageEditParam } from "@instrument-org/shared";
import {
  type BrowserTargetId,
  browserTargetOf,
  type StoreId,
} from "@instrument-org/workspace/client";
import { ArrowClockwiseIcon } from "@phosphor-icons/react/ArrowClockwise";
import { ArrowLeftIcon } from "@phosphor-icons/react/ArrowLeft";
import { ArrowRightIcon } from "@phosphor-icons/react/ArrowRight";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/ArrowSquareOut";
import { ShieldSlashIcon } from "@phosphor-icons/react/ShieldSlash";
import { WarningCircleIcon } from "@phosphor-icons/react/WarningCircle";
import { XIcon } from "@phosphor-icons/react/X";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import {
  type ReactNode,
  useContext,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import { PageCaptureMark } from "@/client/components/window/page-capture-mark";
import { createPortal } from "react-dom";
import { tabCarryViewAtom } from "@/client/components/window/tab-carry-view";

/** How many times a page on screen is opened inside `AUTO_OPEN_WINDOW_MS` before its crashing is shown instead. */
const AUTO_OPENS = 3;
const AUTO_OPEN_WINDOW_MS = 30_000;

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
  layoutWidth,
  editPage,
  onEditSource,
  relayoutKey,
  restoreUrl,
  tabId,
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
  /** Drawn inside an overlay (Quick Look), whose own cover leaves this page the one Cmd+F reaches. */
  insideOverlay?: boolean;
  /**
   * The window layer the guest is shown on; see showOverSlot. A panel drawn
   * inside a floating surface names a layer above that surface, and while
   * its page is still blank keeps the guest parked rather than showing the
   * guest's own black default over the surface.
   */
  layer?: number;
  /** The width an agent's page lays out at when the first slot to show it is narrower, zoomed out to fit (see showOverSlot). */
  layoutWidth?: number;
  /** Opens the page's text for editing, when the page is a file; the menu offers it. */
  onEditSource?: () => void;
  /** The menu's Edit row, beside Edit source, for a page that can be changed in place. */
  editPage?: ReactNode;
  /** Changes whenever the panel moves without resizing, so the guest is placed again; see useBrowserSlot. */
  relayoutKey?: string;
  /**
   * Where the page goes when its guest comes up blank and its session
   * recorded no page of its own: the address a window tab remembers its page
   * at, which brings the page back after a launch or a reap.
   */
  restoreUrl?: string | undefined;
  tabId: StoreId.Tab;
}) {
  const targetId = browserTargetOf(tabId);
  const inputRef = useRef<HTMLInputElement>(null);
  const isVisible = useIsTaskPageVisible();
  // A window waiting beneath a tab's drag shows what it was given only once
  // it is a window of its own, so it neither opens a page nor keeps one awake.
  const isBeneath = useAtomValue(tabCarryViewAtom).kind === "beneath";
  const [draftUrl, setDraftUrl] = useState("");
  const [zoomFactor, setZoomFactor] = useState(1);
  // The zoom is the agent's: an agent's page zoomed out to lay out at a
  // width its side is too narrow for, until the person zooms it themselves.
  const [agentZoomed, setAgentZoomed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [zoomOpen, setZoomOpen] = useState(false);
  // null = the panel's natural size ("Actual size"). Applied via CDP device
  // emulation with a scale computed from the panel's live bounds (see
  // device-emulation.ts) rather than resizing the webview element, which
  // doesn't reliably re-layout an already-loaded guest.
  // Kept by the page, so its file's menu can set it too.
  const emulatedDevice = useAtomValue(emulatedDevicesAtom)[targetId];
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
  //
  // A failure on the computer rather than the web carries what is at the
  // path (`located`), learned after the fact, so the notice can say there is
  // nothing there and offer the closest folder that opens. `typed` marks one
  // the address field asked for, which never reached the guest at all.
  // `certificate` is a refused certificate's error, which gets the warning a
  // browser shows in place of the page.
  const [failure, setFailure] = useState<null | {
    certificate?: string;
    /** What failed, for the notice's words; absent for a typed path. */
    load?: FailedLoad;
    located?: LocatedPath;
    targetId: BrowserTargetId;
    typed?: TypedPath;
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
  // A site asking for a username and password, drawn over the page while
  // its request waits.
  const signIn = useGuestSignIn(active ? targetId : null);

  // A page under an overlay stays in view, since the dim layer stacks over it,
  // but stops being the Cmd+F target: the overlay's own host claims the single
  // find-opener slot, clears it on unmount, and this panel has to re-register.
  const covered = useIsGuestCovered({ insideOverlay });
  const surfaceRef = useRef<HTMLDivElement>(null);
  const find = useBrowserFind({
    active,
    covered,
    isVisible,
    surfaceRef,
    targetId,
  });
  const slotRef = useBrowserSlot({
    active,
    emulatedDeviceHeight: emulatedDevice?.height,
    emulatedDeviceWidth: emulatedDevice?.width,
    // A guest raised above its floating host is above the card this panel
    // draws over a blank page, so it stays parked until the page is there.
    hasLoadError:
      Boolean(loadError) ||
      signIn !== null ||
      (layer !== undefined && blankPage),
    isVisible,
    layer,
    layoutWidth,
    relayoutKey,
    targetId,
  });

  const { data: preferences } = useQuery(
    rpcClient.preferences.live.get.experimental_liveOptions(),
  );
  const setBlockAds = useMutation(
    rpcClient.preferences.setBlockAds.mutationOptions(),
  );
  // The blocker reads the choice per request, so the page reloads to show
  // it the way it looks under the new one.
  const setBlocking = (enabled: boolean) => {
    setBlockAds.mutate({ enabled }, { onSuccess: () => guestNow()?.reload() });
  };
  const openExternalLink = useMutation(
    rpcClient.utils.openExternalLink.mutationOptions(),
  );
  const savePage = useMutation(rpcClient.browser.page.saveAs.mutationOptions());
  const sharePage = useMutation(rpcClient.browser.page.share.mutationOptions());
  const { mutate: openBrowser, status: openStatus } = useMutation(
    rpcClient.workspace.browser.open.mutationOptions(),
  );

  // The target whose page crashed again each time it was opened, so the
  // panel stopped opening it and says so; stamped like `failure`.
  const [crashed, setCrashed] = useState<BrowserTargetId | null>(null);
  // A tab sent on to another address (a file's page beside a folder being
  // walked) is opened there afresh rather than shown as still crashed.
  const [crashedUrl, setCrashedUrl] = useState(restoreUrl);
  if (crashedUrl !== restoreUrl) {
    setCrashedUrl(restoreUrl);
    setCrashed(null);
  }
  // The guest comes up at the address the tab remembers, which a guest that
  // was discarded or crashed no longer has.
  const openHere = () => {
    setCrashed(null);
    openBrowser({
      take: "parked",
      targetId,
      ...(restoreUrl && restoreUrl !== "about:blank" ? { restoreUrl } : {}),
    });
  };
  // A page is in one window at a time, the one that showed it last. While
  // another window is showing this one it stays there, until the person asks
  // for it here or that window stops showing it.
  const elsewhere = useQuery(
    rpcClient.browser.live.targetsElsewhere.experimental_liveOptions(),
  ).data;
  const standing = elsewhere?.find((each) => each.targetId === targetId);
  const isShownElsewhere = standing?.isInUse ?? false;
  const canTake = standing?.canTake ?? true;
  const showHere = () => {
    openBrowser({ take: "always", targetId });
  };
  // A page on screen with no guest gets one, and only a page on screen does,
  // so a guest discarded out of sight stays gone until its page is shown
  // again. A guest can only go while its page is drawn by crashing, and one
  // that crashes again each time it opens would open forever, so after
  // `AUTO_OPENS` opens inside `AUTO_OPEN_WINDOW_MS` the panel stops and shows
  // the crash. Leaving the screen forgets the opens.
  const autoOpensRef = useRef(new Map<BrowserTargetId, number[]>());
  // The address is only where a blank guest goes.
  const autoOpen = useEffectEvent(() => {
    openHere();
  });
  useEffect(() => {
    const opens = autoOpensRef.current;
    if (!isVisible) {
      opens.delete(targetId);
      return;
    }
    if (active || isShownElsewhere || !canTake || isBeneath) {
      return;
    }
    const at = performance.now();
    const recent = (opens.get(targetId) ?? []).filter(
      (openedAt) => at - openedAt < AUTO_OPEN_WINDOW_MS,
    );
    if (recent.length >= AUTO_OPENS) {
      setCrashed(targetId);
      return;
    }
    opens.set(targetId, [...recent, at]);
    autoOpen();
  }, [
    active,
    canTake,
    isBeneath,
    isShownElsewhere,
    isVisible,
    openBrowser,
    targetId,
  ]);

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
        ...(isCertificateError(detail.errorCode)
          ? { certificate: detail.errorDescription }
          : {}),
        load: {
          errorCode: detail.errorCode,
          errorDescription: detail.errorDescription,
          url: detail.validatedURL,
        },
        targetId,
        url: detail.validatedURL,
      });
      const filePath = detail.validatedURL.startsWith("file:")
        ? typedPathHere(detail.validatedURL)
        : undefined;
      if (filePath) {
        void locateTypedPath(filePath).then((located) => {
          setFailure((current) =>
            current?.targetId === targetId &&
            current.url === detail.validatedURL
              ? { ...current, located }
              : current,
          );
        });
      }
      if (!editingUrlRef.current && detail.validatedURL) {
        setDraftUrl(detail.validatedURL);
      }
    };
    // A page committed from a 4xx or 5xx response with nothing in it gets
    // the notice too, where Chrome shows its own "HTTP ERROR" page. Read
    // once the page has stopped loading, and dropped when the guest has
    // moved on since.
    let httpError: null | { status: number; url: string } = null;
    const noteResponse = (detail: GuestEventMap["did-navigate"]) => {
      httpError =
        detail.httpResponseCode >= 400
          ? { status: detail.httpResponseCode, url: detail.url }
          : null;
    };
    const checkEmptyResponse = () => {
      const response = httpError;
      httpError = null;
      if (!response || guest.url() !== response.url) {
        return;
      }
      void guest.run(READ_RESPONSE_DOCUMENT).then((doc) => {
        if (
          isResponseDocument(doc) &&
          isEmptyResponseDocument(doc) &&
          guest.url() === response.url
        ) {
          setFailure({
            load: { httpStatus: response.status, url: response.url },
            targetId,
            url: response.url,
          });
        }
      });
    };
    // The zoom is the guest's, and moves without the panel: a chord pressed
    // in the page, or a site the guest's zoom was already set for.
    const readZoom = () => {
      const agentZoom = agentZoomOf(targetId);
      setZoomFactor(agentZoom ?? guest.zoom());
      setAgentZoomed(agentZoom !== undefined);
    };
    readZoom();
    const stops = [
      guest.on("did-navigate", readZoom),
      guest.on("zoom-set", readZoom),
      guest.on("did-navigate", clearFailure),
      guest.on("did-navigate-in-page", clearFailure),
      guest.on("did-start-loading", clearFailure),
      guest.on("did-fail-load", onFailLoad),
      guest.on("did-navigate", noteResponse),
      guest.on("did-stop-loading", checkEmptyResponse),
    ];
    // A guest's first load can end before these listeners are on, a refused
    // connection within a few milliseconds of it starting, so how the last
    // one ended is read once, for the page the guest still shows.
    void safe(rpcClient.browser.lastLoad.call({ targetId })).then(
      ({ data: last }) => {
        if (!last || guest.url() !== last.url || guest.isLoading()) {
          return;
        }
        if (last.errorCode !== undefined) {
          onFailLoad({
            errorCode: last.errorCode,
            errorDescription: last.errorDescription,
            isMainFrame: true,
            validatedURL: last.url,
          });
        } else {
          noteResponse({
            httpResponseCode: last.httpResponseCode,
            url: last.url,
          });
          checkEmptyResponse();
        }
      },
    );
    return () => {
      for (const stop of stops) {
        stop();
      }
    };
  }, [guest, targetId]);

  // Focus the URL bar on a blank page ONLY when this panel opened the browser
  // (autoOpensRef), i.e. a user-initiated open, so they can type immediately.
  // For an agent-initiated open we must not steal focus: a focused bar reads as
  // "user editing" and would block the agent's navigation from syncing into it.
  useEffect(() => {
    if (!active || !focusAddress || !autoOpensRef.current.has(targetId)) {
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

  /**
   * A path typed into the bar, which the page has no business showing: a
   * file opens in the window's own view of it, a folder or a place the system
   * would not let the app read in Files, and a path with nothing at it says
   * so here, over the page the person was on.
   */
  const openTypedPath = async (typedPath: TypedPath) => {
    const located = await locateTypedPath(typedPath);
    if (located.kind === "file" && windowContext) {
      windowContext.openScreen(fileHref(located.path), { here: true });
    } else if (located.kind !== "failed" && located.kind !== "missing") {
      await showInFolder(located.path, {
        kind: located.kind === "file" ? "file" : "folder",
      });
    } else {
      setFailure({
        located,
        targetId,
        typed: typedPath,
        url: typedPath.typed,
      });
    }
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
  const windowContext = useContext(WindowContext);
  const inWindow = windowContext !== null;
  // A page of a chat's or a draft's opens again in a browser tab of the
  // window's own, as a copy at its address; the chat keeps its page. A
  // browser tab has Duplicate Tab in the bar for the same.
  const group = useAtomValue(windowTabsAtom).tabs.find(
    (tab) => tab.id === tabId,
  )?.group;
  const openInBrowserTab =
    windowContext && group !== undefined && !isSiteGroup(group)
      ? (url: string) => {
          windowContext.openPage(url, { newTab: true });
        }
      : undefined;

  return (
    <div
      className={cn(
        "flex h-full flex-col overflow-hidden rounded-xl bg-card shadow-sm",
        className,
      )}
      data-find-surface
      ref={surfaceRef}
    >
      {isVisible && active && !isBeneath ? (
        <PageLease targetId={targetId} />
      ) : null}
      {(() => {
        // The page's menu, the same in either shape of the bar.
        const menu = (
          <BrowserPageMenu
            afterBlockAds={() => guestNow()?.reload()}
            {...(inWindow
              ? {
                  bookmark: { canBookmark: Boolean(pageUrl) },
                }
              : {})}
            editPage={editPage}
            editSource={onEditSource}
            onOpenChange={(open) => {
              // Not ready yet: the last known zoom stands.
              const current = open ? guestNow() : null;
              if (current) {
                setZoomFactor(current.zoom());
              }
              setMenuOpen(open);
            }}
            onOpenHistory={navigateTo}
            open={menuOpen}
            openInBrowserTab={
              openInBrowserTab &&
              (() => {
                const url = currentUrl();
                if (url) {
                  openInBrowserTab(url);
                }
              })
            }
            page={
              pageUrl
                ? {
                    copyUrl: () => {
                      const url = currentUrl();
                      if (url) {
                        void navigator.clipboard.writeText(url);
                      }
                    },
                    devTools: () => {
                      guestNow()?.openDevTools();
                    },
                    find: () => {
                      find.openFind();
                    },
                    hardReload: () => {
                      guestNow()?.reload({ ignoreCache: true });
                    },
                    openIn: openInTarget,
                    print: () => {
                      guestNow()?.print();
                    },
                    save: () => {
                      const current = guestNow();
                      if (current) {
                        savePage.mutate({
                          webContentsId: current.webContentsId,
                        });
                      }
                    },
                    share: () => {
                      const url = currentUrl();
                      if (url) {
                        sharePage.mutate({ url });
                      }
                    },
                    targetId,
                  }
                : undefined
            }
            zoom={
              pageUrl && (
                <PageZoomStepper onZoom={applyZoom} zoom={zoomFactor} />
              )
            }
          />
        );
        // The page's controls and the menu, which the row above can carry as
        // they are, and reload, which it keeps beside its arrows; the
        // address, the extensions' buttons and the way out to the app that
        // opens the page are drawn there by the row itself.
        const controls = (
          <>
            <BrowserDownloadsButton
              surfaceRef={surfaceRef}
              targetId={targetId}
            />
            {menu}
          </>
        );
        // The zoom, said in the address field only while the page is not at
        // its own size, the one setting people forget they changed. A press
        // on it is the zoom's stepper, the same one the menu holds.
        // A zoom the agent's side set wears the agent's color and says why on
        // hover, so it reads apart from one the person set and forgot.
        const isZoomed = Math.abs(zoomFactor - 1) > 0.001;
        const agentZoomText =
          zoomFactor < 1
            ? "Instrument zoomed out to work faster on the desktop site."
            : "Instrument zoomed in to work faster on the mobile site.";
        const zoomTrigger = (
          <DropdownMenuTrigger
            aria-label={agentZoomed ? agentZoomText : "Zoom"}
            className={cn(
              "flex h-5 shrink-0 items-center rounded-full px-1.5 font-medium tabular-nums",
              agentZoomed
                ? "bg-brand-500/12 text-brand-text hover:bg-brand-500/18 data-[state=open]:bg-brand-500/18"
                : "bg-foreground/8 text-foreground/70 hover:bg-foreground/12 hover:text-foreground data-[state=open]:bg-foreground/12",
            )}
          >
            {Math.round(zoomFactor * 100)}%
          </DropdownMenuTrigger>
        );
        const fieldZoom = isZoomed && (
          <DropdownMenu
            modal={false}
            onOpenChange={setZoomOpen}
            open={zoomOpen}
          >
            {agentZoomed ? (
              <Tooltip delayDuration={300}>
                <TooltipTrigger asChild>{zoomTrigger}</TooltipTrigger>
                <TooltipContent
                  className="flex items-center gap-2"
                  side="bottom"
                >
                  {agentZoomText}
                  <ShortcutKeys
                    accelerator={WINDOW_MENU_SHORTCUTS.actualSize.accelerator}
                  />
                </TooltipContent>
              </Tooltip>
            ) : (
              zoomTrigger
            )}
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
        // Reload becomes Stop for as long as the page loads, which is also
        // how a reload that changes nothing on the page still shows it ran.
        // Said in the address field only while ads are let through, since
        // the choice holds for every page from then on and is easy to forget
        // once the page that needed it is gone. A press turns blocking back on.
        const fieldShield = preferences?.blockAds === false && (
          <ToolbarTooltip label="Turn on ad blocking">
            <button
              className="grid size-5 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-foreground/8 hover:text-foreground"
              onClick={() => {
                setBlocking(true);
              }}
              type="button"
            >
              <ShieldSlashIcon className="size-3.5" />
            </button>
          </ToolbarTooltip>
        );
        const rowReload = nav.isLoading ? (
          <TabRowControl
            disabled={!active}
            icon={<XIcon className="size-4" />}
            label="Stop"
            onClick={() => guestNow()?.stop()}
          />
        ) : (
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
            {nav.isLoading ? (
              <ToolbarTooltip label="Stop">
                <Button
                  disabled={!active}
                  onClick={() => guestNow()?.stop()}
                  size="icon-sm"
                  variant="ghost"
                >
                  <XIcon className="size-4" />
                </Button>
              </ToolbarTooltip>
            ) : (
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
            )}
            <form
              className="min-w-0 flex-1"
              onSubmit={(event) => {
                event.preventDefault();
                const typedPath = typedPathHere(draftUrl);
                if (typedPath) {
                  void openTypedPath(typedPath);
                  inputRef.current?.blur();
                  focusScreenHome({ leaving: false });
                  return;
                }
                const target = resolveUrlOrSearch(draftUrl);
                if (target) {
                  navigateTo(target);
                  // Blur so the "editing" guard releases and the resolved final URL
                  // (after normalization/redirects) syncs back into the bar once the
                  // navigation commits, instead of leaving what the user typed.
                  inputRef.current?.blur();
                  focusScreenHome({ leaving: false });
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
                <LoadProgress stage={nav.loadStage} />
                <InputGroupAddon align="inline-end" className="empty:hidden">
                  <PageCaptureMark targetId={targetId} />
                  {fieldShield}
                </InputGroupAddon>
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
            <BrowserExtensionButtons />
            <BrowserDownloadsButton
              surfaceRef={surfaceRef}
              targetId={targetId}
            />
            {menu}
          </>
        );
        if (typeof chrome === "object") {
          return (
            <>
              {chrome.reloadInto && createPortal(rowReload, chrome.reloadInto)}
              {chrome.into && createPortal(controls, chrome.into)}
              {chrome.fieldInto &&
                createPortal(
                  <>
                    <PageCaptureMark targetId={targetId} />
                    {fieldShield}
                    {fieldZoom}
                    <LoadProgress stage={nav.loadStage} />
                  </>,
                  chrome.fieldInto,
                )}
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
      {active ? (
        <div className="relative flex-1" ref={slotRef}>
          <BrowserFindCard
            closeFind={find.closeFind}
            findInputRef={find.findInputRef}
            findOpen={find.findOpen}
            findQuery={find.findQuery}
            findResult={find.findResult}
            runFind={find.runFind}
            setFindQuery={find.setFindQuery}
          />
          {blankPage && !loadError && !signIn && (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 z-10 bg-card"
            />
          )}
          {signIn ? (
            <SignInSheet key={signIn.id} signIn={signIn} />
          ) : loadError?.certificate ? (
            <CertificateErrorNotice
              error={loadError.certificate}
              onGoBack={() => {
                if (nav.canGoBack) {
                  stepPage(targetId, "back");
                } else {
                  navigateTo("about:blank");
                }
              }}
              targetId={targetId}
              url={loadError.url}
            />
          ) : (
            loadError && (
              <LoadErrorNotice
                failure={loadError}
                onRetry={() => {
                  if (loadError.typed) {
                    void openTypedPath(loadError.typed);
                  } else {
                    navigateTo(loadError.url);
                  }
                }}
                onSearch={(words) => {
                  navigateTo(webSearchUrl(words));
                }}
              />
            )
          )}
        </div>
      ) : (
        <div className="relative flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
          {isShownElsewhere ? (
            <>
              <span>This page is open in another window.</span>
              <Button onClick={showHere} size="sm" variant="outline">
                Show Here
              </Button>
            </>
          ) : openStatus === "error" ? (
            <>
              <span>Couldn’t open the browser.</span>
              <Button onClick={openHere} size="sm" variant="outline">
                Try again
              </Button>
            </>
          ) : crashed === targetId ? (
            <CrashedPageNotice onReload={openHere} />
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

/**
 * Tells the browser this page is drawn, for as long as it is mounted: a page
 * nobody draws starts its clock, and its guest is discarded when the clock
 * runs out. Mounted only while this window has the page's guest and shows
 * it, since unmounting is what ends the subscription and with it the hold: a
 * window saying the page is open in another draws nothing of it.
 */
function PageLease({ targetId }: { targetId: BrowserTargetId }) {
  useQuery(
    rpcClient.workspace.browser.live.presence.experimental_liveOptions({
      input: { targetId },
    }),
  );
  return null;
}

/** What the panel says over a page that crashed each time it was opened, the way a browser says it over a crashed tab. */
function CrashedPageNotice({ onReload }: { onReload: () => void }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-card p-6 text-center">
      <WarningCircleIcon className="size-8 text-muted-foreground" />
      <div className="max-w-md space-y-1.5">
        <p className="text-base font-medium text-foreground">
          This page crashed
        </p>
        <p className="text-sm text-muted-foreground">
          Something went wrong while showing it. Reloading usually brings it
          back.
        </p>
      </div>
      <Button onClick={onReload} size="sm" variant="outline">
        Reload
      </Button>
    </div>
  );
}

/**
 * What the panel says over a page that did not load. A page on the web says
 * it could not be reached; a path on the computer says what is there once
 * that is known: nothing, with the closest folder above it that opens, or a
 * place the system would not let the app read, opened in Files where that is
 * undone.
 */
function LoadErrorNotice({
  failure,
  onRetry,
  onSearch,
}: {
  failure: {
    load?: FailedLoad;
    located?: LocatedPath;
    typed?: TypedPath;
    url: string;
  };
  onRetry: () => void;
  onSearch: (words: string) => void;
}) {
  const { located, typed } = failure;
  const copy = failure.load ? failedLoadCopy(failure.load) : null;
  const home = window.api.homeDir;
  const missed =
    located?.kind === "missing" || located?.kind === "failed"
      ? located
      : undefined;
  const nearest = located?.kind === "missing" ? located.nearest : undefined;
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-card p-6 text-center">
      <WarningCircleIcon className="size-8 text-muted-foreground" />
      {missed ? (
        <p className="max-w-sm text-sm font-medium">
          {missedPathNotice(missed)}
        </p>
      ) : located?.kind === "refused" ? (
        <p className="max-w-sm text-sm font-medium">
          Instrument can’t read “{displayHostPath(located.path, home)}”.
        </p>
      ) : copy ? (
        <div className="max-w-md space-y-1.5">
          <p className="text-base font-medium break-words">{copy.heading}</p>
          <p className="text-sm break-words text-muted-foreground">
            {copy.summary}
          </p>
          <p className="font-mono text-xs text-muted-foreground">{copy.code}</p>
        </div>
      ) : (
        <div className="space-y-1">
          <p className="text-sm font-medium">This site can’t be reached</p>
          <p className="max-w-xs truncate text-xs text-muted-foreground">
            {failure.url}
          </p>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-center gap-2">
        {nearest !== undefined && (
          <Button
            onClick={() => {
              void showInFolder(nearest, { kind: "folder" });
            }}
            size="sm"
            variant="outline"
          >
            Open “{segmentsOf(nearest).at(-1) ?? displayHostPath(nearest, home)}
            ”
          </Button>
        )}
        {located?.kind === "refused" && (
          <Button
            onClick={() => {
              void showInFolder(located.path, { kind: "folder" });
            }}
            size="sm"
            variant="outline"
          >
            Open in Files
          </Button>
        )}
        {typed && (
          <Button
            onClick={() => {
              onSearch(typed.typed);
            }}
            size="sm"
            variant="outline"
          >
            Search the web
          </Button>
        )}
        <Button onClick={onRetry} size="sm" variant="outline">
          Reload
        </Button>
      </div>
    </div>
  );
}
