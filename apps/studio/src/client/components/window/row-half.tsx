import { type WindowTab } from "@/client/atoms/window";
import { PageFavicon } from "@/client/components/favicon";
import { draftsAtom } from "@/client/drafts/store";
import { useGuest } from "@/client/hooks/use-browser-targets";
import { hostPathOfFileUrl } from "@/client/lib/file-url";
import { withoutPathQuotes } from "@/client/lib/path-text";
import { cn, osConventions } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { type Draft } from "@/shared/drafts";
import { safe } from "@orpc/client";
import { XIcon } from "@phosphor-icons/react/X";
import {
  browserTargetOf,
  type ChatId,
  parseBrowserTargetId,
} from "@instrument-org/workspace/client";
import { useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { createContext, type ReactNode, use, useEffect, useState } from "react";

import { useAppsBySlug } from "./apps-by-slug";
import { chatListOptions } from "./chat-list-query";
import { type Chat } from "./chats";
import { pageTabTitle } from "./file-tabs";
import { CaptureTabIcon, usePageCaptures } from "./page-capture-mark";
import { ScreenMark } from "./pane-tabs";
import { RowActionBar } from "./row-action-bar";
import {
  chatLines,
  type LineTone,
  newTabLines,
  PAGE_START_LINES,
  type PageLoad,
  pageLines,
  quiet,
  type RowLines,
  siteOf,
} from "./row-lines";
import { screenLocation, screenPresentation } from "./screen-presentation";
import { chatOfTab, draftOfTab } from "./tab-model";
import { useTaskTitles } from "./task-titles";
import { locationCrumbs } from "./tab-location";

/**
 * What the sidebar's rows read beyond the window's tabs: every chat, every
 * draft, and, for a picture of the rows, how pages' loads stand. The window
 * reads the live ones; a picture gives its own.
 */
export interface RowSources {
  chats: readonly Chat[];
  drafts: readonly Draft[];
  /** How each page's last load stands, by its tab, in place of its guest's. */
  pageLoads?: ReadonlyMap<string, PageLoad>;
}

export const RowSourcesContext = createContext<null | RowSources>(null);

/** The rows' sources: a picture's own, else the window's chats and drafts. */
function useRowSources(): RowSources {
  const given = use(RowSourcesContext);
  const { data: chats = NO_CHATS } = useQuery({
    ...chatListOptions(),
    enabled: given === null,
  });
  const drafts = useAtomValue(draftsAtom);
  return given ?? { chats, drafts };
}

const NO_CHATS: readonly Chat[] = [];

/** The ink of each tone of a row's second line. */
const TONE_INK: Record<LineTone, string> = {
  ask: "text-foreground",
  draft: "text-foreground/70",
  fail: "text-error-700 dark:text-error-300",
  news: "text-foreground/80",
  quiet: "text-muted-foreground",
  work: "text-brand-600 dark:text-brand-300",
};

/**
 * One tab as a sidebar row draws it, a whole row or half of one: its mark
 * and its title, then what it says under them (`useRowLines`). Under the
 * pointer, its close X stands at its end, centered on both lines.
 */
export function RowHalf({
  chatTitles,
  close,
  isCloseShown = false,
  isWide = false,
  tab,
}: {
  chatTitles: Map<ChatId, string>;
  close?: { label: string; run: () => void };
  /** The X kept up whatever the pointer does, for a picture of the row under it. */
  isCloseShown?: boolean;
  /** Takes twice the room of the half beside it. */
  isWide?: boolean;
  tab: WindowTab;
}) {
  const appsBySlug = useAppsBySlug();
  const lines = useRowLines(tab, chatTitles);
  return (
    <RowLinesView
      close={close}
      isCloseShown={isCloseShown}
      isWide={isWide}
      lines={lines}
      mark={
        <TabMark appsBySlug={appsBySlug} chatTitles={chatTitles} tab={tab} />
      }
    />
  );
}

/** A row half's two lines, its mark leading the first. */
export function RowLinesView({
  close,
  isCloseShown = false,
  isWide = false,
  lines,
  mark,
}: {
  close?: { label: string; run: () => void } | undefined;
  isCloseShown?: boolean;
  /** Takes twice the room of the half beside it. */
  isWide?: boolean;
  lines: RowLines;
  mark?: ReactNode;
}) {
  // The X stands at the half's end, centered on both lines.
  return (
    <div
      className={cn(
        "flex min-w-0 basis-0 items-center gap-1",
        isWide ? "flex-2" : "flex-1",
      )}
      data-row-half=""
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-5 min-w-0 items-center gap-1.5">
          {mark && (
            <span className="flex shrink-0 text-foreground/65">{mark}</span>
          )}
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-[13px] leading-5",
              lines.strong
                ? "font-semibold text-foreground"
                : "font-medium text-foreground/85",
            )}
          >
            {lines.title}
          </span>
        </div>
        <div className="flex h-5 min-w-0 items-center text-[12px] leading-5">
          <span className={cn("min-w-0 truncate", TONE_INK[lines.tone])}>
            {lines.line}
          </span>
        </div>
      </div>
      {close && (
        <RowActionBar
          actions={[
            {
              icon: <XIcon />,
              id: "close",
              label: close.label,
              run: close.run,
            },
          ]}
          isHeld={isCloseShown}
        />
      )}
    </div>
  );
}

/**
 * What a tab says on its row's two lines: a chat its state, a page its site,
 * a file its folder, a built-in page its name over the part open, a new tab the words
 * typed in it (`row-lines.ts`).
 */
