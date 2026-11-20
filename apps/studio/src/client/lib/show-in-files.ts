import {
  folderOf,
  joinHostPath,
  segmentsOf,
} from "@/client/components/window/host-path";
import { osConventions } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { folderHref } from "@/shared/computer-href";
import {
  PROJECT_FILE_NAME,
  PROJECTS_FOLDER_NAME,
} from "@instrument-org/workspace/client";
import { safe } from "@orpc/client";
import { toast } from "@/client/lib/toast";

/**
 * Whether this window has a folder view of its own to show a thing in. The
 * app window does, and keeps the person in it; outside it the thing goes
 * to the system's file manager.
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
    toast.error(`Couldn't show it in ${osConventions().inFileManager}`, {
      cause: error,
    });
  }
}

/** How the app window opens a screen in a tab of its own, which the window sets as it draws. */
let openTabInWindow: ((href: string) => void) | undefined;

/** Sets how `showInFolder` opens Files in this window: the window's own opener, as a tab of the tab group up. */
export function setFilesTabOpener(open: (href: string) => void) {
  openTabInWindow = open;
}

/**
 * Shows a file or folder on the computer where it lives: in the app window, a
 * tab of its own in Files, in the tab group up, standing in the folder, or in
 * the one a file is in with the file selected; elsewhere, in the Finder or its
 * counterpart. A tab of its own rather than the one up, so the person gets a
 * clean place to work from and whatever they were looking at stays put.
 */
export async function showInFolder(
  hostPath: string,
  { kind }: { kind: "file" | "folder" },
) {
  if (hasFilesView()) {
    openTabInWindow?.(
      kind === "folder"
        ? folderHref(hostPath)
        : folderHref(folderOf(hostPath), {
            select: segmentsOf(hostPath).at(-1),
          }),
    );
    return;
  }
  if (kind === "folder") {
    const [error] = await safe(
      rpcClient.utils.openFolder.call({ folderPath: hostPath }),
    );
    if (error) {
      toast.error("Couldn't open the folder", { cause: error });
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
    return osConventions().showInFileManager;
  }
  return kind === "file" ? "Show in Folder" : "Open in Files";
}

/** A project's own folder, `Projects/<Name>/` at the top of the workspace kept in `rootDir`. */
export function projectFolderPath(rootDir: string, name: string) {
  return joinHostPath(rootDir, PROJECTS_FOLDER_NAME, name);
}

/**
 * Opens Files at a project's own folder with its `AGENTS.md` selected, as
 * `showInFolder` shows any file, so its instructions are one look away.
 */
export async function showProjectInFiles(project: { name: string }) {
  const [error, location] = await safe(
    rpcClient.workspace.storage.location.call(),
  );
  if (error) {
    toast.error("Couldn't find the project's folder", { cause: error });
    return;
  }
  await showInFolder(
    joinHostPath(
      projectFolderPath(location.rootDir, project.name),
      PROJECT_FILE_NAME,
    ),
    { kind: "file" },
  );
}

/**
 * Shows a skill's own folder, as `showInFolder` shows any folder, found by
 * the name a task loads it by: a source's own id (`agents:handoff`) first,
 * then the name it is invoked by, the way the workspace looks one up.
 */
export async function showSkillFolder(name: string) {
  const [error, skills] = await safe(rpcClient.workspace.skill.list.call());
  if (error) {
    toast.error("Couldn't find the skill's folder", { cause: error });
    return;
  }
  const skill =
    skills.find((entry) => entry.aliases.includes(name)) ??
    skills.find((entry) => entry.qualifiedName === name);
  if (!skill) {
    toast("No skill by that name is installed on this computer.");
    return;
  }
  await showInFolder(skill.path, { kind: "folder" });
}
