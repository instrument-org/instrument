import { openLogin } from "@/client/atoms/login-modal";
import { openSettings } from "@/client/atoms/settings-modal";
import { resetStudioModals } from "@/client/atoms/studio-modal";
import { sidebarOpenAtom, sidebarProjectAtom } from "@/client/atoms/tab-groups";
import { type WindowTab } from "@/client/atoms/window";
import { zoomAtom } from "@/client/atoms/zoom";
import { appTabsAtom } from "@/client/components/window/app-tabs";
import { currentDrag } from "@/client/components/window/drag/session";
import { sidebarRowOrderAtom } from "@/client/components/window/held-chord-hints";
import { windowTabGroupsAtom } from "@/client/components/window/open-groups";
import {
  groupLayoutOf,
  type WindowTabs,
} from "@/client/components/window/tab-model";
import {
  groupOnScreenAtom,
  newScreenId,
  tabChangesAskedAtom,
  tabsChangeAtom,
  windowTabsAtom,
} from "@/client/components/window/window-tabs";
import { getGuest } from "@/client/lib/browser-pool";
import { callsInFlight } from "@/client/lib/calls-in-flight";
import { getGroupTabRouter } from "@/client/lib/group-tab-router-registry";
import { freshTabId } from "@/client/lib/tab-actions";
import { getTabRouter } from "@/client/lib/tab-router-registry";
import { reopenClosed } from "@/client/lib/tabs-model";
import { APP_FLAVOR } from "@instrument-org/shared";
import { browserTargetOf } from "@instrument-org/workspace/client";
import { getDefaultStore } from "jotai";

declare global {
  interface Window {
    __studioDrive?: StudioDrive;
  }
}

const MODAL_OPENERS = {
  login: () => {
    openLogin();
  },
  settings: () => {
    openSettings();
  },
} satisfies Record<string, () => void>;

/**
 * What a driving script reaches in the app window: its tabs are routers of
 * their own, so an address goes to the tab up, or to a new tab, rather than
 * to the page's URL; and the app-wide modals, by name.
 */
interface StudioDrive {
  /** What the window is still doing, each in a few words; empty once it has settled. */
  busy: () => string[];
  closeModal: () => void;
  /** The drag the window has going, if any: what is held, how, and where letting go would land it. */
  drag: () => ReturnType<typeof currentDrag>;
  /** Sends the tab up to an address, or opens it in a new tab of the group up; throws for a path no route matches. */
  goto: (href: string, options?: { newTab?: boolean }) => void;
  load: () => StudioDriveLoad;
  /** What the window shows: its tab groups, their sides and tabs, and what is up. */
  look: () => StudioDriveLook;
  modals: () => StudioModalName[];
  openModal: (name: StudioModalName) => void;
  /** The web contents of the page a tab shows, by the tab's id; null for a screen or a page not loaded yet. */
  pageOf: (tabId: string) => null | number;
  /** Opens an address as the window opens one asked of it, with nothing typed; false before the window has mounted. */
  openPage: (url: string) => boolean;
  /** The tab closed last, back with its history, as Shift+Cmd+T brings it. */
  reopen: () => void;
  /** Resolves once the window has been still for a moment, with what it was still doing when the time ran out. */
  settled: (options?: {
    capMs?: number;
    quietMs?: number;
  }) => Promise<{ busy: string[]; ms: number }>;
  state: () => {
    /** The open dialog's accessible title, or null when none is open. */
    dialog: null | string;
    path: null | string;
    tabs: { isSelected: boolean; pathname: string }[];
  };
  /** The window's tab groups, the group on screen and its sides, for a run that checks them against what is drawn. */
  windowTabs: () => {
    group: string | undefined;
    layout: ReturnType<typeof groupLayoutOf> | undefined;
    tabs: WindowTabs;
  };
}

interface StudioDriveLoad {
  /** Minted per renderer load: a new one means the app restarted. */
  id: string;
  /** Hot updates applied to this load. */
  updates: number;
}

