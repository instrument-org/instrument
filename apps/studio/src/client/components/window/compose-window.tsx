import { promptDraftAtom } from "@/client/atoms/prompt-value";
import {
  APPS_HREF,
  BROWSER_HREF,
  type ComposePlacement,
  type Draft,
  type DraftAttachment,
  draftGroupOf,
  draftSnapshotsAtom,
  findersByTabAtom,
  NEW_TAB_HREF,
  type ScreenView,
  screenViewsAtom,
} from "@/client/atoms/window";
import { FileDropRegion } from "@/client/components/file-drop-region";
import { FileOpenContext } from "@/client/components/file-open-context";
import { PageOpenContext } from "@/client/components/page-open-context";
import {
  type AttachedItem,
  PromptInput,
  type PromptInputRef,
} from "@/client/components/prompt-input";
import { ToolbarTooltip } from "@/client/components/toolbar-tooltip";
import { Button } from "@/client/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import { fileUrlOf } from "@/client/lib/file-url";
import { getFileType } from "@/client/lib/get-file-type";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { fileHref, folderHref } from "@/shared/computer-href";
import { type AIGatewayModelURI } from "@instrument-org/ai-gateway/client";
import {
  type FileUpload,
  type SessionMessageDataPart,
} from "@instrument-org/workspace/client";
import { ArrowsInSimpleIcon } from "@phosphor-icons/react/ArrowsInSimple";
import { ArrowsOutSimpleIcon } from "@phosphor-icons/react/ArrowsOutSimple";
import { CircleDashedIcon } from "@phosphor-icons/react/CircleDashed";
import { MinusIcon } from "@phosphor-icons/react/Minus";
import { TrashIcon } from "@phosphor-icons/react/Trash";
import { XIcon } from "@phosphor-icons/react/X";
import { useRouterState } from "@tanstack/react-router";
import { useAtomValue, useSetAtom } from "jotai";
import { motion } from "motion/react";
import { isEqual } from "radashi";
import {
  type ReactNode,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { ulid } from "ulid";

import { appTabsAtom, hrefOfAppTab } from "./app-tabs";
import { useAppsBySlug } from "./apps-by-slug";
import { AskPills } from "./ask-pills";
import { type BrowserTabsHandle, type PageChromeSlots } from "./browser-tabs";
import { draftTitle, type Topic } from "./chats";
import {
  COMPOSE_BAR_WIDTH,
  COMPOSE_MOTION,
  COMPOSE_WIDTH,
  GROWN,
} from "./compose-layout";
import { ComposeZeroState } from "./compose-zero-state";
import { useComputerVolumes } from "./computer-volumes";
import { useWindow, WindowContext } from "./context";
import { ChosenChip, heldChipOf, HeldMark, IncludedChip } from "./context-chip";
import { behindTabOf, includedItemsOf, includedTabOf } from "./draft-context";
import { computerTabOf } from "./file-tabs";
import { GroupItem } from "./group-item";
import { segmentsOf } from "./host-path";
import { LinkSurface } from "./link-surface";
import { useComposerAsks, useStagedAskActions } from "./staged-asks";
import { topicColor } from "./topic-colors";
import { TopicMark } from "./topic-mark";
import { AddTopicChip, TopicPicker } from "./topic-picker";
import { topicTint } from "./topic-tint";
import { useDraftTopicSuggestion } from "./use-draft-topic-suggestion";
import { useTabInView } from "./use-tab-in-view";
import { WindowTabStrip } from "./window-tab-strip";
import { isHomeTab } from "./tab-model";
import { parseHref } from "./window-href";
import { useWindowTabs } from "./window-tabs";

/** What the composer hands over to start the chat. */
export interface DraftSend {
  /** The chips over the words at the press, which the chat's first message is drawn with. */
  attached: SessionMessageDataPart.SentChip[];
  files?: FileUpload.Input[];
  folders?: { path: string }[];
  modelURI: AIGatewayModelURI.Type;
  prompt: string;
}

/** Whether an address is Apps or one app's front, which a draft's band shows itself. */
function isAppsHref(pathname: string) {
  return pathname === APPS_HREF || pathname.startsWith(`${APPS_HREF}/`);
}

/** How many marks the minimized bar shows of what the draft holds. */
const BAR_MARKS = 4;

/** The most the words take before they scroll, whatever the window could give them. */
const WORDS_MAX_HEIGHT = 400;

/** A docked window's height, in layout px, however long the words run: they scroll inside it, and Expand is there for more room. */
const COMPOSE_HEIGHT = 640;

const NO_TITLES = new Map<never, never>();

/** What of an item in the composer is kept with the draft: its path, for one that has a place on disk. */
function attachmentOf(item: AttachedItem): DraftAttachment[] {
  if (item.type === "folder") {
    return [{ kind: "folder", path: item.path }];
  }
  if (!("path" in item)) {
    return [];
  }
  const { mimeType, name, path, size } = item;
  return [{ kind: "file", mimeType, name, path, size }];
}

/** A kept attachment back in the composer, drawn by its icon until it is given again. */
function itemOf(attachment: DraftAttachment): AttachedItem {
  return attachment.kind === "folder"
    ? { id: ulid(), path: attachment.path, type: "folder" }
    : {
        id: ulid(),
        mimeType: attachment.mimeType,
        name: attachment.name,
        path: attachment.path,
        size: attachment.size,
        type: "file",
      };
}

/**
 * The marks of what a group holds, for a window put down to a bar: a site's
 * icon, a file's type, a folder, the first few and a count of the rest.
 */
export function BarMarks({ group }: { group: string }) {
  const { allTabs } = useWindowTabs();
  const appsBySlug = useAppsBySlug();
  const held = allTabs.filter((tab) => tab.group === group && !isHomeTab(tab));
  if (held.length === 0) {
    return null;
  }
  return (
    <span className="flex shrink-0 items-center gap-1 [&_img]:size-3.5 [&_svg]:size-3.5">
      {held.slice(0, BAR_MARKS).map((tab) => (
        <span
          className="grid size-4 place-items-center rounded-sm bg-white/90 dark:bg-white/10 [&_img]:rounded-xs"
          key={tab.id}
        >
          <HeldMark appsBySlug={appsBySlug} tab={tab} />
        </span>
      ))}
      {held.length > BAR_MARKS && (
        <span className="text-[10px] text-white/70">
          +{held.length - BAR_MARKS}
        </span>
      )}
    </span>
  );
}

/**
 * The draft put down: a dark bar along the window's foot with its first words
 * and the marks of what it holds, brought back up by a press, closed by its
 * cross. What it holds is read off its tabs, so the bar says the same as the
 * band would.
 */
export function ComposeBar({
  draft,
  onClose,
  onOpen,
  right,
}: {
  draft: Draft;
  onClose: () => void;
  onOpen: () => void;
  /** Where the bar stands along the foot, in layout px from the right edge. */
  right: number;
}) {
  return (
    <motion.div
      animate={{ opacity: 1, right, y: 0 }}
      className="pointer-events-auto absolute bottom-[calc(1px/var(--app-zoom))] z-40 flex h-9 items-center overflow-hidden rounded-t-lg bg-gray-900 text-[12px] font-medium text-white shadow-xl-soft [clip-path:inset(-4rem_-4rem_0_-4rem)] dark:bg-gray-800 dark:ring-1 dark:ring-[color-mix(in_srgb,#fff_10%,var(--background))]"
      data-slot="compose-bar"
      exit={{ opacity: 0, y: 36 }}
      initial={{ opacity: 0, right, y: 36 }}
      style={{ width: COMPOSE_BAR_WIDTH }}
      transition={COMPOSE_MOTION}
    >
      <button
        className="flex h-full min-w-0 flex-1 items-center gap-2 px-3 text-left hover:bg-white/8"
        onClick={onOpen}
        type="button"
      >
        <CircleDashedIcon className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">
          {draftTitle(draft.words)}
        </span>
        <BarMarks group={draftGroupOf(draft.id)} />
      </button>
      <button
        aria-label="Close draft"
        className="grid h-full w-8 shrink-0 place-items-center text-white/80 hover:bg-white/8 hover:text-white"
        onClick={onClose}
        type="button"
      >
        <XIcon className="size-3.5" />
      </button>
    </motion.div>
  );
}

/**
 * A draft of a new chat, in a window that floats over the inbox and the
 * chat the way a mail client's compose window does: docked at the window's
 * bottom-right corner, or grown to fill the window inset from its edges, and
 * put down to a bar along the window's foot. Its head carries the draft's
 * name, the topic it will be filed under, the composer's controls (the plus
 * menu, the model, the arrow) and the window's own three
 * buttons; under it the words on white, borderless, and under those a gray
 * band that is the draft's own pane: the four doors when nothing is gathered
 * yet, and otherwise the gathered things as tabs with the one up drawn large,
 * a page by the browser and a folder by This Mac. The draft's tabs are the
 * chat's tabs from the moment it starts; nothing is handed over.
 *
 * The words ride in the draft's record, so the Drafts list can name it and a
 * relaunch keeps them; what else the box was given (files, a folder) is kept
 * in memory while the draft is away and put back when it comes up.
 */
export function ComposeWindow({
  browser,
  draft,
  modelURI,
  onChange,
  onClose,
  onDiscard,
  onModelChange,
  onNewTopic,
  onPageChrome,
  onPageHost,
  onPlacementChange,
  onStart,
  onViewChange,
  openOutside,
  placement,
  right,
  topics,
  width = COMPOSE_WIDTH,
}: {
  browser: BrowserTabsHandle | null;
  draft: Draft;
  modelURI: AIGatewayModelURI.Type | undefined;
  onChange: (update: (draft: Draft) => Draft) => void;
  /** The window's close, with the words as the box has them that moment: the caller keeps or throws the draft away by them. */
  onClose: (words: string) => void;
  /** Throws the draft away, from the head's trash, offered while it has words to lose. */
  onDiscard: () => void;
  onModelChange: (modelURI: AIGatewayModelURI.Type) => void;
  /** Makes a topic named for what was typed in the head's topic picker, and files the draft under it. */
  onNewTopic: (name: string) => void;
  /** The element the draft's page is drawn into while a page is up, null while none is. */
  /** Where the address row takes the page's reload and controls, while a page is up. */
  onPageChrome: (slots: PageChromeSlots | undefined) => void;
  onPageHost: (element: HTMLElement | null) => void;
  onPlacementChange: (placement: ComposePlacement) => void;
  onStart: (send: DraftSend) => void;
  /** What the band has up, in the terms the conversation is told it, or null for nothing it can say. */
  onViewChange: (view: null | ScreenView) => void;
  /** A screen the band cannot draw, handed to the window to open beside the chat. */
  openOutside: (href: string) => void;
  placement: Exclude<ComposePlacement, "bar">;
  /** Where a docked window stands along the foot, in layout px from the right edge; the windows beside it are placed the same way. */
  right: number;
  topics: Topic[];
  /** A docked window's width, narrower than its own on a row with less room. */
  width?: number;
}) {
  const appWindow = useWindow();
  const windowTabs = useWindowTabs();
  const appsBySlug = useAppsBySlug();
  const group = draftGroupOf(draft.id);
  const tabs = windowTabs.allTabs.filter((tab) => tab.group === group);
  // What was marked in files and moved here, as pills that go with the words.
  const marked = useComposerAsks({ draftId: draft.id, kind: "draft" });
  const { moveTo: moveAsks } = useStagedAskActions();
  const up = windowTabs.selectedTabIn(group);
  const isExpanded = placement === "expanded";
  // What the window has in view, and the thing the draft was opened over,
  // while it is still there to point at, wherever its tab stands now.
  const appTabs = useAtomValue(appTabsAtom);
  const activeHref = useRouterState({
    select: (routerState) => routerState.location.href,
  });
  const inView = useTabInView();
  const included = includedTabOf(draft, windowTabs.allTabs, (id) =>
    id === appTabs.selectedId ? activeHref : hrefOfAppTab(appTabs, id),
  );

  // What the thing the draft was opened over points at on this computer,
  // with what the draft already holds by name left out, so each is said
  // once, with what each of the window's own Files tabs has in its Finder.
  const finders = useAtomValue(findersByTabAtom);
  const chosen = draft.chosen ?? [];
  const includedItems = included
    ? includedItemsOf(included, finders[included.id] ?? null, chosen)
    : undefined;
  const showsIncluded =
    included !== undefined &&
    (includedItems === undefined || includedItems.length > 0);

  // What the window has up behind the draft now, when that is something
  // else: it goes with the message too, in a pill of its own the person can
  // leave out, so the draft says everything the chat will be told.
  const behind = behindTabOf(draft, inView);
  const behindItems = behind
    ? includedItemsOf(behind, finders[behind.id] ?? null, [
        ...chosen,
        ...(includedItems ?? []),
      ])
    : undefined;
  const showsBehind =
    behind !== undefined &&
    (behindItems === undefined || behindItems.length > 0);

  // The chips as the press finds them, which the chat's first message is
  // drawn with, so the transcript shows what went the way the draft did.
  const volumes = useComputerVolumes();
  const names = { appsBySlug, ...(volumes ? { volumes } : {}) };
  const attached = [
    ...chosen.map(({ kind, path }) => ({
      items: [{ kind, path }],
      kind: "paths" as const,
    })),
    ...(showsIncluded
      ? [heldChipOf({ items: includedItems, tab: included }, names)]
      : []),
    ...(showsBehind
      ? [heldChipOf({ items: behindItems, tab: behind }, names)]
      : []),
  ];

  // The words are the draft's own, wherever they are read; what else the
  // box held when it was put away is put back as it comes up.
  const key = { draftId: draft.id, scope: "draft" as const };
  const snapshots = useAtomValue(draftSnapshotsAtom);
  const setSnapshots = useSetAtom(draftSnapshotsAtom);
  const snapshot = snapshots[draft.id];
  const words = useAtomValue(promptDraftAtom(key));

  const inputRef = useRef<PromptInputRef>(null);

  // What the box holds is kept with the draft by path. Bytes with no file
  // behind them (a pasted image, long pasted words) are written to the
  // draft's own folder as they arrive and kept by that path once written.
  const staged = useRef(new Map<string, DraftAttachment | null>());
  const latestItems = useRef<AttachedItem[]>([]);
  const keepAttached = (items: AttachedItem[]) => {
    latestItems.current = items;
    const kept = items.flatMap((item) => {
      if (item.type === "file" && "content" in item) {
        const written = staged.current.get(item.id);
        return written ? [written] : [];
      }
      return attachmentOf(item);
    });
    onChange((current) => {
      if (isEqual(current.attached ?? [], kept)) {
        return current;
      }
      const { attached: _was, ...rest } = current;
      return kept.length > 0 ? { ...rest, attached: kept } : rest;
    });
  };
  const keepItems = (items: AttachedItem[]) => {
    for (const item of items) {
      if (
        item.type !== "file" ||
        !("content" in item) ||
        staged.current.has(item.id)
      ) {
        continue;
      }
      staged.current.set(item.id, null);
      void rpcClient.drafts.stage
        .call({
          content: item.content,
          draftId: draft.id,
          itemId: item.id,
          name: item.name,
        })
        .then(({ path, size }) => {
          staged.current.set(item.id, {
            kind: "file",
            mimeType: item.mimeType,
            name: item.name,
            path,
            size,
          });
          keepAttached(latestItems.current);
        })
        .catch(() => {
          staged.current.delete(item.id);
        });
    }
    keepAttached(items);
  };
  // Layout rather than passive effects: on the way in the box's handle is
  // set by then and on the way out it is still there, which a passive
  // cleanup would find already gone.
  // Past a relaunch only what has a place on disk is left, from the record.
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (snapshot) {
      input?.restore({ ...snapshot, prompt: words });
    } else if (draft.attached && draft.attached.length > 0) {
      input?.restore({ items: draft.attached.map(itemOf), prompt: words });
    }
    return () => {
      const kept = input?.snapshot();
      if (kept) {
        setSnapshots((current) => ({ ...current, [draft.id]: kept }));
      }
    };
    // Once per mount: the snapshot restored is the one from before it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.id]);

  const topic = topics.find((entry) => entry.id === draft.topicId);
  // Retired topics stay nameable on a draft already filed under one, but are
  // never offered or picked again.
  const liveTopics = topics.filter((entry) => !entry.retired);
  useDraftTopicSuggestion({ draft, onChange, topics: liveTopics, words });

  // The head's slot the composer's button row is drawn into. State rather
  // than a ref: the row is a portal, which needs the element to exist.
  const [headSlot, setHeadSlot] = useState<HTMLDivElement | null>(null);
  // What the band opens lands in the draft's group and comes up in the band,
  // never on screen behind the window; the caret goes back to the words,
  // which are what the window is for.
  const openPage = (url: string) => {
    const id = browser?.openOrFocus(url, { group });
    if (id !== undefined) {
      windowTabs.select(id);
    }
    inputRef.current?.focus();
  };
  // A screen asked for is a new tab each time, even of a kind the draft
  // already has open; a file already open is brought up instead.
  // Into the draft's new tab while that is what it has up, rather than a
  // tab beside it.
  const openScreenIn = (href: string) => {
    windowTabs.openOrFocusScreen(href, {
      group,
      isOpened: true,
      select: true,
    });
    inputRef.current?.focus();
  };
  const openFolder = (hostPath: string) => {
    openScreenIn(folderHref(hostPath));
  };
  // A page's file is what a browser is for, so it opens as a page at its
  // own address; every other file opens in its viewer.
  const openFile = (hostPath: string) => {
    const name = segmentsOf(hostPath).at(-1) ?? hostPath;
    if (getFileType({ filename: name }) === "html") {
      openPage(fileUrlOf(hostPath));
    } else {
      windowTabs.openOrFocusScreen(fileHref(hostPath), {
        group,
        isOpened: true,
        select: true,
      });
      inputRef.current?.focus();
    }
  };
  // A screen asked for from inside the band: the apps and the computer open
  // in the band, and anything else (a chat, a task, a skill) has no place in
  // a draft and opens beside the chat instead. An app is named in the words
  // by mentioning it.
  const openScreen = (href: string) => {
    const { pathname } = parseHref(href);
    if (
      computerTabOf(href) ||
      isAppsHref(pathname) ||
      pathname === parseHref(NEW_TAB_HREF).pathname
    ) {
      openScreenIn(href);
      return;
    }
    openOutside(href);
  };
  const closeTab = (id: string) => {
    windowTabs.close(id);
  };

  // What the band has up, for the chat the draft starts: a folder or file
  // is said by the screen drawing it, since only that screen knows where the
  // browser has walked to.
  const filesView = useAtomValue(screenViewsAtom)[up?.id ?? ""] ?? null;
  const onViewChangeEvent = useEffectEvent(onViewChange);
  const upKind =
    up === undefined || (up.kind === "screen" && isHomeTab(up))
      ? "home"
      : up.kind === "page"
        ? "page"
        : computerTabOf(up.href)
          ? "computer"
          : "other";
  useEffect(() => {
    onViewChangeEvent(
      upKind === "home"
        ? { screen: "home" }
        : upKind === "page"
          ? { screen: "browser" }
          : upKind === "computer"
            ? filesView
            : null,
    );
  }, [upKind, filesView]);
  useEffect(
    () => () => {
      onViewChangeEvent(null);
    },
    [],
  );
  // The element the page is drawn into, held as state so the ref React
  // calls is one stable setter: a callback made afresh each render is
  // called with null and then the element on every render, and reporting
  // each of those up re-renders the layout, which renders this again.
  const [pageHost, setPageHost] = useState<HTMLDivElement | null>(null);
  const onPageHostEvent = useEffectEvent(onPageHost);
  useEffect(() => {
    onPageHostEvent(pageHost);
  }, [pageHost]);
  useEffect(
    () => () => {
      onPageHostEvent(null);
    },
    [],
  );

  // The strip is drawn once there is anything to switch between: a lone
  // new tab is the band's own face rather than a tab.
  // Nothing open yet: the band is only its tiles and the strip under them,
  // so it takes what those need and the words take the rest.
  const isEmpty = up === undefined || upKind === "home";
  const showsStrip =
    tabs.length > 1 || (tabs[0] !== undefined && !isHomeTab(tabs[0]));
  const wordsFill = isEmpty && !showsStrip;

  const content = (() => {
    if (isEmpty) {
      return (
        <ComposeZeroState
          onAttachFiles={() => {
            inputRef.current?.pickFiles();
          }}
          onAttachFolder={() => {
            inputRef.current?.pickFolder();
          }}
          onOpenApps={() => {
            openScreenIn(APPS_HREF);
          }}
          onOpenBrowser={() => {
            // The caret goes to the new tab's address field, which takes it
            // as it arrives only while nothing else holds it; the words give
            // it up rather than taking it back.
            if (document.activeElement instanceof HTMLElement) {
              document.activeElement.blur();
            }
            windowTabs.openOrFocusScreen(BROWSER_HREF, {
              group,
              isOpened: true,
              select: true,
            });
          }}
          onOpenFolder={openFolder}
        />
      );
    }
    return (
      <GroupItem
        closeTab={closeTab}
        group={group}
        onPageChrome={onPageChrome}
        onPageHost={setPageHost}
        up={up}
      />
    );
  })();

  return (
    // Arrives from a little below its place and leaves the same way, so a
    // window opening calls the eye to the corner it opens in; a docked window
    // slides to its new place along the foot when a neighbor goes, and its
    // page is placed again as it moves (see the host's `place`).
    <motion.div
      animate={{ opacity: 1, right: isExpanded ? 0 : right, y: 0 }}
      className={cn(
        // An opaque edge, and the shadow ramp without its own hairline: these
        // windows are drawn over the pane, over a page guest, and over each
        // other, and a see-through edge takes the color of whatever it lands
        // on and doubles wherever two of them cross.
        "pointer-events-auto absolute z-40 flex flex-col overflow-hidden bg-card text-foreground shadow-xl-soft ring-1 ring-gray-300 dark:ring-gray-600",
        // Docked, the window grows with the words up to the row's height, so
        // the band keeps its room under them for as long as there is room to
        // give; only then do the words scroll.
        // A screen pixel off the foot at any zoom, so the ring stops short of
        // the edge the system draws along the window's bottom rather than
        // doubling it, and clipped at its own foot, so the ring's bottom side
        // and the shadow under it never reach that edge either. The bars
        // along the foot stand on the same line.
        isExpanded
          ? "z-41 rounded-2xl"
          : "bottom-[calc(1px/var(--app-zoom))] max-h-[calc(100%-3.5rem)] rounded-t-2xl [clip-path:inset(-4rem_-4rem_0_-4rem)]",
      )}
      data-slot="compose-window"
      exit={{ opacity: 0, y: 24 }}
      initial={{ opacity: 0, right: isExpanded ? 0 : right, y: 24 }}
      style={isExpanded ? GROWN : { height: COMPOSE_HEIGHT, width }}
      transition={COMPOSE_MOTION}
    >
      <WindowContext
        value={{
          ...appWindow,
          // A draft is already open here; a new one from inside it would
          // come up behind the one being written.
          askAbout: undefined,
          // What a file in its band marked goes into this draft.
          focusComposer: () => {
            inputRef.current?.focus();
          },
          moveAsksToDraft: (ids) => {
            moveAsks(ids, { draftId: draft.id, kind: "draft" });
          },
          openPage: (url, options) => {
            if (options?.newTab) {
              appWindow.openPage(url, options);
            } else {
              openPage(url);
            }
          },
          openPath: (path, options) => {
            appWindow.openPath(
              path,
              options?.newTab ? options : { ...options, group },
            );
          },
          openScreen: (href, options) => {
            if (options?.newTab) {
              appWindow.openScreen(href, options);
              // A grown window would cover the tab brought up behind it.
              if (isExpanded && !options.behind) {
                onPlacementChange("docked");
              }
            } else {
              openScreen(href);
            }
          },
        }}
      >
        <FileOpenContext
          value={(path, options) => {
            if (options?.newTab) {
              appWindow.openScreen(
                path.endsWith("/")
                  ? folderHref(path.slice(0, -1))
                  : fileHref(path),
                options,
              );
            } else if (path.endsWith("/")) {
              openFolder(path.slice(0, -1));
            } else {
              openFile(path);
            }
          }}
        >
          <PageOpenContext
            value={(url, options) => {
              if (options?.newTab) {
                appWindow.openPage(url, options);
              } else {
                openPage(url);
              }
            }}
          >
            <FileDropRegion className="flex h-full min-h-0 flex-col">
              <div className="flex h-12 shrink-0 items-center gap-1.5 px-3 select-none">
                <span className="inline-flex h-7 shrink-0 items-center px-1.5 text-[13px] font-medium">
                  New chat
                </span>
                <TopicSlot
                  onClear={() => {
                    onChange((current) => {
                      const { topicId: _dropped, ...rest } = current;
                      return { ...rest, topicSource: "chosen" };
                    });
                  }}
                  onNew={onNewTopic}
                  onPick={(picked) => {
                    onChange((current) => ({
                      ...current,
                      topicId: picked.id,
                      topicSource: "chosen",
                    }));
                  }}
                  suggested={draft.topicSource === "suggested"}
                  topic={topic}
                  topics={liveTopics}
                />
                {/* The composer's own row, drawn here by the box below. */}
                {/* Kept whole at the head's end: on a crowded head the
                    sentence's names give way before the model's. */}
                <div
                  className="ml-auto flex shrink-0 items-center pl-2"
                  ref={setHeadSlot}
                />
                <div className="ml-1 flex shrink-0 items-center gap-0.5 border-l border-border pl-2">
                  {words.trim() !== "" && (
                    <WindowButton label="Discard draft" onClick={onDiscard}>
                      <TrashIcon className="size-4" />
                    </WindowButton>
                  )}
                  <WindowButton
                    label="Minimize"
                    onClick={() => {
                      onPlacementChange("bar");
                    }}
                  >
                    <MinusIcon className="size-4" />
                  </WindowButton>
                  <WindowButton
                    label={isExpanded ? "Shrink" : "Expand"}
                    onClick={() => {
                      onPlacementChange(isExpanded ? "docked" : "expanded");
                    }}
                  >
                    {isExpanded ? (
                      <ArrowsInSimpleIcon className="size-4" />
                    ) : (
                      <ArrowsOutSimpleIcon className="size-4" />
                    )}
                  </WindowButton>
                  <WindowButton
                    label="Close"
                    onClick={() => {
                      onClose(words);
                    }}
                  >
                    <XIcon className="size-4" />
                  </WindowButton>
                </div>
              </div>
              {/* The words give way to the band: the band keeps a floor,
                  and the words scroll past what is left. The editor keeps
                  three lines of its own whatever is attached over it, so a
                  chip or a row of pasted files takes its room from the band,
                  not the words. */}
              <div
                className={cn(
                  "flex min-h-24 shrink flex-col select-text [&_.prompt-editor]:min-h-18 [&_.prompt-editor]:text-[15px] [&_.prompt-editor]:leading-6",
                  wordsFill && "flex-1",
                )}
              >
                <PromptInput
                  actionsInto={headSlot}
                  // The band's rows are the ways in; a plus beside them
                  // would be a second door to the same rooms.
                  addMenu={false}
                  attachmentsLead={
                    marked.length > 0 ? <AskPills asks={marked} /> : undefined
                  }
                  autoFocus
                  // Over the tiles alone the words take all the room the
                  // window has, and scroll only past that.
                  autoResizeMaxHeight={wordsFill ? null : WORDS_MAX_HEIGHT}
                  className="min-h-0 flex-1"
                  draftKey={key}
                  hasAttachmentsLead={marked.length > 0}
                  onItemsChange={keepItems}
                  // The window becomes the chat's at the press, so the
                  // box is never left waiting on a send.
                  isLoading={false}
                  lead={
                    chosen.length > 0 || showsIncluded || showsBehind ? (
                      <>
                        {chosen.map((item) => (
                          <ChosenChip
                            item={item}
                            key={item.path}
                            onLeaveOut={() => {
                              onChange((current) => {
                                const { chosen: kept = [], ...rest } = current;
                                const left = kept.filter(
                                  (entry) => entry.path !== item.path,
                                );
                                return left.length > 0
                                  ? { ...rest, chosen: left }
                                  : rest;
                              });
                            }}
                          />
                        ))}
                        {showsIncluded && (
                          <IncludedChip
                            appsBySlug={appsBySlug}
                            items={includedItems}
                            onLeaveOut={() => {
                              onChange((current) => {
                                const { included: _left, ...rest } = current;
                                return rest;
                              });
                            }}
                            tab={included}
                          />
                        )}
                        {showsBehind && (
                          <IncludedChip
                            appsBySlug={appsBySlug}
                            items={behindItems}
                            onLeaveOut={() => {
                              onChange((current) => ({
                                ...current,
                                leftBehind: [
                                  ...(current.leftBehind ?? []),
                                  behind.id,
                                ],
                              }));
                            }}
                            tab={behind}
                          />
                        )}
                      </>
                    ) : undefined
                  }
                  modelURI={modelURI}
                  onModelChange={onModelChange}
                  onSubmit={(send) => {
                    onStart({ ...send, attached });
                  }}
                  placeholder="What do you need?"
                  ref={inputRef}
                  variant="bare"
                />
              </div>
              {/* The band: the draft's own pane, on a gray floor with nothing
                  between it and the words but the color. */}
              <div
                className={cn(
                  "mx-2 flex flex-col overflow-hidden rounded-t-xl bg-gray-200 dark:bg-gray-900",
                  wordsFill ? "shrink-0" : "min-h-80 flex-1",
                )}
              >
                {showsStrip && (
                  // The tab on screen in the card's color, so it reads as
                  // the top of the card under it rather than as the floor. In
                  // dark the floor is the page's own color, so the tab is
                  // lifted to the card's.
                  <div className="flex h-9 shrink-0 items-center pr-1 pl-1 [--topic-tint-raised:var(--card)] dark:[--background:var(--card)]">
                    <WindowTabStrip
                      chatTitles={NO_TITLES}
                      childTitles={NO_TITLES}
                      groupKey={group}
                      onClose={closeTab}
                      onNew={() => {
                        windowTabs.openScreen(NEW_TAB_HREF, {
                          group,
                          select: true,
                        });
                      }}
                      onReorder={(keys) => {
                        windowTabs.reorder(keys, group);
                      }}
                      onSelect={(id) => {
                        windowTabs.select(id);
                      }}
                      selectedId={up?.id}
                      tabs={tabs}
                    />
                  </div>
                )}
                <div className="min-h-0 flex-1">
                  <LinkSurface>{content}</LinkSurface>
                </div>
              </div>
            </FileDropRegion>
          </PageOpenContext>
        </FileOpenContext>
      </WindowContext>
    </motion.div>
  );
}

/** One of a window's own buttons: discard, minimize, expand, close. */
export function WindowButton({
  children,
  label,
  onClick,
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <ToolbarTooltip label={label}>
      <Button
        aria-label={label}
        className="size-7 text-muted-foreground hover:text-foreground"
        onClick={onClick}
        size="icon-sm"
        variant="ghost"
      >
        {children}
      </Button>
    </ToolbarTooltip>
  );
}

/**
 * The address of the computer screen standing in a folder, as the computer
 * route reads it, for a tab whose folder browser has walked somewhere.
 */

/**
 * The topic the chat will be filed under, after what the draft is, joined by
 * "in": the pill the chat will wear, which opens the topic picker, with a way
 * to take it off, or a dashed slot that opens the same picker when none is
 * picked yet. A topic Instrument filed on its own explains itself on hover.
 */
function TopicSlot({
  onClear,
  onNew,
  onPick,
  suggested,
  topic,
  topics,
}: {
  onClear: () => void;
  /** Makes a topic, named for what was typed in the picker, and files the draft under it. */
  onNew: (name: string) => void;
  onPick: (topic: Topic) => void;
  suggested: boolean;
  topic: Topic | undefined;
  topics: Topic[];
}) {
  const picker = (trigger: ReactNode) => (
    <TopicPicker
      chosen={new Set(topic ? [topic.id] : [])}
      onNew={onNew}
      onToggle={(id) => {
        const picked = topics.find((entry) => entry.id === id);
        if (id === topic?.id || !picked) {
          onClear();
        } else {
          onPick(picked);
        }
      }}
      single
      topics={topics}
    >
      {trigger}
    </TopicPicker>
  );
  if (!topic) {
    return picker(<AddTopicChip />);
  }
  // One pill in the topic's tint holding two controls: its name, which
  // opens the picker, and the × at its end that takes the topic off. It
  // gives up width to the head, truncating the name, when room runs out.
  const pill = (
    <span
      className="inline-flex h-5 min-w-0 items-center rounded-full bg-(--topic-tint-surface) text-[11px] leading-4 text-foreground/90 topic-tint"
      style={topicTint(topicColor(topic))}
    >
      {picker(
        <button
          className="flex h-full min-w-0 items-center gap-1 rounded-l-full pr-0.5 pl-1 hover:bg-(--topic-tint-edge)"
          type="button"
        >
          {topic.emoji ? (
            <span className="text-[10px]">{topic.emoji}</span>
          ) : (
            <TopicMark className="size-3.5 text-[10px]" topic={topic} />
          )}
          <span className="max-w-28 truncate">{topic.name}</span>
        </button>,
      )}
      <button
        aria-label={`Don't file under ${topic.name}`}
        className="grid h-full w-5 shrink-0 place-items-center rounded-r-full text-foreground/60 hover:bg-(--topic-tint-edge) hover:text-foreground"
        onClick={onClear}
        title={`Don't file under ${topic.name}`}
        type="button"
      >
        <XIcon className="size-2.5" weight="bold" />
      </button>
    </span>
  );
  return (
    <span className="flex min-w-0 animate-in items-center gap-1 duration-300 fade-in-0">
      <span className="shrink-0 text-[13px] text-muted-foreground">in</span>
      {suggested ? (
        // A topic that arrived on its own says where it came from.
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="flex min-w-0">{pill}</span>
          </TooltipTrigger>
          <TooltipContent className="max-w-64" side="bottom">
            <p className="font-medium">Instrument picked this topic</p>
            <p className="opacity-80">
              {`What you wrote fits “${topic.name}”.`}
            </p>
          </TooltipContent>
        </Tooltip>
      ) : (
        pill
      )}
    </span>
  );
}
