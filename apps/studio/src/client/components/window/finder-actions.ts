import { type FileTab } from "@/client/atoms/window";
import {
  type FileSystemFileItem,
  type FileSystemItem,
} from "@/client/components/extend/file-system";
import { isMacOS } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { type ComputerRefusal } from "@instrument-org/workspace/client";
import { ORPCError } from "@orpc/client";
import { spokenMessage, toast } from "@/client/lib/toast";

/**
 * A press Quick Look holds, made again for the listing's selected row with
 * the keys held with it: ↑ with the parent folder's key goes up a folder,
 * and Shift widens the selection.
 */
export function rowPress({
  altKey,
  ctrlKey,
  key,
  metaKey,
  shiftKey,
}: KeyboardEvent): KeyboardEvent {
  return new KeyboardEvent("keydown", {
    altKey,
    bubbles: true,
    cancelable: true,
    ctrlKey,
    key,
    metaKey,
    shiftKey,
  });
}

// The files routes' errors that come with a sentence written for people. The
// rest carry the system's own message, which only developer mode shows.
const SPOKEN_FILE_ERRORS = [
  "CANNOT_UNDO",
  "NAME_IN_USE",
  "NAME_INVALID",
  "NOTHING_TO_UNDO",
  "PROTECTED",
];

/** Says a file action didn't happen, with the reason when it is one a person can use. */
export function fileActionFailed(title: string, error: unknown) {
  const protection = protectionOf(error);
  if (protection) {
    protectionBlocked(protection);
    return;
  }
  toast.error(title, {
    cause: error,
    description: spokenMessage(error, SPOKEN_FILE_ERRORS),
  });
}

/**
 * Says ⌘Z couldn't take the last action back. With nothing left to take
 * back it says nothing, as the system's file manager does.
 */
export function undoFailed(error: unknown) {
  if (error instanceof ORPCError && error.code === "NOTHING_TO_UNDO") {
    return;
  }
  fileActionFailed("Couldn't undo that", error);
}

/** What Windows' ransomware protection kept out, from a files route's error. */
function protectionOf(
  error: unknown,
): undefined | { folder: string; programs: string[] } {
  if (!(error instanceof ORPCError) || error.code !== "WINDOWS_PROTECTION") {
    return undefined;
  }
  const data: unknown = error.data;
  return typeof data === "object" &&
    data !== null &&
    "folder" in data &&
    typeof data.folder === "string" &&
    "programs" in data &&
    Array.isArray(data.programs)
    ? {
        folder: data.folder,
        programs: data.programs.filter(
          (program): program is string => typeof program === "string",
        ),
      }
    : undefined;
}

/**
 * Says Windows' ransomware protection kept Instrument out of a folder, with
 * Allow: Windows' own prompt for an administrator's yes, which lets the
 * blocked programs and the app through. The person then does again what
 * they were doing.
 */
export function protectionBlocked({
  folder,
  programs,
}: {
  folder: string;
  programs: string[];
}) {
  const name = folder.split(/[\\/]/).at(-1) ?? folder;
  toast.error(`Windows is blocking Instrument from changing “${name}”`, {
    action: {
      label: "Allow",
      onClick: () => {
        void rpcClient.files.allowThroughProtection
          .call({ programs })
          .then(({ outcome }) => {
            if (outcome === "allowed") {
              toast(`Instrument can change “${name}” now. Try that again.`);
            } else if (outcome === "failed") {
              toast.error(`Couldn't let Instrument into “${name}”`, {
                description:
                  "You can allow it under Ransomware protection in Windows Security.",
              });
            }
          })
          .catch((error: unknown) => {
            toast.error(`Couldn't let Instrument into “${name}”`, {
              cause: error,
            });
          });
      },
    },
    description:
      "Ransomware protection only lets programs it trusts change this folder.",
  });
}

/** Where an item the browser is showing sits on the Mac. */
export function hostPathOfItem(item: FileSystemItem | undefined) {
  const hostPath = item?.metadata?.hostPath;
  return typeof hostPath === "string" ? hostPath : "";
}

/**
 * What a toast says a drop or paste did: what was moved or copied into the
 * folder, and how many of them replaced something. Skipped ones are named
 * only when nothing else happened. Null when there is nothing to say.
 */
export function placedMessage({
  folderName,
  placed,
  skipped,
}: {
  folderName: string;
  placed: readonly {
    how: "copied" | "moved";
    path: string;
    replaced: boolean;
  }[];
  skipped: number;
}) {
  if (placed.length === 0) {
    return skipped === 0
      ? null
      : `You skipped ${skipped === 1 ? "it" : "them"}, so nothing changed.`;
  }

  const moved = placed.filter((each) => each.how === "moved").length;
  const verb =
    moved === placed.length
      ? "Moved"
      : moved === 0
        ? "Copied"
        : "Moved and copied";
  const replaced = placed.filter((each) => each.replaced).length;
  const inTrash =
    replaced === 0
      ? ""
      : placed.length === 1
        ? " The one it replaced is in the Trash."
        : replaced === 1
          ? " The one they replaced is in the Trash."
          : ` The ${replaced.toString()} items they replaced are in the Trash.`;
  const [only] = placed;
  if (placed.length === 1 && only) {
    const name = only.path.split(/[\\/]/).at(-1) ?? only.path;
    return `${verb} “${name}” into “${folderName}”${inTrash ? `.${inTrash}` : ""}`;
  }
  return `${verb} ${placed.length.toString()} items into “${folderName}”${inTrash ? `.${inTrash}` : ""}`;
}

/** The disk a path on a Mac is on, by where disks are mounted. */
function macDiskOf(path: string) {
  return /^\/Volumes\/[^/]+/u.exec(path)?.[0] ?? "/";
}

/**
 * What the pointer says a drop will do, by the rule the drop itself follows.
 * Only the Mac: elsewhere a drag the app starts offers no move to say.
 */
export function dropEffectOf({
  altKey,
  carried,
  into,
  isMac = isMacOS(),
}: {
  altKey: boolean;
  carried: readonly string[];
  into: string;
  isMac?: boolean;
}) {
  const [first] = carried;
  if (!isMac || !first || altKey) return "copy";
  return macDiskOf(first) === macDiskOf(into) ? "move" : "copy";
}

/**
 * What a paste in the Finder copies: the computer's own list of the files
 * on the clipboard where it has one, else the files the paste event carried.
 * Only files: text on the clipboard beside them, or alone, is never pasted.
 */
export function filesToPaste(
  fromComputer: readonly { isFolder: boolean; path: string }[],
  fromEvent: readonly { hostPath: string; isFolder: boolean }[],
) {
  return fromComputer.length > 0
    ? fromComputer.map((file) => ({
        hostPath: file.path,
        isFolder: file.isFolder,
      }))
    : [...fromEvent];
}

/** A refusal in a line, under a folder opened in place in the list. */
export function refusalLine(reason: ComputerRefusal["reason"]) {
  switch (reason) {
    case "account":
      return "You don’t have permission to open this folder";
    case "app":
      return "This folder is protected";
    case "system":
      return "macOS hasn’t let Instrument read this folder";
  }
}

/** The tab a file opens in: the file by where it is on the computer. */
export function fileTabOf(file: FileSystemFileItem): FileTab | undefined {
  const hostPath = file.metadata?.hostPath;
  if (typeof hostPath !== "string") {
    return;
  }
  return {
    hostPath,
    // A recents row carries its own name: what it is called where it lives,
    // rather than what the list knows it by.
    name: file.name ?? file.path.split("/").at(-1) ?? file.path,
  };
}
