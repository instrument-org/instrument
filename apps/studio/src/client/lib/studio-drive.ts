import { openLogin } from "@/client/atoms/login-modal";
import { openSettings } from "@/client/atoms/settings-modal";
import { resetStudioModals } from "@/client/atoms/studio-modal";
import { appTabsAtom } from "@/client/components/window/app-tabs";
import { freshTabId, openTab } from "@/client/lib/tab-actions";
import { getTabRouter } from "@/client/lib/tab-router-registry";
import { reopenClosed } from "@/client/lib/tabs-model";
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
  closeModal: () => void;
  goto: (href: string, options?: { newTab?: boolean }) => void;
  load: () => StudioDriveLoad;
  modals: () => StudioModalName[];
  openModal: (name: StudioModalName) => void;
  /** The tab closed last, back with its history, as Shift+Cmd+T brings it. */
  reopen: () => void;
  state: () => {
    /** The open dialog's accessible title, or null when none is open. */
    dialog: null | string;
    path: null | string;
    tabs: { isSelected: boolean; pathname: string }[];
  };
}

interface StudioDriveLoad {
  /** Minted per renderer load: a new one means the app restarted. */
  id: string;
  /** Hot updates applied to this load. */
  updates: number;
}

type StudioModalName = keyof typeof MODAL_OPENERS;

/**
 * Hands the app window's tabs and modals to `studio-drive`, for as long as
 * the renderer lives. Attached under `import.meta.env.DEV`, so a packaged
 * build ships no remote control.
 */
export function initStudioDrive() {
  if (!import.meta.env.DEV) {
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

  window.__studioDrive = {
    closeModal: resetStudioModals,
    goto: (href, options) => {
      if (options?.newTab) {
        store.set(appTabsAtom, (model) =>
          openTab(model, { pathname: href, select: true }),
        );
        return;
      }
      getTabRouter(store.get(appTabsAtom).selectedId)?.history.push(href);
    },
    load: () => ({ ...load }),
    modals: () => Object.keys(MODAL_OPENERS) as StudioModalName[],
    openModal: (name) => {
      MODAL_OPENERS[name]();
    },
    reopen: () => {
      store.set(appTabsAtom, (model) =>
        reopenClosed(model, { id: freshTabId() }),
      );
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
  };
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
