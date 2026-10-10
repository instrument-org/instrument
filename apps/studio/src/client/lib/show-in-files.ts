import { settingsModalAtom } from "@/client/atoms/settings-modal";
import { appTabsAtom } from "@/client/components/window/app-tabs";
import { folderOf, segmentsOf } from "@/client/components/window/host-path";
import { freshTabId } from "@/client/lib/tab-actions";
import { addTab } from "@/client/lib/tabs-model";
import { getFileManagerName, getRevealInFolderLabel } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { folderHref } from "@/shared/computer-href";
import { type ChatId } from "@instrument-org/workspace/client";
import { safe } from "@orpc/client";
import { getDefaultStore } from "jotai";
import { toast } from "sonner";

/**
 * Whether this window has a folder view of its own to show a thing in. The
 * app window does, and keeps the person in it; the onboarding window hands
 * the thing to the system's file manager.
 */
export function hasFilesView() {
  return window.api.windowType === "app";
}

/**
 * Selects a file or folder in the Finder or its counterpart: what the window
 * hands to the system when the person asks for it by name.
 */
export async function revealInFileManager(hostPath: string) {
  const [error] = await safe(
    rpcClient.utils.showFileInFolder.call({ filepath: hostPath }),
  );
  if (error) {
    toast.error(`Couldn't show it in ${getFileManagerName()}`, {
      description: error.message,
    });
  }
}

/**
 * Shows a file or folder on the computer where it lives: in the app window, a
 * tab of the window's own in Files, standing in the folder, or in the one a
 * file is in with the file selected; elsewhere, in the Finder or its
 * counterpart. A tab of its own rather than the one up, so the person gets a
 * clean place to work from and whatever they were looking at stays put.
 */
export async function showInFolder(
  hostPath: string,
  { kind }: { kind: "file" | "folder" },
) {
  if (hasFilesView()) {
    const store = getDefaultStore();
    // Settings sits over the window as a dialog, and the tab would open
    // behind it.
    store.set(settingsModalAtom, null);
    const pathname =
      kind === "folder"
        ? folderHref(hostPath)
        : folderHref(folderOf(hostPath), {
            select: segmentsOf(hostPath).at(-1),
          });
    store.set(appTabsAtom, (model) =>
      addTab(model, { id: freshTabId(), pathname, select: true }),
    );
    return;
  }
  if (kind === "folder") {
    const [error] = await safe(
      rpcClient.utils.openFolder.call({ folderPath: hostPath }),
    );
    if (error) {
      toast.error("Failed to open folder", { description: error.message });
    }
    return;
  }
  await revealInFileManager(hostPath);
}

/**
 * What a control that shows a file or folder where it lives is called in this
 * window. In Files, a file is shown in the folder it is in, and a folder is
 * opened itself, so the two are named for what each does.
 */
export function showInFolderLabel(kind: "file" | "folder") {
  if (!hasFilesView()) {
    return getRevealInFolderLabel();
  }
  return kind === "file" ? "Show in Folder" : "Open in Files";
}

/** Shows a task's own folder, which is where what it made lands, as `showInFolder` shows any folder. */
export async function showTaskFolder(taskId: ChatId) {
  const [error, hostPath] = await safe(
    rpcClient.utils.taskFolderPath.call({ id: taskId }),
  );
  if (error) {
    toast.error("Couldn't find the task's folder", {
      description: error.message,
    });
    return;
  }
  await showInFolder(hostPath, { kind: "folder" });
}
