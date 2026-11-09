import { type WindowTab } from "@/client/atoms/window";
import {
  type ChosenItem,
  type Draft,
  type DraftContextItem,
} from "@/shared/drafts";
import { fileHref, folderHref } from "@/shared/computer-href";
import { instrumentLinkOf } from "@instrument-org/shared";
import { useEffect, useEffectEvent, useRef } from "react";

import { type BrowserTabsHandle } from "./browser-tabs";
import { takePersonsTab } from "./take-tab";
import {
  attachedPaths,
  bandTabLines,
  type ContextItem,
  lineKeyOf,
} from "./context-items";
import { type useWindowTabs } from "./window-tabs";

/**
 * Something a draft can have open in its band: a file or folder, a page, a
 * screen such as an app's front, or a tab of the person's own, which moves
 * in as it is (`url` is where it stands, for when it has gone since).
 */
export type BandTarget =
  | ChosenItem
  | { kind: "page"; url: string }
  | { href: string; kind: "screen" }
  | { kind: "tab"; tabId: string; url?: string };

/**
 * Opens a target as a tab of a draft's band without putting it up: it joins
 * the draft's chips, and the well or the side panel shows it only once its
 * chip is pressed. A target the band already has open is left as it is. A
 * tab of the person's own moves into the band itself, page and all
 * (`takePersonsTab`), and goes with the draft to its chat at the send; one
 * gone since opens again at its address. Answers the id of the tab that
 * shows it, when there is one.
 */
export function openInBand({
  appTabs,
  browser,
  group,
  target,
  windowTabs,
}: {
  appTabs: Parameters<typeof takePersonsTab>[0]["appTabs"];
  browser: BrowserTabsHandle | null;
  group: string;
  target: BandTarget;
  windowTabs: Pick<
    ReturnType<typeof useWindowTabs>,
    "allTabs" | "moveToGroup" | "openOrFocusScreen"
  >;
}): string | undefined {
  if (target.kind === "tab") {
    const taken = takePersonsTab({
      appTabs,
      group,
      tabId: target.tabId,
      windowTabs,
    });
    if (taken) {
      return taken.id;
    }
    return target.url === undefined
      ? undefined
      : openInBand({
          appTabs,
          browser,
          group,
          target: { kind: "page", url: target.url },
          windowTabs,
        });
  }
  if (target.kind === "page") {
    const open = windowTabs.allTabs.find(
      (tab) =>
        tab.group === group && tab.kind === "page" && tab.url === target.url,
    );
    return open?.id ?? browser?.openBehind(target.url, group);
  }
  return windowTabs.openOrFocusScreen(
    target.kind === "screen"
      ? target.href
      : target.kind === "folder"
        ? folderHref(target.path)
        : fileHref(target.path),
    { group, isOpened: true },
  );
}

/** What taking an offered chip opens in the band: the files or folders it points at, or the page or screen itself. */
export function targetsOf(item: ContextItem): BandTarget[] {
  if (item.kind === "chosen") {
    return [item.item];
  }
  if (item.kind === "chat") {
    return [];
  }
  if (item.items !== undefined && item.items.length > 0) {
    return item.items;
  }
  return item.tab.kind === "page"
    ? [
        {
          kind: "tab",
          tabId: item.tab.id,
          ...(item.tab.url === undefined ? {} : { url: item.tab.url }),
        },
      ]
    : [{ href: item.tab.href, kind: "screen" }];
}

/** The tab a line of `context` opens as in a draft's band. */
function targetOfLine(
  entry: Exclude<DraftContextItem, { kind: "chat" }>,
): BandTarget {
  if (entry.kind !== "link") {
    return entry;
  }
  const href = instrumentLinkOf(entry.url)?.href;
  return href === undefined
    ? { kind: "page", url: entry.url }
    : { href, kind: "screen" };
}

/**
 * A draft's `context` brought up to date with its band: a line for each
 * thing a tab of it stands for that the file does not have yet, and none
 * for what a tab stood for when last seen (`was`, by tab id) and no tab
 * stands for now, since that tab was closed or went somewhere else. A tab
 * still open that names nothing now (a page between addresses, a folder
 * whose Finder is not drawn) keeps its line. A line no tab was ever seen
 * standing for is left alone: it is one this window has yet to open, or
 * another chat. Undefined when nothing changes.
 */
export function contextFollowingBand(
  context: readonly DraftContextItem[] | undefined,
  {
    lines,
    was,
  }: {
    /** What each tab of the band stands for now, by its id. */
    lines: ReadonlyMap<string, readonly DraftContextItem[]>;
    was: ReadonlyMap<string, readonly string[]>;
  },
): DraftContextItem[] | undefined {
  const now = new Set([...lines.values()].flat().map(lineKeyOf));
  const gone = new Set(
    [...was].flatMap(([id, keys]) => {
      const current = lines.get(id);
      if (current?.length === 0) {
        return [];
      }
      const still = new Set((current ?? []).map(lineKeyOf));
      return keys.filter((key) => !still.has(key) && !now.has(key));
    }),
  );
  const kept = (context ?? []).filter((entry) => !gone.has(lineKeyOf(entry)));
  const had = new Set(kept.map(lineKeyOf));
  const added: DraftContextItem[] = [];
  for (const entry of [...lines.values()].flat()) {
    const key = lineKeyOf(entry);
    if (!had.has(key)) {
      had.add(key);
      added.push(entry);
    }
  }
  return added.length === 0 && kept.length === (context ?? []).length
    ? undefined
    : [...kept, ...added];
}

