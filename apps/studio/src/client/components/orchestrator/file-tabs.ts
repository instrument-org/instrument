import {
  closedFileTabsAtom,
  type FileTab,
  fileTabsAtom,
} from "@/client/atoms/orchestrator";
import { MOUNT } from "@instrument-org/workspace/client";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useAtom, useAtomValue, useSetAtom } from "jotai";

/** The folder browser's address as the screen was left, for a navigation that keeps it. */
interface ComputerSearch {
  file?: string;
  path?: string;
  root?: string;
}

/** Where a virtual path lives on the Mac, when a granted folder covers it. */
export function hostPathOfMount(
  mount: string,
  attachedFolders: Record<string, { mountName: string; path: string }>,
): string | undefined {
  const prefix = `${MOUNT.attachedFolders}/`;
  if (!mount.startsWith(prefix)) {
    return;
  }
  const [mountName, ...rest] = mount.slice(prefix.length).split("/");
  const folder = Object.values(attachedFolders).find(
    (attached) => attached.mountName === mountName,
  );
  return folder ? [folder.path, ...rest].join("/") : undefined;
}

/**
 * Closes a file tab on This Mac: the one named, or the one in the address,
 * which is what Cmd+W closes. The strip moves to its neighbor, or back to the
 * folder when it was the last.
 */
export function useCloseFileTab() {
  const [fileTabs, setFileTabs] = useAtom(fileTabsAtom);
  const setClosed = useSetAtom(closedFileTabsAtom);
  const navigate = useNavigate();
  const location = useRouterState({ select: (state) => state.location });
  return (mount?: string) => {
    if (location.pathname !== "/orchestrator/computer") {
      return;
    }
    const search = location.search as ComputerSearch;
    const closing = mount ?? search.file;
    if (!closing) {
      return;
    }
    const index = fileTabs.findIndex((tab) => tab.mount === closing);
    const tab = fileTabs[index];
    const remaining = fileTabs.filter((entry) => entry.mount !== closing);
    setFileTabs(remaining);
    if (tab) {
      setClosed((current) => [...current, tab]);
    }
    if (search.file !== closing) {
      return;
    }
    const next = remaining[Math.max(0, index - 1)];
    void navigate({
      search: {
        path: search.path ?? "",
        root: search.root ?? "~",
        ...(next ? { file: next.mount } : {}),
      },
      to: "/orchestrator/computer",
    });
  };
}

/**
 * Opens a file in a tab on This Mac, beside whatever folder is up there, and
 * shows it. A tab already open for the file is shown rather than doubled.
 */
export function useOpenFileTab() {
  const setFileTabs = useSetAtom(fileTabsAtom);
  const navigate = useNavigate();
  const location = useRouterState({ select: (state) => state.location });
  return (tab: FileTab) => {
    setFileTabs((current) =>
      current.some((entry) => entry.mount === tab.mount)
        ? current
        : [...current, tab],
    );
    const search = location.search as ComputerSearch;
    void navigate({
      search: {
        file: tab.mount,
        path: search.path ?? "",
        root: search.root ?? "~",
      },
      to: "/orchestrator/computer",
    });
  };
}

/**
 * Brings back the file tab closed last, on This Mac, and shows it: what
 * Shift+Cmd+T does when that screen is up.
 */
export function useReopenFileTab() {
  const [closed, setClosed] = useAtom(closedFileTabsAtom);
  const openFileTab = useOpenFileTab();
  return () => {
    const tab: FileTab | undefined = closed.at(-1);
    if (!tab) {
      return;
    }
    setClosed((current) => current.slice(0, -1));
    openFileTab(tab);
  };
}

/**
 * Shows the tab at that place on This Mac, counting from one: the folder
 * browser first, then the files in strip order, nine being the last.
 */
export function useSelectFileTab() {
  const fileTabs = useAtomValue(fileTabsAtom);
  const navigate = useNavigate();
  const location = useRouterState({ select: (state) => state.location });
  return (index: number) => {
    if (location.pathname !== "/orchestrator/computer") {
      return;
    }
    const search = location.search as ComputerSearch;
    const tab = index >= 9 ? fileTabs.at(-1) : fileTabs[index - 2];
    void navigate({
      search: {
        path: search.path ?? "",
        root: search.root ?? "~",
        ...(index > 1 && tab ? { file: tab.mount } : {}),
      },
      to: "/orchestrator/computer",
    });
  };
}

/** Shows the next or previous tab on This Mac, the folder browser counting as the first, wrapping. */
export function useSelectRelativeFileTab() {
  const fileTabs = useAtomValue(fileTabsAtom);
  const navigate = useNavigate();
  const location = useRouterState({ select: (state) => state.location });
  return (direction: -1 | 1) => {
    if (location.pathname !== "/orchestrator/computer") {
      return;
    }
    const search = location.search as ComputerSearch;
    const keys = [undefined, ...fileTabs.map((tab) => tab.mount)];
    const at = Math.max(0, keys.indexOf(search.file));
    const next = keys[(at + direction + keys.length) % keys.length];
    void navigate({
      search: {
        path: search.path ?? "",
        root: search.root ?? "~",
        ...(next ? { file: next } : {}),
      },
      to: "/orchestrator/computer",
    });
  };
}
