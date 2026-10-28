import type { FileSystemView } from "@/client/components/extend/file-system";

import { relativeHostPath } from "./host-path";

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
  /** Absent on an address that arrives at a folder directly, until `settleArrival` gives it one. */
  view?: FileSystemView | undefined;
};

/** A step with its layout settled, which every step on screen is. */
export type SettledStep = FilesStep & { view: FileSystemView };

/**
 * The layout a folder opens in when arrived at directly: its own, the one it
 * was last set to by hand, or else the last one chosen anywhere. List is a
 * folder's only when set on it by hand, so a last choice of List opens a
 * folder of no layout of its own in the columns.
 */
export function arrivalView(
  own: FileSystemView | undefined,
  lastChosen: FileSystemView,
): FileSystemView {
  return own ?? (lastChosen === "list" ? "columns" : lastChosen);
}

/**
 * An address as it comes in from outside the tab (a place, a new tab, a
 * typed or linked address, a step an earlier build wrote) made a step: one
 * with no layout takes the one its folder arrives in, and a file with no
 * layout stands beside the folder its tree names, selected there. Walking
 * never needs this, since every walk keeps the step's layout.
 */
export function settleArrival(
  step: FilesStep,
  viewOf: (root: string, path: string) => FileSystemView,
): SettledStep {
  if (step.view !== undefined) {
    return { ...step, view: step.view };
  }
  const beside =
    step.file !== undefined && step.tree !== undefined
      ? {
          path: "",
          root: step.tree,
          select: relativeHostPath(step.tree, step.file) ?? undefined,
        }
      : { path: step.path, root: step.root };
  return { ...step, ...beside, view: viewOf(beside.root, beside.path) };
}

/** What the person did to the Files tab, as a change to where it stands. */
export type FilesIntent =
  /**
   * Arriving at a folder directly, from a place: everything else is left
   * behind, and the folder opens in the layout it arrives in (`arrivalView`).
   */
  | {
      path?: string;
      root: string;
      select?: string;
      type: "arrive";
      view: FileSystemView;
    }
  /**
   * Walking to a folder from the one on screen, the file open with it kept
   * open and the layout kept: a double-click, up a folder, a folder chosen
   * from the name menu beside a file.
   */
  | {
      path: string;
      root?: string;
      select?: string | undefined;
      type: "walk";
    }
  /**
   * The selection moved: `path` is the one the keyboard is on, and `several`
   * whether more are held beside it.
   */
  | { path: null | string; several?: boolean; type: "select" }
  | { query: string; type: "search" }
  | { type: "setLayout"; view: FileSystemView }
  /**
   * A file opened from the folder or a link, a step of its own; `select` is
   * where it is under the root, when it is.
   */
  | {
      file: string;
      select?: string | undefined;
      tree?: string;
      type: "openFile";
    }
  /** The file open with the folder moving on in its own step: another one picked beside it. */
  | { file: string; select?: string | undefined; type: "followFile" }
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
function isSameStep(a: FilesStep, b: FilesStep) {
  return STEP_KEYS.every((key) => a[key] === b[key]);
}

/** The folder a prefix sits in, as a prefix: `a/b/` and `a/b.txt` are both in `a/`. */
function parentPrefix(prefix: string) {
  return prefix.slice(0, prefix.lastIndexOf("/", prefix.length - 2) + 1);
}

/**
 * The folder on screen in the columns for a selection: a folder selected
 * alone shows its contents in the next column, so it is the one the person
 * is looking at, and anything else is in the folder that lists it.
 */
function columnsFolderOf(select: string, several = false) {
  return select.endsWith("/") && !several ? select : parentPrefix(select);
}

/**
 * The step a change leads to, and how it is written: a walk, an arrival or a
 * file opening is a step of its own, and the search, the layout and a file
 * followed beside the folder change the step on screen. So does the
 * selection, except in the columns, where selecting a folder or something in
 * another column is standing somewhere else: a step of its own, the search
 * kept, since the folder on screen is always the step's `path` there.
 */
