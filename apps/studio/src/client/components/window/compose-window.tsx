import { promptDraftAtom } from "@/client/atoms/prompt-value";
import {
  APPS_HREF,
  BROWSER_HREF,
  type ChosenItem,
  type ComposePlacement,
  type Draft,
  draftGroupOf,
  draftSnapshotsAtom,
  findersByTabAtom,
  NEW_TAB_HREF,
  paneOpenByGroupAtom,
  type ScreenView,
  type WindowTab,
} from "@/client/atoms/window";
import {
  FileSystemFolderGlyph,
  FileTypeIcon,
} from "@/client/components/extend/file-system";
import { FileDropRegion } from "@/client/components/file-drop-region";
import { FileOpenContext } from "@/client/components/file-open-context";
import { PageOpenContext } from "@/client/components/page-open-context";
import {
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
import { useBrowserTargets } from "@/client/hooks/use-browser-targets";
import { getWebviewElement, onPageThumb } from "@/client/lib/browser-pool";
import { fileUrlOf, hostPathOfFileUrl } from "@/client/lib/file-url";
import { getFileType } from "@/client/lib/get-file-type";
import { cn } from "@/client/lib/utils";
import { fileHref, folderHref } from "@/shared/computer-href";
import { type AIGatewayModelURI } from "@instrument-org/ai-gateway/client";
import {
  type BrowserTargetId,
  encodeBrowserTargetId,
  type FileUpload,
  StoreId,
} from "@instrument-org/workspace/client";
import { ArrowsInSimpleIcon } from "@phosphor-icons/react/ArrowsInSimple";
import { ArrowsOutSimpleIcon } from "@phosphor-icons/react/ArrowsOutSimple";
import { CaretDownIcon } from "@phosphor-icons/react/CaretDown";
import { FeatherIcon } from "@phosphor-icons/react/Feather";
import { MinusIcon } from "@phosphor-icons/react/Minus";
import { XIcon } from "@phosphor-icons/react/X";
import { useRouterState } from "@tanstack/react-router";
import { useAtomValue, useSetAtom } from "jotai";
import { useHydrateAtoms } from "jotai/utils";
import { motion } from "motion/react";
import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { AppFront } from "./app-front";
import { appTabsAtom, hrefOfAppTab } from "./app-tabs";
import { useAppsBySlug } from "./apps-by-slug";
import { AppsHome } from "./apps-home";
import { AskPills } from "./ask-pills";
import {
  type BrowserTabsHandle,
  type PageChromeSlots,
  TabIcon,
} from "./browser-tabs";
import { ChatTasksScreen, TaskScreen } from "./chat-tasks-view";
import { draftTitle, type Topic } from "./chats";
import {
  COMPOSE_BAR_WIDTH,
  COMPOSE_MOTION,
  COMPOSE_WIDTH,
  GROWN,
} from "./compose-layout";
import { ComposeZeroState, WebStart } from "./compose-zero-state";
import { useComputerVolumes } from "./computer-volumes";
import { useWindow, WindowContext } from "./context";
import {
  behindTabOf,
  includedItemsOf,
  includedTabOf,
  isGroupShown,
  tabInView,
} from "./draft-context";
import { computerTabOf, pageTabTitle } from "./file-tabs";
import { FilesScreen } from "./files-screen";
import { segmentsOf } from "./host-path";
import { IdeaSketch } from "./idea-sketch";
import { type Idea } from "./ideas";
import { LinkSurface } from "./link-surface";
import { OutputPicker } from "./output-picker";
import { screenLocation, screenPresentation } from "./screen-presentation";
import { ScreenTabContext } from "./screen-tab";
import { useComposerAsks, useStagedAskActions } from "./staged-asks";
import { type TabLocation, tasksOfHref } from "./tab-location";
import { TabLocationRow } from "./tab-location-row";
import { useTaskTitles } from "./task-titles";
import { topicColor } from "./topic-colors";
import { TopicMark } from "./topic-mark";
import { AddTopicChip, TopicPicker } from "./topic-picker";
import { topicTint } from "./topic-tint";
import { useDraftTopicSuggestion } from "./use-draft-topic-suggestion";
import { useIdeas } from "./use-ideas";
import { WindowTabStrip } from "./window-tab-strip";
import {
  atOf,
  isHomeTab,
  parseHref,
  trailOf,
  useWindowTabs,
} from "./window-tabs";

/** What the composer hands over to start the chat. */
export interface DraftSend {
  files?: FileUpload.Input[];
  folders?: { path: string }[];
  modelURI: AIGatewayModelURI.Type;
  /** The kind of page the response should come back as, when one was picked. */
  output?: { name: string; title: string };
  prompt: string;
}

/** Whether an address is Apps or one app's front, which a draft's band shows itself. */
function isAppsHref(pathname: string) {
  return pathname === APPS_HREF || pathname.startsWith(`${APPS_HREF}/`);
}

/** How many marks the minimized bar shows of what the draft holds. */
const BAR_MARKS = 4;

/** How long the words are left alone before the record is written. */
const WORDS_SETTLE_MS = 300;

/** The most the words take before they scroll, whatever the window could give them. */
const WORDS_MAX_HEIGHT = 400;

/** A docked window's height with a few lines of words in it, in layout px; it grows from here with the words. */
const COMPOSE_HEIGHT = 640;

/** The words' height the docked height already allows for: three lines. Past it the window grows. */
const WORDS_BASE_HEIGHT = 72;

const NO_TITLES = new Map<never, never>();

/** What a chip of the draft's is, as its tooltip says it. */
const SENT_WITH_MESSAGE = "Instrument sees this with your message.";

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
      className="pointer-events-auto absolute bottom-[calc(1px/var(--app-zoom))] z-40 flex h-9 items-center overflow-hidden rounded-t-lg bg-gray-900 text-[12px] font-medium text-white shadow-xl-soft [clip-path:inset(-4rem_-4rem_0_-4rem)] dark:bg-gray-800 dark:ring-1 dark:ring-white/10"
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
        <FeatherIcon className="size-3.5 shrink-0" />
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
 * menu, the output picker, the model, the arrow) and the window's own three
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
  const up = windowTabs.tabUpIn(group);
  const isExpanded = placement === "expanded";
  // What the window has in view, and the thing the draft was opened over,
  // while it is still there to point at, wherever its tab stands now.
  const appTabs = useAtomValue(appTabsAtom);
  const activeHref = useRouterState({
    select: (routerState) => routerState.location.href,
  });
  const paneOpenByGroup = useAtomValue(paneOpenByGroupAtom);
  const inView =
    appTabs.selectedId === null
      ? undefined
      : tabInView({
          activeHref,
          appTabId: appTabs.selectedId,
          groupTab: windowTabs.active,
          isGroupTabShown: isGroupShown(windowTabs.group, paneOpenByGroup),
        });
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

  // The words the box opens with: what was kept of it when it was put away,
  // or, after a relaunch, the record's own words. Seeded once, since the
  // box's draft is dropped with it and made afresh each time it mounts.
  const key = { id: draft.id, scope: "transient" as const };
  const snapshots = useAtomValue(draftSnapshotsAtom);
  const setSnapshots = useSetAtom(draftSnapshotsAtom);
  const snapshot = snapshots[draft.id];
  useHydrateAtoms([[promptDraftAtom(key), snapshot ? "" : draft.words]]);
  const words = useAtomValue(promptDraftAtom(key));
  // A box seeded empty, with what was kept still to be put back into it, is
  // not the user clearing the words: the first reading is let go.
  const isRestoringRef = useRef(snapshot !== undefined);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });
  // The record follows the box a beat behind it rather than on every key:
  // writing the record lays the whole window out again, transcripts and all,
  // and that on each keystroke is felt in the keys. What the record is for
  // (the Drafts list's title, the bar's, the words kept past a launch) can
  // wait a beat; the close and the start read the box itself.
  useEffect(() => {
    if (isRestoringRef.current) {
      isRestoringRef.current = false;
      return;
    }
    if (words === draft.words) {
      return;
    }
    const timer = setTimeout(() => {
      onChangeRef.current((current) => ({ ...current, words }));
    }, WORDS_SETTLE_MS);
    return () => {
      clearTimeout(timer);
    };
    // The record follows the box; the box never follows the record.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [words]);
  // On the way out the record catches up at once, so a draft put down or
  // closed mid-word keeps the word.
  const wordsRef = useRef(words);
  wordsRef.current = words;
  useEffect(
    () => () => {
      const latest = wordsRef.current;
      onChangeRef.current((current) =>
        current.words === latest ? current : { ...current, words: latest },
      );
    },
    [],
  );

  const inputRef = useRef<PromptInputRef>(null);
  // Layout rather than passive effects: on the way in the box's handle is
  // set by then and on the way out it is still there, which a passive
  // cleanup would find already gone.
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (snapshot) {
      input?.restore(snapshot);
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

  const ideas = useIdeas();
  const output = ideas.data?.find((idea) => idea.name === draft.output);
  const topic = topics.find((entry) => entry.id === draft.topicId);
  // Retired topics stay nameable on a draft already filed under one, but are
  // never offered or picked again.
  const liveTopics = topics.filter((entry) => !entry.retired);
  useDraftTopicSuggestion({ draft, onChange, topics: liveTopics, words });

  // The head's slot the composer's button row is drawn into. State rather
  // than a ref: the row is a portal, which needs the element to exist.
  const [headSlot, setHeadSlot] = useState<HTMLDivElement | null>(null);
  // How tall the words are on their own, which is what a docked window grows
  // with: measured off the editor, whose own box is never clipped (its
  // scroller is around it), so a squeezed window still knows what the words
  // would take. A definite height on the window is also what lets the page
  // and the folder inside the band size themselves against it.
  const wordsWrapRef = useRef<HTMLDivElement>(null);
  const [wordsHeight, setWordsHeight] = useState(WORDS_BASE_HEIGHT);
  useEffect(() => {
    const editor =
      wordsWrapRef.current?.querySelector<HTMLElement>(".prompt-editor");
    if (!editor) {
      return;
    }
    const measure = () => {
      setWordsHeight(editor.offsetHeight);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(editor);
    return () => {
      observer.disconnect();
    };
  }, []);
  const dockedHeight =
    COMPOSE_HEIGHT + Math.max(0, wordsHeight - WORDS_BASE_HEIGHT);

  // What the band opens lands in the draft's group and comes up in the band,
  // never on screen behind the window; the caret goes back to the words,
  // which are what the window is for.
  const openPage = (url: string) => {
    const id = browser?.openOrFocus(url, { group });
    if (id !== undefined) {
      windowTabs.selectIn(group, id);
    }
    inputRef.current?.focus();
  };
  // A screen asked for is a new tab each time, even of a kind the draft
  // already has open; a file already open is brought up instead.
  // Into the draft's new tab while that is what it has up, rather than a
  // tab beside it.
  const openScreenIn = (href: string) => {
    windowTabs.openOrFocusScreen(href, {
      activate: true,
      group,
      isOpened: true,
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
        activate: true,
        group,
        isOpened: true,
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
  // Closing a tab in the band moves to the one before it, the way the strip
  // on screen does; the tab model only does that for the group on screen.
  const closeTab = (id: string) => {
    const index = tabs.findIndex((tab) => tab.id === id);
    const neighbor = tabs[index - 1] ?? tabs[index + 1];
    windowTabs.close(id);
    if (neighbor && up?.id === id) {
      windowTabs.selectIn(group, neighbor.id);
    }
  };

  // What the band has up, for the chat the draft starts: a folder or file
  // is said by the screen drawing it, since only that screen knows where the
  // browser has walked to.
  const [filesView, setFilesView] = useState<null | ScreenView>(null);
  const onViewChangeRef = useRef(onViewChange);
  useEffect(() => {
    onViewChangeRef.current = onViewChange;
  });
  const upKind =
    up === undefined || (up.kind === "screen" && isHomeTab(up))
      ? "home"
      : up.kind === "page"
        ? "page"
        : computerTabOf(up.href)
          ? "computer"
          : "other";
  useEffect(() => {
    onViewChangeRef.current(
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
      onViewChangeRef.current(null);
    },
    [],
  );
  // The element the page is drawn into, held as state so the ref React
  // calls is one stable setter: a callback made afresh each render is
  // called with null and then the element on every render, and reporting
  // each of those up re-renders the layout, which renders this again.
  const [pageHost, setPageHost] = useState<HTMLDivElement | null>(null);
  const onPageHostRef = useRef(onPageHost);
  useEffect(() => {
    onPageHostRef.current = onPageHost;
  });
  useEffect(() => {
    onPageHostRef.current(pageHost);
  }, [pageHost]);
  useEffect(
    () => () => {
      onPageHostRef.current(null);
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
              activate: true,
              group,
              isOpened: true,
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
        onScreenView={setFilesView}
        outside={{
          label: "Open beside the chat",
          note: "Opens beside the chat, not in a draft.",
          onOpen: (tab) => {
            openOutside(tab.href);
            closeTab(tab.id);
          },
        }}
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
      style={isExpanded ? GROWN : { height: dockedHeight, width }}
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
                <FeatherIcon className="size-4 shrink-0 text-muted-foreground" />
                <OutputHead
                  onChange={(name) => {
                    onChange((current) => {
                      const { output: _dropped, ...rest } = current;
                      return name === undefined
                        ? rest
                        : { ...rest, output: name };
                    });
                  }}
                  output={output}
                />
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
              {/* The words give way to the band only once the window can
                  grow no further: the band keeps a floor, and the words
                  scroll past what is left. The editor keeps three lines of
                  its own whatever is attached over it, so a chip or a row of
                  pasted files takes its room from the band, not the words. */}
              <div
                className={cn(
                  "flex min-h-24 shrink flex-col select-text [&_.prompt-editor]:min-h-18 [&_.prompt-editor]:text-[15px] [&_.prompt-editor]:leading-6",
                  isEmpty && !showsStrip && "flex-1",
                )}
                ref={wordsWrapRef}
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
                  autoResizeMaxHeight={WORDS_MAX_HEIGHT}
                  className="min-h-0 flex-1"
                  draftKey={key}
                  hasAttachmentsLead={marked.length > 0}
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
                    onStart({
                      ...send,
                      ...(output
                        ? {
                            output: {
                              name: output.name,
                              title: output.title,
                            },
                          }
                        : {}),
                    });
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
                  isEmpty && !showsStrip ? "shrink-0" : "min-h-80 flex-1",
                )}
              >
                {showsStrip && (
                  // The tab on screen in the card's color, so it reads as
                  // the top of the card under it rather than as the floor.
                  <div className="flex h-9 shrink-0 items-center pr-1 pl-1 [--topic-tint-raised:var(--card)]">
                    <WindowTabStrip
                      chatTitles={NO_TITLES}
                      childTitles={NO_TITLES}
                      groupKey={group}
                      onClose={closeTab}
                      onNew={() => {
                        windowTabs.openScreen(NEW_TAB_HREF, {
                          activate: true,
                          group,
                        });
                      }}
                      onReorder={(keys) => {
                        windowTabs.reorder(keys, group);
                      }}
                      onSelect={(id) => {
                        windowTabs.selectIn(group, id);
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

/**
 * The thing a floating window's group has up, drawn large in the window: a
 * page by the browser (drawn into the host this reports), the computer by
 * its Finder, a file in place of the Finder that opened it, and Apps by its
 * landing page and each app's own. Anything else is the window's to say it
 * cannot draw, with the way to where it can be.
 */
export function GroupItem({
  before,
  closeTab,
  group,
  isFramed = true,
  onClose,
  onPageChrome,
  onPageHost,
  onScreenView,
  outside,
  up,
}: {
  /** Where back goes from the start of the tab: the window's own tab history, for a site standing at the window's level. */
  before?: { back: () => void; canGoBack: boolean };
  closeTab: (id: string) => void;
  group: string;
  /** Whether it stands on a card inset in its band, as in a draft; a grown popped-out chat draws it edge to edge, as the pane beside a chat does. */
  isFramed?: boolean;
  /** Puts the view away, from Hide at the end of its address row, for a surface that shows it beside a chat. */
  onClose?: () => void;
  /** Where the address row takes the page's reload and controls while a page is up; nothing otherwise. */
  onPageChrome: (slots: PageChromeSlots | undefined) => void;
  /** The element the page is drawn into, while a page is up. */
  onPageHost: (element: HTMLDivElement | null) => void;
  /** What a screen it draws has up (the Finder, a chat's tasks), in the terms the conversation is told it. */
  onScreenView?: (view: null | ScreenView) => void;
  /** A screen the window cannot draw: what to say, and the way to where it can be. */
  outside: {
    label: string;
    note: string;
    onOpen: (tab: Extract<WindowTab, { kind: "screen" }>) => void;
  };
  up: WindowTab;
}) {
  const windowTabs = useWindowTabs();
  const appsBySlug = useAppsBySlug();
  const appWindow = useWindow();
  const { browser, taskId } = appWindow;
  // A file screen's own controls go into the row as well: the tree's toggle
  // at its head, the viewer's actions at its end.
  const [screenLead, setScreenLead] = useState<HTMLDivElement | null>(null);
  const [screenTail, setScreenTail] = useState<HTMLDivElement | null>(null);
  const Frame = isFramed ? Card : Bare;
  const taskTitles = useTaskTitles();
  const [filesView, setFilesView] = useState<null | ScreenView>(null);

  // The page's reload and controls go into the address row, the way they do
  // in the pane beside a chat, rather than into a bar of the page's own.
  const [reloadSlot, setReloadSlot] = useState<HTMLDivElement | null>(null);
  const [controlsSlot, setControlsSlot] = useState<HTMLDivElement | null>(null);
  const onPageChromeRef = useRef(onPageChrome);
  useEffect(() => {
    onPageChromeRef.current = onPageChrome;
  });
  const isPage = up.kind === "page";
  useEffect(() => {
    onPageChromeRef.current(
      isPage ? { into: controlsSlot, reloadInto: reloadSlot } : undefined,
    );
  }, [isPage, controlsSlot, reloadSlot]);
  useEffect(
    () => () => {
      onPageChromeRef.current(undefined);
    },
    [],
  );
  const targetId =
    up.kind === "page"
      ? encodeBrowserTargetId(
          up.taskId ?? taskId,
          StoreId.SessionSchema.parse(up.id),
        )
      : undefined;
  const guest = useGuestSteps(targetId);
  // Back walks what is up (the page's own history, the screen's trail),
  // then what the tab showed before it, then, for a tab that is a site of
  // the window's own, where the window's tab was before the site. The row's
  // arrows and the mouse's thumb buttons over the page both take these.
  const webview = targetId ? getWebviewElement(targetId) : null;
  const at = atOf(up);
  const withinBack = up.kind === "page" ? guest.back : at > 0;
  const withinForward =
    up.kind === "page" ? guest.forward : at < trailOf(up).length - 1;
  // A site of the window's own has nothing of its own before its page.
  const hasPast = !before && Boolean(up.past?.length);
  const hasFuture = Boolean(up.future?.length);
  const goBack = () => {
    if (withinBack) {
      if (up.kind === "page") {
        webview?.goBack();
      } else {
        windowTabs.stepTab(up.id, -1);
      }
    } else if (hasPast) {
      windowTabs.stepVisitOf(up.id, -1);
    } else {
      before?.back();
    }
  };
  const goForward = () => {
    if (withinForward) {
      if (up.kind === "page") {
        webview?.goForward();
      } else {
        windowTabs.stepTab(up.id, 1);
      }
    } else if (hasFuture) {
      windowTabs.stepVisitOf(up.id, 1);
    }
  };
  const stepsNow = useRef({ goBack, goForward });
  useEffect(() => {
    stepsNow.current = { goBack, goForward };
  });
  useEffect(() => {
    if (targetId === undefined) {
      return;
    }
    return onPageThumb(targetId, (direction) => {
      if (direction === "back") {
        stepsNow.current.goBack();
      } else {
        stepsNow.current.goForward();
      }
    });
  }, [targetId]);

  /**
   * The row over what is up, the one the pane beside a chat draws: its
   * arrows walk the page's own history or the screen's trail, and its field
   * sends a page somewhere else, or takes a screen's tab to a site.
   */
  const row = (location: TabLocation, { isFileScreen = false } = {}) => {
    return (
      <TabLocationRow
        canGoBack={withinBack || hasPast || Boolean(before?.canGoBack)}
        canGoForward={withinForward || hasFuture}
        location={location}
        {...(onClose ? { onClose } : {})}
        onBack={goBack}
        onForward={goForward}
        onSite={(url) => {
          if (up.kind === "page" && webview) {
            void webview.loadURL(url);
          } else {
            browser?.open(url, { group, replacing: up });
          }
        }}
        onVisit={(href) => {
          windowTabs.visitHref(up.id, href);
        }}
        {...(up.kind === "page"
          ? {
              reload: (
                <div
                  className="flex shrink-0 items-center empty:hidden"
                  ref={setReloadSlot}
                />
              ),
              trailing: (
                <div
                  className="flex shrink-0 items-center gap-0.5"
                  ref={setControlsSlot}
                />
              ),
            }
          : isFileScreen
            ? {
                leading: (
                  <div
                    className="flex shrink-0 items-center empty:hidden"
                    ref={setScreenLead}
                  />
                ),
                trailing: (
                  <div
                    className="flex shrink-0 items-center gap-0.5"
                    ref={setScreenTail}
                  />
                ),
              }
            : {})}
      />
    );
  };

  if (up.kind === "page") {
    const filePath = hostPathOfFileUrl(up.url);
    return (
      <Frame
        head={row(
          filePath === undefined
            ? { kind: "page", url: up.url ?? "" }
            : {
                asPage: true,
                kind: "file",
                name: segmentsOf(filePath).at(-1) ?? filePath,
                path: filePath,
              },
        )}
      >
        <div className="h-full" ref={onPageHost} />
      </Frame>
    );
  }
  const screenRow = row(screenLocation(up.href, { appsBySlug, taskTitles }));
  const computer = computerTabOf(up.href);
  if (computer) {
    const search = parseHref(up.href).search;
    const tree = search.get("tree") ?? undefined;
    // The folder says where it stands, as the pane beside a chat reads it.
    const location = screenLocation(up.href, { appsBySlug });
    const shown =
      location.kind === "folder" && filesView?.folder
        ? { ...location, path: filesView.folder.display }
        : location;
    return (
      <Frame head={row(shown, { isFileScreen: true })}>
        {/* The Finder and the file viewer the pane beside a chat draws,
            moving this tab rather than following the window's router. */}
        <ScreenTabContext
          value={{
            id: up.id,
            // Leaving a file opened from the Finder steps the tab back to its
            // folder; a tab that opened on the file has nowhere to go back to.
            leave: () => {
              if (windowTabs.stepTab(up.id, -1) === undefined) {
                closeTab(up.id);
              }
            },
            report: (view) => {
              setFilesView(view);
              onScreenView?.(view);
            },
            visit: (href) => {
              windowTabs.visitHref(up.id, href);
            },
          }}
        >
          <WindowContext
            value={{
              ...appWindow,
              rowLead: screenLead,
              rowTail: screenTail,
            }}
          >
            <FilesScreen
              file={computer.file}
              key={up.id}
              path={computer.path}
              root={computer.root}
              select={search.get("select") ?? undefined}
              source={search.get("source") === "true"}
              tree={tree}
            />
          </WindowContext>
        </ScreenTabContext>
      </Frame>
    );
  }
  const tasks = tasksOfHref(up.href);
  if (tasks) {
    return (
      // A chat's tasks and each task's page, as the pane beside a chat draws
      // them, moving this tab rather than following the window's router: a
      // row pressed or the row's Tasks crumb walks the tab in place.
      <WindowContext
        value={{
          ...appWindow,
          openScreen: (href, options) => {
            if (tasksOfHref(href) && !options?.newTab) {
              windowTabs.visitHref(up.id, href);
              return;
            }
            appWindow.openScreen(href, options);
          },
        }}
      >
        <Frame head={screenRow}>
          <ScreenTabContext
            value={{
              id: up.id,
              leave: () => {
                if (windowTabs.stepTab(up.id, -1) === undefined) {
                  closeTab(up.id);
                }
              },
              report: (view) => {
                onScreenView?.(view);
              },
              visit: (href) => {
                windowTabs.visitHref(up.id, href);
              },
            }}
          >
            {tasks.task === undefined ? (
              <ChatTasksScreen chat={tasks.chat} />
            ) : (
              <TaskScreen key={tasks.task} taskId={tasks.task} />
            )}
          </ScreenTabContext>
        </Frame>
      </WindowContext>
    );
  }
  const { pathname } = parseHref(up.href);
  if (pathname === BROWSER_HREF) {
    return (
      <Frame head={screenRow}>
        <WebStart
          onOpenPage={(url) => {
            browser?.open(url, { group, replacing: up });
          }}
        />
      </Frame>
    );
  }
  if (pathname === APPS_HREF) {
    return (
      <Frame head={screenRow}>
        <AppsHome
          onOpenApp={(slug) => {
            windowTabs.visitHref(up.id, `${APPS_HREF}/${slug}`);
          }}
          showsConnect={false}
        />
      </Frame>
    );
  }
  if (pathname.startsWith(`${APPS_HREF}/`)) {
    return (
      <Frame head={screenRow}>
        <AppFront
          onToApps={() => {
            if (windowTabs.stepTab(up.id, -1) === undefined) {
              windowTabs.visitHref(up.id, APPS_HREF);
            }
          }}
          reportsScreen={false}
          slug={pathname.slice(APPS_HREF.length + 1)}
        />
      </Frame>
    );
  }
  const { icon, title } = screenPresentation(up.href, { appsBySlug });
  return (
    <Frame>
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
        <span className="flex items-center gap-2 text-foreground">
          <span className="[&_svg]:size-4">{icon}</span>
          {title}
        </span>
        <p>{outside.note}</p>
        <Button
          onClick={() => {
            outside.onOpen(up);
          }}
          size="sm"
          variant="outline"
        >
          {outside.label}
        </Button>
      </div>
    </Frame>
  );
}

/**
 * The chip at the head of the words naming what the screen already gives
 * the draft: the thing it was opened over, in the row an attached file lands
 * in, since it goes with the words as a file does. One quiet line, its mark
 * and name in grey with an x that leaves it out, so it takes no room from
 * the words and does not ask to be read; what it is for is in its tooltip.
 * Nothing of the thing itself is drawn in the draft, which stands over it.
 */
export function IncludedChip({
  appsBySlug,
  items,
  onLeaveOut,
  said = SENT_WITH_MESSAGE,
  tab,
}: {
  appsBySlug: Map<string, { name: string; site: string | undefined }>;
  /** What the thing points at on this computer, which the chip names in place of the tab. */
  items: ChosenItem[] | undefined;
  onLeaveOut: () => void;
  /** What the chip's tooltip says it is. */
  said?: string;
  tab: WindowTab;
}) {
  const volumes = useComputerVolumes();
  const [one] = items ?? [];
  const name =
    items !== undefined && items.length > 1
      ? `${items.length} items`
      : one === undefined
        ? tab.kind === "page"
          ? pageTabTitle(tab) || "Page"
          : screenPresentation(tab.href, {
              appsBySlug,
              ...(volumes ? { volumes } : {}),
            }).title
        : nameOfPath(one.path);
  return (
    <ContextChip
      label={
        <ChipLabel paths={(items ?? []).map((item) => item.path)} said={said} />
      }
      mark={
        items?.length === 1 && one !== undefined ? (
          <ItemMark item={one} />
        ) : (
          <HeldMark appsBySlug={appsBySlug} tab={tab} />
        )
      }
      name={name}
      onLeaveOut={onLeaveOut}
      slot="included-chip"
    />
  );
}

/** One of a window's own buttons: minimize, expand, close. */
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

/** What a card holds, edge to edge with nothing around it: the pane's own look. */
function Bare({ children, head }: { children: ReactNode; head?: ReactNode }) {
  return (
    <div className="flex h-full flex-col bg-background">
      {head}
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

/** The band's white card, for a thing drawn large in it. */
function Card({ children, head }: { children: ReactNode; head?: ReactNode }) {
  return (
    <div className="h-full px-2 pb-2">
      <div className="flex h-full flex-col overflow-hidden rounded-lg bg-card">
        {head}
        <div className="min-h-0 flex-1">{children}</div>
      </div>
    </div>
  );
}

/** A chip's tooltip: what the chip means, then where the things it names are. */
function ChipLabel({ paths, said }: { paths: string[]; said: string }) {
  return (
    <span className="flex flex-col gap-1">
      <span>{said}</span>
      {paths.map((path) => (
        <span className="break-all opacity-70" key={path}>
          {path}
        </span>
      ))}
    </span>
  );
}

/** A file or folder the draft was opened on by name, held for the chat until it is left out. */
function ChosenChip({
  item,
  onLeaveOut,
}: {
  item: ChosenItem;
  onLeaveOut: () => void;
}) {
  return (
    <ContextChip
      label={<ChipLabel paths={[item.path]} said={SENT_WITH_MESSAGE} />}
      mark={<ItemMark item={item} />}
      name={nameOfPath(item.path)}
      onLeaveOut={onLeaveOut}
      slot="chosen-chip"
    />
  );
}

/**
 * The address of the computer screen standing in a folder, as the computer
 * route reads it, for a tab whose folder browser has walked somewhere.
 */
/**
 * One quiet line at the head of the words: a mark and a name in grey with an
 * x that leaves the thing out, so it takes no room from the words and does
 * not ask to be read; what it is is in its tooltip.
 */
function ContextChip({
  label,
  mark,
  name,
  onLeaveOut,
  slot,
}: {
  label: ReactNode;
  mark: ReactNode;
  name: string;
  onLeaveOut: () => void;
  slot: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="inline-flex h-6 max-w-44 min-w-0 items-center gap-1 self-center rounded-full bg-muted/60 pr-0.5 pl-2 text-xs text-muted-foreground ring-1 ring-border/70"
          data-slot={slot}
        >
          <span className="grid size-3.5 shrink-0 place-items-center [&_img]:size-3.5 [&_svg]:size-3.5">
            {mark}
          </span>
          <span className="truncate">{name}</span>
          <button
            aria-label={`Leave out ${name}`}
            className="grid size-5 shrink-0 place-items-center rounded-full hover:bg-foreground/8 hover:text-foreground"
            onClick={onLeaveOut}
            type="button"
          >
            <XIcon className="size-3" />
          </button>
        </span>
      </TooltipTrigger>
      <TooltipContent collisionPadding={10} maxWidth="20rem">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

/** One thing the draft holds, as its mark: a page's icon, or a screen's. */
function HeldMark({
  appsBySlug,
  tab,
}: {
  appsBySlug: Map<string, { name: string; site: string | undefined }>;
  tab: WindowTab;
}) {
  if (tab.kind === "page") {
    return <TabIcon favicon={tab.favicon} url={tab.url} />;
  }
  return screenPresentation(tab.href, { appsBySlug }).icon;
}

/** A file's type icon, or the folder glyph for a folder. */
function ItemMark({ item }: { item: ChosenItem }) {
  return item.kind === "folder" ? (
    <FileSystemFolderGlyph className="h-3 w-auto" />
  ) : (
    <FileTypeIcon fileName={nameOfPath(item.path)} />
  );
}

/** The last name in a path, which is what a chip calls the thing. */
function nameOfPath(path: string) {
  return segmentsOf(path).at(-1) ?? path;
}

/**
 * What the draft is, as the head's first words: "New chat" until a page type
 * is picked, then "Make a" and that type. The words open the catalog of page
 * types, which is rare enough to live behind them rather than beside the send,
 * and whose Clear goes back to a chat.
 */
function OutputHead({
  onChange,
  output,
}: {
  onChange: (name: string | undefined) => void;
  output: Idea | undefined;
}) {
  return (
    <span className="flex min-w-0 items-center gap-0.5">
      <OutputPicker onChange={onChange} value={output?.name}>
        <button
          aria-label={output ? `Output: ${output.title}` : "Pick an output"}
          className="inline-flex h-7 min-w-0 items-center gap-1.5 rounded-md px-1.5 text-[13px] font-medium hover:bg-foreground/6 data-[state=open]:bg-foreground/6"
          type="button"
        >
          {output ? (
            <>
              <span className="shrink-0">
                {/^[aeiou]/i.test(output.title) ? "Make an" : "Make a"}
              </span>
              <IdeaSketch
                className="h-4 w-auto shrink-0 drop-shadow-xs"
                rows={output.sketch ?? []}
              />
              <span className="max-w-40 min-w-0 truncate">{output.title}</span>
            </>
          ) : (
            <span className="shrink-0">New chat</span>
          )}
          <CaretDownIcon className="size-3 shrink-0 text-muted-foreground" />
        </button>
      </OutputPicker>
    </span>
  );
}

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

/** Whether a page's guest has anywhere of its own to go back or forward to, kept as it moves. */
function useGuestSteps(targetId: BrowserTargetId | undefined) {
  const [steps, setSteps] = useState({ back: false, forward: false });
  const targets = useBrowserTargets();
  const isAttached = targetId !== undefined && targets.has(targetId);
  useEffect(() => {
    const webview = targetId ? getWebviewElement(targetId) : null;
    if (!webview) {
      return;
    }
    const read = () => {
      try {
        setSteps({
          back: webview.canGoBack(),
          forward: webview.canGoForward(),
        });
      } catch {
        // Not attached yet: its first navigation reads it again.
      }
    };
    const events = [
      "did-navigate",
      "did-navigate-in-page",
      "did-stop-loading",
    ] as const;
    for (const event of events) {
      webview.addEventListener(event, read);
    }
    read();
    return () => {
      for (const event of events) {
        webview.removeEventListener(event, read);
      }
    };
  }, [targetId, isAttached]);
  return steps;
}
