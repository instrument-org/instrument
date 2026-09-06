import { fileTabsAtom } from "@/client/atoms/orchestrator";
import { MOUNT } from "@instrument-org/workspace/client";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useAtom } from "jotai";

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
 * Closes a file tab from outside the screen, which is what Cmd+W does when
 * This Mac is up: the tab in the address goes, and the strip moves to its
 * neighbor or back to the folder.
 */
export function useCloseFileTab() {
  const [fileTabs, setFileTabs] = useAtom(fileTabsAtom);
  const navigate = useNavigate();
  const location = useRouterState({ select: (state) => state.location });
  return () => {
    if (location.pathname !== "/orchestrator/computer") {
      return;
    }
    const search = location.search as {
      file?: string;
      path?: string;
      root?: string;
    };
    const mount = search.file;
    if (!mount) {
      return;
    }
    const index = fileTabs.findIndex((tab) => tab.mount === mount);
    const remaining = fileTabs.filter((tab) => tab.mount !== mount);
    setFileTabs(remaining);
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
