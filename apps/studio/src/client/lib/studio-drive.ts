import { openLogin } from "@/client/atoms/login-modal";
import { openCreateProject } from "@/client/atoms/project-modal";
import { openSettings } from "@/client/atoms/settings-modal";
import { openShortcutGuide } from "@/client/atoms/shortcut-guide-modal";
import { openCreateSkill } from "@/client/atoms/skill-modal";
import { resetStudioModals } from "@/client/atoms/studio-modal";
import { tabsAtom } from "@/client/atoms/tabs";
import { openWelcome } from "@/client/atoms/welcome-modal";
import { openTab } from "@/client/lib/tab-actions";
import { getTabRouter } from "@/client/lib/tab-router-registry";
import { type TabId } from "@/shared/tabs";
import { getDefaultStore } from "jotai";

declare global {
  interface Window {
    __studioDrive?: StudioDrive;
  }
}

const MODAL_OPENERS = {
  "create-project": () => {
    openCreateProject();
  },
  "create-skill": openCreateSkill,
  login: () => {
    openLogin();
  },
  settings: () => {
    openSettings();
  },
  "shortcut-guide": openShortcutGuide,
  welcome: openWelcome,
} satisfies Record<string, () => void>;

interface StudioDrive {
  closeModal: () => void;
  goto: (path: string, options?: { newTab?: boolean }) => void;
  load: () => StudioDriveLoad;
  modals: () => StudioModalName[];
  openModal: (name: StudioModalName) => void;
  state: () => StudioDriveState;
}

interface StudioDriveLoad {
  /** Minted per renderer load: a new one means the app restarted. */
  id: string;
  /** Hot updates applied to this load. */
  updates: number;
}

interface StudioDriveState {
  /** The open dialog's accessible title, or null when none is open. */
  dialog: null | string;
  /** The active tab's pathname. The window URL does not carry it. */
  path: null | string;
  tabs: { id: TabId; pathname: string; selected: boolean }[];
}

type StudioModalName = keyof typeof MODAL_OPENERS;

/**
 * Dev-only imperative handle for putting the main window into a given state:
 * the dev panel's menu items, minus the menu.
 *
 * It exists because nothing else can do this from outside. The renderer keeps
 * the current route out of the window URL, and the main window restores its
 * persisted tab session on load, so navigating the web contents to a route URL
 * loads it and then paints the restored tabs over it. Without a handle, a
 * script driving Studio (smoke tests, screenshot capture, a repro) has to reach
 * every surface by the same click chain a person would, and has no way to read
 * back where it actually landed.
 *
 * Attached under `import.meta.env.DEV`, so the whole module drops out of a
 * packaged build rather than shipping a remote control gated at call time.
 * Compare {@link initDebugRpcBridge}, which ships but refuses to run without
 * the Developer Mode preference, because invoking arbitrary RPC is a different
 * blast radius than navigating.
 */
export function initStudioDrive() {
  if (!import.meta.env.DEV) {
    return;
  }

  const store = getDefaultStore();

  // A driving script has no other way to tell that the app moved under it: an
  // edit anywhere in the checkout relaunches the main process or hot-updates
  // the renderer, and the result reads as a click that stopped working or a
  // screenshot of a route nobody navigated away from. The id changes on a
  // reload, the count on every hot update in between.
  const load: StudioDriveLoad = { id: crypto.randomUUID(), updates: 0 };
  import.meta.hot?.on("vite:afterUpdate", () => {
    load.updates++;
  });

  window.__studioDrive = {
    closeModal: resetStudioModals,

    goto: (path, options) => {
      if (options?.newTab) {
        store.set(tabsAtom, (model) =>
          openTab(model, { pathname: path, select: true }),
        );
        return;
      }
      const router = getTabRouter(store.get(tabsAtom).selectedId);
      const destination = parseStudioDrivePath(path);
      // `path` arrives as a plain string from a driving script, where the
      // router's typed route union is not available. Same shape the app-command
      // bus uses for navigation coming over IPC.
      void router?.navigate(
        destination as Parameters<typeof router.navigate>[0],
      );
    },

    load: () => ({ ...load }),

    modals: () => Object.keys(MODAL_OPENERS) as StudioModalName[],

    openModal: (name) => {
      MODAL_OPENERS[name]();
    },

    state: () => {
      const model = store.get(tabsAtom);
      return {
        dialog: readOpenDialogTitle(),
        path: getTabRouter(model.selectedId)?.state.location.pathname ?? null,
        tabs: model.tabs.map((tab) => ({
          id: tab.id,
          pathname: tab.pathname,
          selected: tab.id === model.selectedId,
        })),
      };
    },
  };
}

export function parseStudioDrivePath(path: string): {
  search?: Record<string, string>;
  to: string;
} {
  const queryStart = path.indexOf("?");
  if (queryStart === -1) {
    return { to: path };
  }

  return {
    search: Object.fromEntries(new URLSearchParams(path.slice(queryStart + 1))),
    to: path.slice(0, queryStart),
  };
}

/**
 * Read from the DOM rather than the modal slot: the slot is keyed by a private
 * symbol with no name to report, and this also catches the contextual dialogs
 * that never go through it.
 */
function readOpenDialogTitle(): null | string {
  const dialog = document.querySelector('[role="dialog"]');
  if (!dialog) {
    return null;
  }
  const labelledBy = dialog.getAttribute("aria-labelledby");
  const title = labelledBy
    ? document.querySelector(`#${CSS.escape(labelledBy)}`)?.textContent
    : dialog.getAttribute("aria-label");
  return title?.trim() ?? null;
}