interface StudioDriveLook {
  /** The window's groups as the sidebar lists them. */
  groups: {
    id: string;
    isPinned: boolean;
    isUp: boolean;
    sides: {
      hasKeyboard: boolean;
      tabs: {
        address: string;
        id: string;
        isUp: boolean;
        kind: "page" | "screen";
        title: string;
      }[];
    }[];
  }[];
  path: null | string;
  /** The project the sidebar's list is narrowed to, by id. */
  project: null | string;
  sidebarOpen: boolean;
  theme: "dark" | "light";
  window: { height: number; width: number; zoom: number };
}

type StudioModalName = keyof typeof MODAL_OPENERS;

/** How a tab is named, which the window says as it draws (`describeTabs`). */
let titleOfTab: ((tab: WindowTab) => string) | undefined;

/** Takes the window's own naming of a tab, for what `look` says of one. */
export function describeTabs(titleOf: (tab: WindowTab) => string) {
  titleOfTab = titleOf;
}

/** When the page last changed, once something has asked; a script asks only while it drives. */
let lastChange: number | undefined;

function watchChanges() {
  if (lastChange !== undefined) {
    return;
  }
  lastChange = performance.now();
  new MutationObserver(() => {
    lastChange = performance.now();
  }).observe(document, {
    attributes: true,
    characterData: true,
    childList: true,
    subtree: true,
  });
}

/** A request out this long is one that waits on something, not one the window is about to draw. */
const LONG_CALL_MS = 5000;
/** A live query with nothing yet after this long is a stream of events, which may never say one. */
const LIVE_WAIT_MS = 1500;
/** How long the page's own changes are waited on when nothing else is going: a reply being written, a ticking clock. */
const QUIET_CAP_MS = 800;

let windowOpenPage: ((url: string) => void) | undefined;

/** The app window's own open, which `__studioDrive.openPage` calls; the window sets it while mounted. */
export function setStudioDriveOpenPage(
  open: ((url: string) => void) | undefined,
) {
  windowOpenPage = open;
}

/**
 * Hands the app window's tabs and modals to `studio-drive`, for as long as
 * the renderer lives. Attached in a development run and in a preview, which
 * an agent downloads to drive. Both conditions are inlined at build time, so
 * a release folds this to an early return and ships no remote control.
 */
