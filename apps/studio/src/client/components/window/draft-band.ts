import { type WindowTab } from "@/client/atoms/window";
import {
  type ChosenItem,
  type Draft,
  type DraftContextItem,
} from "@/shared/drafts";
import { fileHref, folderHref } from "@/shared/computer-href";
import { instrumentLinkOf } from "@instrument-org/shared";
import { type ChatId } from "@instrument-org/workspace/client";
import { useEffect, useEffectEvent, useRef } from "react";

import { type BrowserTabsHandle } from "./browser-tabs";
import { attachedPaths, bandTabLines, lineKeyOf } from "./context-items";
import { type useWindowTabs } from "./window-tabs";

/**
 * Something a draft can have open in its band: a file or folder, or a
 * screen such as an app's front. A web page a line names is not one: the
 * draft carries it by its address, and its chat opens it at the send
 * (`pageToChat`).
 */
export type BandTarget = ChosenItem | { href: string; kind: "screen" };

/**
 * Opens a target as a tab of a draft's band without putting it up: it joins
 * the draft's chips, and the well or the side panel shows it only once its
 * chip is pressed. A target the band already has open is left as it is.
 * Answers the id of the tab that shows it.
 */
export function openInBand({
  group,
  target,
  windowTabs,
}: {
  group: string;
  target: BandTarget;
  windowTabs: Pick<ReturnType<typeof useWindowTabs>, "openOrFocusScreen">;
}): string | undefined {
  return windowTabs.openOrFocusScreen(
    target.kind === "screen"
      ? target.href
      : target.kind === "folder"
        ? folderHref(target.path)
        : fileHref(target.path),
    { group, isOpened: true },
  );
}

/**
 * The web pages a draft names by their address that no tab of its band
 * shows, which its chat opens at the send (`pageToChat`). A page the band
 * has open, from the plus, goes with the band's tabs instead.
 */
export function pagesForChat(
  draft: Draft,
  band: readonly WindowTab[],
): string[] {
  const shown = new Set(
    band.flatMap((tab) => (tab.kind === "page" && tab.url ? [tab.url] : [])),
  );
  return (draft.context ?? []).flatMap((entry) =>
    entry.kind === "link" &&
    instrumentLinkOf(entry.url) === undefined &&
    !shown.has(entry.url)
      ? [entry.url]
      : [],
  );
}

/**
 * How a page a draft names reaches its chat at the send: by its address, as
 * a new tab of the chat's own, the one up in its pane when `isUp` (nothing
 * else of the draft's went to the chat). The person's own tab showing it
 * stays where it is. Sign-ins come along, since every tab shares one browser
 * session; what was typed into the person's page and where it was scrolled
 * to do not.
 */
export function pageToChat({
  browser,
  chatId,
  isUp,
  url,
  windowTabs,
}: {
  browser: Pick<BrowserTabsHandle, "openBehind"> | null;
  chatId: ChatId;
  isUp: boolean;
  url: string;
  windowTabs: Pick<ReturnType<typeof useWindowTabs>, "select">;
}): void {
  const id = browser?.openBehind(url, chatId);
  if (id !== undefined && isUp) {
    windowTabs.select(id);
  }
}

/** The tab a line of `context` opens as in a draft's band: none for another chat, or for a web page, which its chat opens at the send. */
function targetOfLine(entry: DraftContextItem): BandTarget | undefined {
  if (entry.kind === "chat") {
    return undefined;
  }
  if (entry.kind !== "link") {
    return entry;
  }
  const href = instrumentLinkOf(entry.url)?.href;
  return href === undefined ? undefined : { href, kind: "screen" };
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
 * window shows them. As the draft is shown, each file, folder or app's front
 * a line names and no tab stands for opens as a tab of the band, once for
 * the draft. As the band changes, its tabs are written back: a tab opened
 * from the plus is a line, a tab closed takes its line out, and a tab that
 * goes somewhere else (a page browsed on, a folder with a file picked in it)
 * names where it is now. Another chat is only ever a line, since it has no
 * place in a band, and so is a web page the draft was given, which its chat
 * opens at the send (`pageToChat`).
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
      const target = targetOfLine(entry);
      if (target === undefined || shown.has(key) || state.asked.has(key)) {
        continue;
      }
      state.asked.add(key);
      const across = `${draft.id}\n${key}`;
      if (openingNow.has(across)) {
        continue;
      }
      openingNow.add(across);
      queueMicrotask(() => openingNow.delete(across));
      const id = open(target);
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
