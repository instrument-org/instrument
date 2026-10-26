import { folderOf } from "@/client/components/window/host-path";
import { folderLabel } from "@/client/lib/path-utils";
import { type RPCOutput } from "@/client/rpc/client";
import { folderRefusalSentence } from "@/shared/workspace-folder-refusal";
import { APP_NAME } from "@instrument-org/shared";

/**
 * What setup's folder step and Settings › Storage both do with the folder
 * the Instrument folder is going to, once it is chosen (`useFolderPick`),
 * and what they say when it can't go there.
 */

export type FolderPick = RPCOutput["workspaces"]["checkPick"];
export type Destination = FolderPick["folder"];
export type MoveRefusal = Extract<
  Destination["verdict"],
  { kind: "refused" }
>["reason"];

/** Why a folder the person picked can't take their Instrument folder, said to them. */
const REFUSALS: Record<MoveRefusal, string> = {
  home: folderRefusalSentence("home"),
  "other-workspace": folderRefusalSentence("other-workspace"),
  "own-data": folderRefusalSentence("own-data"),
  around: "Your Instrument folder is inside that folder.",
  current: "That’s where your Instrument folder already is.",
  inside: "That folder is inside your Instrument folder.",
  missing: "That folder isn’t there anymore.",
  newer: `A newer version of ${APP_NAME} made that folder. Update ${APP_NAME} to open it.`,
  "not-absolute": "That folder isn’t there anymore.",
  pinned: `This copy of ${APP_NAME} is set to keep its folder where it is.`,
  taken: `It already has a folder named .instrument that ${APP_NAME} didn’t make.`,
  unfinished: `${APP_NAME} is still updating your folder from an earlier version. Quit and reopen ${APP_NAME}, then try again.`,
  unwritable: `${APP_NAME} doesn’t have permission to save files there.`,
};

/**
 * What going ahead does with a destination: move the Instrument folder
 * there, making the folder first when it isn't there yet; open the
 * Instrument folder already there, where the screen opens one (`opens`,
 * setup's folder step); or nothing, because it can't take this one or is
 * another Instrument folder the screen won't move into.
 */
export type DestinationStep =
  | { create: boolean; type: "move" }
  | { reason: MoveRefusal; type: "refused" }
  | { type: "open" }
  | { type: "other-workspace" };

export function destinationStep(
  destination: Destination,
  { opens }: { opens: boolean },
): DestinationStep {
  const { verdict } = destination;
  switch (verdict.kind) {
    case "movable": {
      return { create: destination.contents === "new", type: "move" };
    }
    case "refused": {
      return { reason: verdict.reason, type: "refused" };
    }
    case "workspace": {
      return opens ? { type: "open" } : { type: "other-workspace" };
    }
  }
}

/**
 * The toast for a folder that can't take the Instrument folder. Where it
 * already is is nothing to do rather than a refusal, and the two folders
 * that can't take it by where they are say which one was picked.
 */
export function refusalToast(
  reason: MoveRefusal,
  { current, path }: { current: string | undefined; path: string },
): { description: string; title: string; tone: "error" | "info" } {
  const name = folderLabel(path);
  switch (reason) {
    case "current": {
      return {
        description:
          current === undefined
            ? REFUSALS.current
            : `It’s in “${folderLabel(folderOf(current))}”.`,
        title: "Your Instrument folder is already there",
        tone: "info",
      };
    }
    case "inside": {
      return {
        description: `“${name}” is inside it.`,
        title: "Choose a folder outside your Instrument folder",
        tone: "error",
      };
    }
    case "around": {
      return {
        description: `Your Instrument folder is inside “${name}”.`,
        title: `${APP_NAME} can’t use that folder`,
        tone: "error",
      };
    }
    default: {
      return {
        description: REFUSALS[reason],
        title: `${APP_NAME} can’t use that folder`,
        tone: "error",
      };
    }
  }
}

/**
 * The folder setup suggests, checked as it is rather than as a pick to put
 * a folder in, so nothing in Documents is read before it has to be: one
 * that isn't there yet is the new folder going ahead makes. A Documents
 * folder that isn't there either is still refused when the move is made,
 * and setup falls back to the home folder.
 */
export function suggestedDestination(folder: Destination): Destination {
  const { verdict } = folder;
  return verdict.kind === "refused" && verdict.reason === "missing"
    ? { ...folder, contents: "new", verdict: { kind: "movable" } }
    : folder;
}