export function initStudioDrive() {
  // The raw name is what folds away in a release; the flavor check keeps a
  // name that reduces to nothing, which no preview has, from attaching it.
  if (
    !import.meta.env.DEV &&
    (!process.env.INSTRUMENT_PREVIEW_NAME || APP_FLAVOR.kind !== "preview")
  ) {
    return;
  }
  const store = getDefaultStore();

  // A driving script has no other way to tell that the app moved under it: an
  // edit anywhere in the checkout relaunches the main process or hot-updates
  // the renderer, and the result reads as a click that stopped working. The
  // id changes on a reload, the count on every hot update in between.
  const load: StudioDriveLoad = { id: crypto.randomUUID(), updates: 0 };
  import.meta.hot?.on("vite:afterUpdate", () => {
    load.updates++;
  });

  const waitingSince = new Map<string, number>();

  const layoutUp = () => {
    const group = store.get(groupOnScreenAtom);
    return group === undefined
      ? undefined
      : groupLayoutOf(store.get(windowTabsAtom), group);
  };

  const busy = () => {
    const now = Date.now();
    const doing: string[] = [];
    if (store.get(tabChangesAskedAtom) > 0) {
      doing.push("a change to the tabs");
    }
    const { selectedId } = store.get(appTabsAtom);
    const windowRouter = getTabRouter(selectedId);
    const layout = layoutUp();
    const up = layout?.sides.flatMap((side) => side.up ?? []) ?? [];
    for (const router of [
      windowRouter,
      ...up.map((id) => getGroupTabRouter(id)),
    ]) {
      if (
        router &&
        (router.state.isLoading || router.state.status === "pending")
      ) {
        doing.push(`a screen loading (${router.state.location.pathname})`);
      }
    }
    for (const tab of layout?.sides.flatMap((side) => side.tabs) ?? []) {
      if (tab.kind === "page" && up.includes(tab.id)) {
        const stage = getGuest(browserTargetOf(tab.id))?.loadStage();
        // A page still fetching after it can be read is left to itself.
        if (stage === "waiting" || stage === "committed") {
          doing.push(`a page loading (${tab.url ?? tab.openedUrl ?? ""})`);
        }
      }
    }
    const waiting = new Set<string>();
    for (const query of windowRouter?.options.context.queryClient
      .getQueryCache()
      .getAll() ?? []) {
      if (
        query.getObserversCount() === 0 ||
        query.state.fetchStatus !== "fetching"
      ) {
        continue;
      }
      const isLive = JSON.stringify(query.queryKey).includes('"type":"live"');
      if (query.state.status !== "pending") {
        continue;
      }
      const since = waitingSince.get(query.queryHash) ?? now;
      waiting.add(query.queryHash);
      waitingSince.set(query.queryHash, since);
      if (now - since < (isLive ? LIVE_WAIT_MS : LONG_CALL_MS)) {
        doing.push(`a first read (${nameOfQuery(query.queryKey)})`);
      }
    }
    for (const hash of waitingSince.keys()) {
      if (!waiting.has(hash)) {
        waitingSince.delete(hash);
      }
    }
    for (const { path, startedAt } of callsInFlight()) {
      if (now - startedAt < LONG_CALL_MS && !isOwnCall(path)) {
        doing.push(`a request (${path})`);
      }
    }
    for (const animation of document.getAnimations()) {
      const end = animation.effect?.getComputedTiming().endTime;
      if (
        animation.playState === "running" &&
        animation.timeline === document.timeline &&
        typeof end === "number" &&
        Number.isFinite(end)
      ) {
        doing.push("an animation");
        break;
      }
    }
    if (currentDrag()) {
      doing.push("a drag");
    }
    return doing;
  };

  window.__studioDrive = {
    busy,
    closeModal: resetStudioModals,
    drag: currentDrag,
    goto: (href, options) => {
      const router = getTabRouter(store.get(appTabsAtom).selectedId);
      if (href.startsWith("/") && router) {
        const [, , found] = router.getMatchedRoutes(
          new URL(href, "http://tabs").pathname,
        );
        if (found === undefined) {
          throw new Error(
            `No screen at ${href}: the route tree has no route for it. Routes: ${Object.keys(router.routesByPath).join(", ")}`,
          );
        }
      }
      if (options?.newTab) {
        // A tab in the group up: a window tab of its own would draw every
        // kept group a second time.
        const id = store.set(tabsChangeAtom, {
          args: [{ href, id: newScreenId(), select: true }],
          op: "openScreen",
        });
        if (id === undefined) {
          throw new Error(
            `No tab group on screen to open ${href} in a tab of its own.`,
          );
        }
        return;
      }
      router?.history.push(href);
    },
    load: () => ({ ...load }),
    look: () => {
      const tabs = store.get(windowTabsAtom);
      const up = store.get(groupOnScreenAtom);
      const open = store.get(windowTabGroupsAtom) ?? [];
      const order = store.get(sidebarRowOrderAtom) ?? open;
      const shown =
        up !== undefined && !order.includes(up) ? [...order, up] : order;
      return {
        groups: shown.map((id) => {
          const layout = groupLayoutOf(tabs, id);
          return {
            id,
            isPinned: tabs.groups?.[id]?.pinned === true,
            isUp: id === up,
            sides: layout.sides.map((side, index) => ({
              hasKeyboard: layout.focused === index,
              tabs: side.tabs.map((tab) => ({
                address:
                  tab.kind === "page"
                    ? (tab.url ?? tab.openedUrl ?? "")
                    : tab.href,
                id: tab.id,
                isUp: tab.id === side.up,
                kind: tab.kind,
                title: titleOfTab?.(tab) ?? "",
              })),
            })),
          };
        }),
        path:
          getTabRouter(store.get(appTabsAtom).selectedId)?.history.location
            .href ?? null,
        project: store.get(sidebarProjectAtom) ?? null,
        sidebarOpen: store.get(sidebarOpenAtom),
        theme: document.documentElement.classList.contains("dark")
          ? "dark"
          : "light",
        window: {
          height: innerHeight,
          width: innerWidth,
          zoom: store.get(zoomAtom),
        },
      };
    },
    modals: () => Object.keys(MODAL_OPENERS) as StudioModalName[],
    openModal: (name) => {
      MODAL_OPENERS[name]();
    },
    pageOf: (tabId) => getGuest(browserTargetOf(tabId))?.webContentsId ?? null,
    openPage: (url) => {
      windowOpenPage?.(url);
      return windowOpenPage !== undefined;
    },
    reopen: () => {
      store.set(appTabsAtom, (model) =>
        reopenClosed(model, { id: freshTabId() }),
      );
    },
    settled: async ({ capMs = 8000, quietMs = 60 } = {}) => {
      watchChanges();
      const start = performance.now();
      const frame = () =>
        // A window the system stopped drawing gives no frames.
        Promise.race([
          // oxlint-disable-next-line studio/no-loose-timers -- a wait for the next frame, which resolves at most once and draws nothing
          new Promise((resolve) => requestAnimationFrame(resolve)),
          // oxlint-disable-next-line studio/no-loose-timers -- the cap on that wait; resolving it late does nothing
          new Promise((resolve) => setTimeout(resolve, 100)),
        ]);
      // What the last input set off has had its handlers and effects.
      await frame();
      await frame();
      let calmAt: number | undefined;
      for (;;) {
        const now = performance.now();
        const doing = busy();
        if (doing.length > 0) {
          calmAt = undefined;
        } else {
          calmAt ??= now;
        }
        const ms = Math.round(now - start);
        const isStill =
          now - Math.max(lastChange ?? start, start) >= quietMs ||
          (calmAt !== undefined && now - calmAt >= QUIET_CAP_MS);
        if (calmAt !== undefined && now - calmAt >= quietMs / 2 && isStill) {
          return { busy: [], ms };
        }
        if (now - start > capMs) {
          return { busy: doing, ms };
        }
        await frame();
      }
    },
    state: () => {
      const model = store.get(appTabsAtom);
      return {
        dialog: readOpenDialogTitle(),
        path: getTabRouter(model.selectedId)?.history.location.href ?? null,
        tabs: model.tabs.map((tab) => ({
          isSelected: tab.id === model.selectedId,
          pathname: tab.pathname,
        })),
      };
    },
    windowTabs: () => {
      const tabs = store.get(windowTabsAtom);
      const group = store.get(groupOnScreenAtom);
      return {
        group,
        layout: group === undefined ? undefined : groupLayoutOf(tabs, group),
        tabs,
      };
    },
  };
}

/** A query's route, from the key oRPC gives it. */
function nameOfQuery(key: readonly unknown[]) {
  const [path] = key;
  return Array.isArray(path) ? path.join(".") : String(path);
}

/** Calls the driving script makes itself, which the window is not waiting on. */
function isOwnCall(path: string) {
  return path.startsWith("debug.drive.");
}

/**
 * Read from the DOM rather than the modal slot: the slot is keyed by a private
 * symbol with no name to report, and this also catches the contextual dialogs
 * that never go through it.
 */
function readOpenDialogTitle(): null | string {
  // Confirms are `alertdialog`, not `dialog`.
  const dialog = document.querySelector(
    '[role="dialog"], [role="alertdialog"]',
  );
  if (!dialog) {
    return null;
  }
  const labeledBy = dialog.getAttribute("aria-labelledby");
  const title = labeledBy
    ? document.querySelector(`#${CSS.escape(labeledBy)}`)?.textContent
    : dialog.getAttribute("aria-label");
  return title?.trim() ?? null;
}