export function nextStep(
  step: SettledStep,
  intent: FilesIntent,
): { step: SettledStep; write: FilesWrite } {
  const [next, write] = applied(step, intent);
  return isSameStep(step, next)
    ? { step, write: "none" }
    : { step: next, write };
}

function applied(
  step: SettledStep,
  intent: FilesIntent,
): [SettledStep, Exclude<FilesWrite, "none">] {
  const inColumns = step.view === "columns";
  switch (intent.type) {
    case "arrive":
      return [
        {
          path: intent.path ?? "",
          root: intent.root,
          select: intent.select,
          view: intent.view,
        },
        "push",
      ];
    case "walk":
      return [
        {
          ...step,
          path:
            inColumns && intent.select !== undefined
              ? columnsFolderOf(intent.select)
              : intent.path,
          query: undefined,
          root: intent.root ?? step.root,
          select: intent.select,
        },
        "push",
      ];
    case "select": {
      const select = intent.path ?? undefined;
      const path =
        inColumns && select !== undefined
          ? columnsFolderOf(select, intent.several)
          : step.path;
      return [
        { ...step, path, select },
        path === step.path ? "replace" : "push",
      ];
    }
    case "search":
      return [{ ...step, query: intent.query || undefined }, "replace"];
    case "setLayout": {
      // Leaving the columns leaves the window in the folder they stood in,
      // as walking into it would: nothing selected and nothing searched.
      // Entering them stands in what is selected, as selecting it there would.
      const leavesFolder =
        inColumns && intent.view !== "columns" && step.select === step.path;
      const entersColumns =
        !inColumns && intent.view === "columns" && step.select !== undefined;
      return [
        {
          ...step,
          ...(leavesFolder ? { query: undefined, select: undefined } : {}),
          ...(entersColumns && step.select !== undefined
            ? { path: columnsFolderOf(step.select) }
            : {}),
          view: intent.view,
        },
        "replace",
      ];
    }
    case "openFile":
      return [
        {
          ...step,
          file: intent.file,
          select: intent.select,
          source: undefined,
          tree: intent.tree ?? step.tree,
        },
        "push",
      ];
    case "followFile":
      return [
        {
          ...step,
          file: intent.file,
          select: intent.select,
          source: undefined,
        },
        "replace",
      ];
    case "closeFile":
      return [
        { ...step, file: undefined, source: undefined, tree: undefined },
        "push",
      ];
  }
}

/**
 * What the tab shows, against what its address says. The address is the
 * one owner of where the tab stands, but the router renders each change to
 * it in a transition of its own, behind the input that caused it, which a
 * search field typed into or a selection walked by a held arrow cannot wait
 * for. So the tab shows each step it writes at once and keeps it in `sent`
 * until the address says the same.
 */
export type ShownStep = {
  /** How many times the address moved on its own: back, forward, a place. */
  arrivals: number;
  /** The address as the tab last read it. */
  routed: SettledStep;
  /** The steps written and not yet read back, oldest first. */
  sent: readonly SettledStep[];
  /** The step on screen. */
  step: SettledStep;
};

/** A tab showing what its address says. */
export function shownStepOf(routed: SettledStep): ShownStep {
  return { arrivals: 0, routed, sent: [], step: routed };
}

/** A step written: shown at once, and kept until the address reads it back. */
export function sentStep(shown: ShownStep, step: SettledStep): ShownStep {
  return { ...shown, sent: [...shown.sent, step], step };
}

/**
 * The address moved. One of the steps the tab wrote coming back, the latest
 * or one behind it, changes nothing on screen; anything else is the address
 * moving on its own, which the tab follows, letting go of what it wrote.
 */
export function routedStep(shown: ShownStep, routed: SettledStep): ShownStep {
  if (isSameStep(shown.routed, routed)) {
    return shown;
  }
  const echo = shown.sent.findIndex((sent) => isSameStep(sent, routed));
  if (echo !== -1) {
    return { ...shown, routed, sent: shown.sent.slice(echo + 1) };
  }
  return {
    arrivals: shown.arrivals + 1,
    routed,
    sent: [],
    step: routed,
  };
}
