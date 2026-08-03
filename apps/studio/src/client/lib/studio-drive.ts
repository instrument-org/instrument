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
  modals: () => StudioModalName[];
  openModal: (name: StudioModalName) => void;
  state: () => StudioDriveState;
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
      // `path` arrives as a plain string from a driving script, where the
      // router's typed route union is not available. Same shape the app-command
      // bus uses for navigation coming over IPC.
      void router?.navigate({ to: path } as Parameters<
        typeof router.navigate
      >[0]);
    },

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