/**
 * What a window has seen of one draft's band: the lines it opened tabs for,
 * the tabs it opened before they are in the band, and what each tab stood
 * for when last seen.
 */
interface BandSeen {
  asked: Set<string>;
  draftId: string | undefined;
  /** The lines the file had when this window last read it; undefined before the first read. */
  inFile: Set<string> | undefined;
  opening: Map<string, string[]>;
  was: Map<string, string[]>;
}

function seenFor(draftId: string | undefined): BandSeen {
  return {
    asked: new Set(),
    draftId,
    inFile: undefined,
    opening: new Map(),
    was: new Map(),
  };
}

/**
 * Lines a view asked to open in this pass, by draft and line, so a second
 * view showing the same draft in the same commit does not open it again
 * before the first one's tab is in the band. Cleared once the pass ends.
 */
const openingNow = new Set<string>();

/**
 * Keeps a draft's `context` and the band that shows it as one: the file's
 * lines are the record, which goes to every device, and the band is how this
 * window shows them. As the draft is shown, each file, folder, page or app's
 * front a line names and no tab stands for opens as a tab of the band, once
 * for the draft. As the band changes, its tabs are written back: a tab
 * taken from the offer or opened from the plus is a line, a tab closed takes
 * its line out, and a tab that goes somewhere else (a page browsed on, a
 * folder with a file picked in it) names where it is now. Another chat is
 * only ever a line, since it has no place in a band.
 */
export function useBandContext({
  band,
  draft,
  finderOf,
  close,
  onChange,
  open,
}: {
  /** The tabs of the draft's own band that stand as chips. */
  band: readonly WindowTab[];
  /** Closes a tab of the band. */
  close: (tabId: string) => void;
  draft: Draft | undefined;
  finderOf: (id: string) => null | { folder: string; selected: ChosenItem[] };
  onChange: (update: (draft: Draft) => Draft) => void;
  /** Opens a target in the band, answering the tab's id. */
  open: (target: BandTarget) => string | undefined;
}) {
  // What this window last saw each tab stand for, the lines it opened tabs
  // for, and the tabs it opened before they are in the band: all of one
  // draft, and started again for another.
  const seen = useRef<BandSeen>(seenFor(undefined));
  const seenOf = (draftId: string) => {
    if (seen.current.draftId !== draftId) {
      seen.current = seenFor(draftId);
    }
    return seen.current;
  };
  const held = draft ? attachedPaths(draft) : [];
  const lines = new Map(
    band.map((tab) => [tab.id, bandTabLines(tab, { finderOf, held })]),
  );
  const bandSignature = [...lines]
    .map(([id, entries]) => `${id}=${entries.map(lineKeyOf).join(",")}`)
    .join("\n");
  const contextSignature = (draft?.context ?? []).map(lineKeyOf).join("\n");

  const followFile = useEffectEvent(() => {
    if (!draft) {
      return;
    }
    const state = seenOf(draft.id);
    const inFile = new Set((draft.context ?? []).map(lineKeyOf));
    // A line the file had and has no more was taken out elsewhere (another
    // device, the file by hand): the tab standing for it goes too, rather
    // than going with the message here and writing the line back.
    const taken =
      state.inFile === undefined
        ? []
        : [...state.inFile].filter((key) => !inFile.has(key));
    state.inFile = inFile;
    for (const [id, entries] of lines) {
      const keys = entries.map(lineKeyOf);
      if (keys.length > 0 && keys.every((key) => taken.includes(key))) {
        state.was.delete(id);
        close(id);
      }
    }
    const shown = new Set([...lines.values()].flat().map(lineKeyOf));
    for (const entry of draft.context ?? []) {
      const key = lineKeyOf(entry);
      if (entry.kind === "chat" || shown.has(key) || state.asked.has(key)) {
        continue;
      }
      state.asked.add(key);
      const across = `${draft.id}\n${key}`;
      if (openingNow.has(across)) {
        continue;
      }
      openingNow.add(across);
      queueMicrotask(() => openingNow.delete(across));
      const id = open(targetOfLine(entry));
      if (id !== undefined) {
        state.opening.set(id, [...(state.opening.get(id) ?? []), key]);
      }
    }
  });
  // Only as what the file names changes; the openers are made afresh each
  // render.
  useEffect(() => {
    followFile();
  }, [draft?.id, contextSignature]);

  const followBand = useEffectEvent(() => {
    if (!draft) {
      return;
    }
    const state = seenOf(draft.id);
    // A tab this window opened for a line stood for it from the start, so
    // one that lands somewhere else (a page that redirects) names that.
    for (const id of lines.keys()) {
      const opened = state.opening.get(id);
      if (opened !== undefined && !state.was.has(id)) {
        state.was.set(id, opened);
      }
      state.opening.delete(id);
    }
    const was = state.was;
    // A tab that names nothing now is still what it last named.
    state.was = new Map(
      [...lines].map(([id, entries]) => [
        id,
        entries.length > 0 ? entries.map(lineKeyOf) : (was.get(id) ?? []),
      ]),
    );
    if (contextFollowingBand(draft.context, { lines, was }) === undefined) {
      return;
    }
    // Applied to the draft as it stands when written, which may have moved on.
    onChange((current) => {
      const next = contextFollowingBand(current.context, { lines, was });
      if (next === undefined) {
        return current;
      }
      const { context: _was, ...rest } = current;
      return next.length > 0 ? { ...rest, context: next } : rest;
    });
  });
  // Only as the band's tabs or what they stand for change.
  useEffect(() => {
    followBand();
  }, [draft?.id, bandSignature]);
}
