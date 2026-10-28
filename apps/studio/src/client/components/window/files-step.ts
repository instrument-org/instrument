import type { FileSystemView } from "@/client/components/extend/file-system";

/**
 * One step of a Files tab's history, as its `/files` address holds it: where
 * the folder is rooted and the folder under the root it stands in, how it is
 * laid out, what is selected and searched for in it, and the file open with
 * it.
 */
export type FilesStep = {
  /** A file open with the folder, by where it is on the computer. */
  file?: string | undefined;
  /** The folder under the root, as a prefix: `Documents/Instrument/`. */
  path: string;
  /** What the folder is searched for, as typed. */
  query?: string | undefined;
  /** `~` for the home folder, a folder's own path, or the recents or the computer. */
  root: string;
  /** What is selected, as a path under the root. */
  select?: string | undefined;
  /** A page's file shown as its text. */
  source?: boolean | undefined;
  /** The folder the file's own tree is rooted at. */
  tree?: string | undefined;
  /** Absent on an address that arrives at a folder directly. */
  view?: FileSystemView | undefined;
};

/** What the person did to the Files tab, as a change to where it stands. */
export type FilesIntent =
  /** Arriving at a folder directly, from a place: everything else is left behind. */
  | { path?: string; root: string; select?: string; type: "arrive" }
  /**
   * Walking to a folder from the one on screen, the file open with it kept
   * open and the layout kept: a double-click, the columns, up a folder.
   */
  | {
      path: string;
      query?: string | undefined;
      root?: string;
      select?: string | undefined;
      type: "walk";
    }
  | { path: null | string; type: "select" }
  | { query: string; type: "search" }
  | { type: "setLayout"; view: FileSystemView }
  /** A file opened from the folder or a link, a step of its own. */
  | { file: string; tree?: string; type: "openFile" }
  /** The file open with the folder moving on in its own step: another one picked beside it. */
  | { file: string; type: "followFile" }
  | { type: "closeFile" };

/** How a change reaches the tab's history: as a step of its own, in place of the one on screen, or not at all. */
export type FilesWrite = "none" | "push" | "replace";

const STEP_KEYS = [
  "file",
  "path",
  "query",
  "root",
  "select",
  "source",
  "tree",
  "view",
] as const satisfies readonly (keyof FilesStep)[];

/** Whether two steps stand in the same place the same way. */
export function isSameStep(a: FilesStep, b: FilesStep) {
  return STEP_KEYS.every((key) => a[key] === b[key]);
}

/**
 * The step a change leads to, and how it is written: a walk, an arrival or a
 * file opening is a step of its own, and the selection, the search, the
 * layout and a file followed beside the folder change the step on screen.
 */
export function nextStep(
  step: FilesStep,
  intent: FilesIntent,
): { step: FilesStep; write: FilesWrite } {
  const [next, write] = applied(step, intent);
  return isSameStep(step, next)
    ? { step, write: "none" }
    : { step: next, write };
}

function applied(
  step: FilesStep,
  intent: FilesIntent,
): [FilesStep, Exclude<FilesWrite, "none">] {
  switch (intent.type) {
    case "arrive":
      return [
        {
          path: intent.path ?? "",
          root: intent.root,
          select: intent.select,
        },
        "push",
      ];
    case "walk":
      return [
        {
          ...step,
          path: intent.path,
          query: intent.query,
          root: intent.root ?? step.root,
          select: intent.select,
        },
        "push",
      ];
    case "select":
      return [{ ...step, select: intent.path ?? undefined }, "replace"];
    case "search":
      return [{ ...step, query: intent.query || undefined }, "replace"];
    case "setLayout":
      return [{ ...step, view: intent.view }, "replace"];
    case "openFile":
      return [
        {
          ...step,
          file: intent.file,
          select: undefined,
          source: undefined,
          tree: intent.tree ?? step.tree,
        },
        "push",
      ];
    case "followFile":
      return [
        { ...step, file: intent.file, select: undefined, source: undefined },
        "replace",
      ];
    case "closeFile":
      return [
        {
          ...step,
          file: undefined,
          select: undefined,
          source: undefined,
          tree: undefined,
        },
        "push",
      ];
  }
}