function useRowLines(
  tab: WindowTab,
  chatTitles: Map<ChatId, string>,
): RowLines {
  const { chats, drafts } = useRowSources();
  const appsBySlug = useAppsBySlug();
  const taskTitles = useTaskTitles();
  const load = usePageLoad(tab);
  if (tab.kind === "page") {
    const title = pageTabTitle(tab) ?? "";
    const path = hostPathOfFileUrl(tab.url);
    return path === undefined
      ? pageLines(title, tab.url, load)
      : quiet(title, folderLine(path));
  }
  const names = { appsBySlug, chatTitles, taskTitles };
  const location = screenLocation(tab.href, names);
  const { title } = screenPresentation(tab.href, names);
  switch (location.kind) {
    case "chat": {
      const id = chatOfTab(tab);
      return chatLines(
        chats.find((each) => each.id === id),
        location.title,
        (text) => withoutPathQuotes(text, window.electron.process.platform),
      );
    }
    case "newChat": {
      const draft = draftOfTab(tab);
      return newTabLines(drafts.find((each) => each.id === draft)?.words);
    }
    case "file": {
      return quiet(title, folderLine(location.path));
    }
    case "folder": {
      return quiet(title, folderLine(location.path));
    }
    case "builtin": {
      const open = location.item ?? location.part;
      return open === undefined
        ? quiet(title, PAGE_START_LINES[location.screen])
        : quiet(title, open);
    }
    case "chats": {
      return quiet(title, "Every chat");
    }
    case "app": {
      return quiet(title, siteOf(location.site) || "App");
    }
    case "apps": {
      return quiet(title, PAGE_START_LINES.apps);
    }
    case "task": {
      return quiet(location.title, location.chat?.title ?? "Task");
    }
    case "newTab":
    case "page": {
      return title === "New Tab" ? newTabLines(undefined) : quiet(title, "");
    }
  }
}

/** Where a file or folder is, as "In" its folder, or the computer for one at the top. */
function folderLine(path: string): string {
  const crumbs = locationCrumbs(
    { kind: "folder", path },
    { home: window.api.homeDir },
  );
  const folder = crumbs.at(-2)?.label;
  return folder === undefined ? osConventions().computer : `In ${folder}`;
}

/**
 * How a page tab's last load stands: loading while its guest loads, failed
 * once its main frame could not be reached, until the next load starts. A
 * page with no guest yet is neither. A picture's sources answer for it.
 */
function usePageLoad(tab: WindowTab): PageLoad | undefined {
  const given = useRowSources().pageLoads?.get(tab.id);
  const targetId = tab.kind === "page" ? parseBrowserTargetId(tab.id) : null;
  const guest = useGuest(given === undefined ? targetId : null);
  const [state, setState] = useState<{
    load: PageLoad | undefined;
    target: string;
  }>();
  useEffect(() => {
    if (!guest) {
      return;
    }
    const target = guest.targetId;
    const set = (load: PageLoad | undefined) => {
      setState({ load, target });
    };
    set(guest.isLoading() ? "loading" : undefined);
    let isFailed = false;
    const stops = [
      guest.on("did-start-loading", () => {
        isFailed = false;
        set("loading");
      }),
      guest.on("did-stop-loading", () => {
        set(isFailed ? "failed" : undefined);
      }),
      guest.on("did-fail-load", (detail) => {
        // A sub-frame's failure, or a load cut short by the next (-3), is
        // no failure of the page's.
        if (detail.isMainFrame && detail.errorCode !== -3) {
          isFailed = true;
          set("failed");
        }
      }),
    ];
    // A first load can end before these listen: how the last one ended is
    // read once, for the page the guest still shows.
    void safe(rpcClient.browser.lastLoad.call({ targetId: target })).then(
      ({ data: last }) => {
        if (
          last?.errorCode !== undefined &&
          last.url === guest.url() &&
          !guest.isLoading()
        ) {
          isFailed = true;
          set("failed");
        }
      },
    );
    return () => {
      for (const stop of stops) {
        stop();
      }
    };
  }, [guest]);
  if (given !== undefined) {
    return given;
  }
  return state?.target === targetId ? state.load : undefined;
}

/** A tab's own mark, as its tab in a strip wears it: a page's favicon, else its kind's. */
export function TabMark({
  appsBySlug,
  chatTitles,
  tab,
}: {
  appsBySlug: ReturnType<typeof useAppsBySlug>;
  chatTitles: Map<ChatId, string>;
  tab: WindowTab;
}) {
  const capture = usePageCaptures().find(
    ({ targetId, using }) =>
      (using.audio || using.video) &&
      tab.kind === "page" &&
      targetId === browserTargetOf(tab.id),
  );
  if (capture) {
    return (
      <span className="grid size-3.5 shrink-0 place-items-center">
        <CaptureTabIcon paused={capture.paused} using={capture.using} />
      </span>
    );
  }
  if (tab.kind === "page") {
    return (
      <PageFavicon
        className="size-3.5 shrink-0"
        favicon={tab.favicon}
        hasTooltip={false}
        url={tab.url ?? tab.openedUrl ?? ""}
      />
    );
  }
  return (
    <span className="grid size-3.5 shrink-0 place-items-center [&_svg]:size-3.5">
      <ScreenMark
        appsBySlug={appsBySlug}
        chatTitles={chatTitles}
        href={tab.href}
      />
    </span>
  );
}
