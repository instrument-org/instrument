import {
  type ChosenItem,
  type ComposePlacement,
  type Draft,
  draftGroupOf,
  draftSnapshotsAtom,
  finderOnScreenAtom,
  NEW_TAB_HREF,
  type ScreenView,
  type WindowTab,
} from "@/client/atoms/orchestrator";
import { promptDraftAtom } from "@/client/atoms/prompt-value";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import { appMentionToken } from "@/client/lib/app-mention";
import { fileUrlOf, hostPathOfFileUrl } from "@/client/lib/file-url";
import { getFileType } from "@/client/lib/get-file-type";
import { cn } from "@/client/lib/utils";
import { fileHref, folderHref } from "@/shared/computer-href";
import { type AIGatewayModelURI } from "@instrument-org/ai-gateway/client";
import {
  type FileUpload,
  type FolderAttachment,
} from "@instrument-org/workspace/client";
import { ArrowsInSimpleIcon } from "@phosphor-icons/react/ArrowsInSimple";
import { ArrowsOutSimpleIcon } from "@phosphor-icons/react/ArrowsOutSimple";
import { MinusIcon } from "@phosphor-icons/react/Minus";
import { PencilSimpleIcon } from "@phosphor-icons/react/PencilSimple";
import { PlusIcon } from "@phosphor-icons/react/Plus";
import { XIcon } from "@phosphor-icons/react/X";
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

import { useAppsBySlug } from "./apps-by-slug";
import { type BrowserTabsHandle, TabIcon } from "./browser-tabs";
import { ComposeFiles } from "./compose-files";
import {
  COMPOSE_BAR_WIDTH,
  COMPOSE_MOTION,
  COMPOSE_WIDTH,
} from "./compose-layout";
import { ComposeZeroState } from "./compose-zero-state";
import { OrchestratorContext, useOrchestrator } from "./context";
import { computerTabOf, pageTabTitle } from "./file-tabs";
import { joinHostPath, segmentsOf } from "./host-path";
import { OutputPicker } from "./output-picker";
import { screenPresentation } from "./screen-presentation";
import { TopicPill } from "./thread-row";
import { draftTitle, type Topic } from "./threads";
import { TopicMark } from "./topic-mark";
import { useIdeas } from "./use-ideas";
import { WindowTabStrip } from "./window-tab-strip";
import { isHomeTab, parseHref, useWindowTabs } from "./window-tabs";

/** What the composer hands over to start the thread. */
export interface DraftSend {
  files?: FileUpload.Input[];
  folders?: { access: FolderAttachment.Access; path: string }[];
  modelURI: AIGatewayModelURI.Type;
  /** The kind of page the response should come back as, when one was picked. */
  output?: { name: string; title: string };
  prompt: string;
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
  const { allTabs } = useWindowTabs();
  const appsBySlug = useAppsBySlug();
  const group = draftGroupOf(draft.id);
  const held = allTabs.filter((tab) => tab.group === group && !isHomeTab(tab));
  return (
    <motion.div
      animate={{ opacity: 1, right, y: 0 }}
      className="pointer-events-auto absolute bottom-0 z-40 flex h-9 items-center overflow-hidden rounded-t-lg bg-gray-900 text-[12px] font-medium text-white shadow-xl-soft dark:bg-gray-700"
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
        <PencilSimpleIcon className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">
          {draftTitle(draft.words)}
        </span>
        {held.length > 0 && (
          <span className="flex shrink-0 items-center gap-1 [&_img]:size-3.5 [&_svg]:size-3.5">
            {held.slice(0, BAR_MARKS).map((tab) => (
              <span
                className="grid size-4 place-items-center rounded-sm bg-white/90 [&_img]:rounded-xs"
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
        )}
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
 * A draft of a new thread, in a window that floats over the inbox and the
 * thread the way a mail client's compose window does: docked at the window's
 * bottom-right corner, or grown to fill the window inset from its edges, and
 * put down to a bar along the window's foot. Its head carries the draft's
 * name, the topic it will be filed under, the composer's controls (the plus
 * menu, the output picker, the model, the arrow) and the window's own three
 * buttons; under it the words on white, borderless, and under those a gray
 * band that is the draft's own pane: the four doors when nothing is gathered
 * yet, and otherwise the gathered things as tabs with the one up drawn large,
 * a page by the browser and a folder by This Mac. The draft's tabs are the
 * thread's tabs from the moment it starts; nothing is handed over.
 *
 * The words ride in the draft's record, so the Drafts list can name it and a
 * relaunch keeps them; what else the box was given (files, a folder) is kept
 * in memory while the draft is away and put back when it comes up.
 */
export function ComposeWindow({
  browser,
  draft,
  isStarting,
  modelURI,
  onChange,
  onClose,
  onModelChange,
  onOpenApps,
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
  isStarting: boolean;
  modelURI: AIGatewayModelURI.Type | undefined;
  onChange: (update: (draft: Draft) => Draft) => void;
  /** The window's close, with the words as the box has them that moment: the caller keeps or throws the draft away by them. */
  onClose: (words: string) => void;
  onModelChange: (modelURI: AIGatewayModelURI.Type) => void;
  /** Takes the window to the Apps place, for a draft with no app to name yet. */
  onOpenApps: () => void;
  /** The element the draft's page is drawn into while a page is up, null while none is. */
  onPageHost: (element: HTMLElement | null) => void;
  onPlacementChange: (placement: ComposePlacement) => void;
  onStart: (send: DraftSend) => void;
  /** What the band has up, in the terms the conversation is told it, or null for nothing it can say. */
  onViewChange: (view: null | ScreenView) => void;
  /** A screen the band cannot draw, handed to the window to open beside the thread. */
  openOutside: (href: string) => void;
  placement: Exclude<ComposePlacement, "bar">;
  /** Where a docked window stands along the foot, in layout px from the right edge; the windows beside it are placed the same way. */
  right: number;
  topics: Topic[];
  /** A docked window's width, narrower than its own on a row with less room. */
  width?: number;
}) {
  const orchestrator = useOrchestrator();
  const { taskId } = orchestrator;
  const windowTabs = useWindowTabs();
  const appsBySlug = useAppsBySlug();
  const group = draftGroupOf(draft.id);
  const tabs = windowTabs.allTabs.filter((tab) => tab.group === group);
  const up = windowTabs.tabUpIn(group);
  const isExpanded = placement === "expanded";
  // The thing the draft was opened over, while it is still there to point at.
  const included = draft.included
    ? windowTabs.allTabs.find(
        (tab) =>
          tab.id === draft.included?.tabId &&
          tab.group === draft.included.group,
      )
    : undefined;

  // What the thing the draft was opened over points at on this computer,
  // with what the draft already holds by name left out, so each is said
  // once. The Finder's own answer is only for the tab that is up.
  const finderOnScreen = useAtomValue(finderOnScreenAtom);
  const chosen = draft.chosen ?? [];
  const includedItems = included
    ? includedItemsOf(
        included,
        windowTabs.active?.id === included.id ? finderOnScreen : null,
        chosen,
      )
    : undefined;
  const showsIncluded =
    included !== undefined &&
    (includedItems === undefined || includedItems.length > 0);

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
      openScreenIn(fileHref(hostPath));
    }
  };
  const nameApp = (app: { name: string; slug: string }) => {
    inputRef.current?.insertText(appMentionToken(app));
    inputRef.current?.focus();
  };
  // A screen asked for from inside the band: an app is named in the words
  // rather than opened, the computer opens in the band, and anything else
  // (a thread, a task, a skill) has no place in a draft and opens beside the
  // thread instead.
  const openScreen = (href: string) => {
    const { pathname } = parseHref(href);
    if (pathname.startsWith("/orchestrator/apps/")) {
      const slug = pathname.slice("/orchestrator/apps/".length);
      const app = appsBySlug.get(slug);
      nameApp({ name: app?.name ?? slug, slug });
      return;
    }
    if (computerTabOf(href) || pathname === parseHref(NEW_TAB_HREF).pathname) {
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

  // What the band has up, for the thread the draft starts: a folder or file
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
  const showsStrip =
    tabs.length > 1 || (tabs[0] !== undefined && !isHomeTab(tabs[0]));

  const content = (() => {
    if (up === undefined || upKind === "home") {
      return (
        <ComposeZeroState
          onAttachFiles={() => {
            inputRef.current?.pickFiles();
          }}
          onAttachFolder={() => {
            inputRef.current?.pickFolder();
          }}
          onOpenApp={nameApp}
          onOpenApps={onOpenApps}
          onOpenFile={openFile}
          onOpenFolder={openFolder}
          onOpenPage={openPage}
          taskId={taskId}
        />
      );
    }
    if (up.kind === "page") {
      return (
        <Card>
          <div className="h-full" ref={setPageHost} />
        </Card>
      );
    }
    const computer = computerTabOf(up.href);
    if (computer) {
      return (
        <Card>
          <ComposeFiles
            file={computer.file}
            key={up.id}
            onLeaveFile={() => {
              closeTab(up.id);
            }}
            onLocationChange={(location) => {
              windowTabs.visitHref(up.id, computerHref(location));
            }}
            onOpenFile={openFile}
            onViewChange={setFilesView}
            path={computer.path}
            root={computer.root}
          />
        </Card>
      );
    }
    const { icon, title } = screenPresentation(up.href, { appsBySlug });
    return (
      <Card>
        <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
          <span className="flex items-center gap-2 text-foreground">
            <span className="[&_svg]:size-4">{icon}</span>
            {title}
          </span>
          <p>Opens beside the thread, not in a draft.</p>
          <Button
            onClick={() => {
              openOutside(up.href);
              closeTab(up.id);
            }}
            size="sm"
            variant="outline"
          >
            Open beside the thread
          </Button>
        </div>
      </Card>
    );
  })();

  return (
    // Arrives from a little below its place and leaves the same way, so a
    // window opening calls the eye to the corner it opens in; a docked window
    // slides to its new place along the foot when a neighbor goes, and its
    // page is placed again as it moves (see the host's `place`).
    <motion.div
      animate={{ opacity: 1, ...(isExpanded ? {} : { right }), y: 0 }}
      className={cn(
        // An opaque edge, and the shadow ramp without its own hairline: these
        // windows are drawn over the pane, over a page guest, and over each
        // other, and a see-through edge takes the color of whatever it lands
        // on and doubles wherever two of them cross.
        "pointer-events-auto absolute z-40 flex flex-col overflow-hidden bg-card text-foreground shadow-xl-soft ring-1 ring-gray-300 dark:ring-gray-600",
        // Docked, the window grows with the words up to the row's height, so
        // the band keeps its room under them for as long as there is room to
        // give; only then do the words scroll.
        isExpanded
          ? "inset-3 rounded-2xl"
          : "bottom-0 max-h-[calc(100%-1rem)] rounded-t-2xl",
      )}
      data-slot="compose-window"
      exit={{ opacity: 0, y: 24 }}
      initial={{ opacity: 0, ...(isExpanded ? {} : { right }), y: 24 }}
      style={isExpanded ? undefined : { height: dockedHeight, width }}
      transition={COMPOSE_MOTION}
    >
      <OrchestratorContext
        value={{
          ...orchestrator,
          // A draft is already open here; a new one from inside it would
          // come up behind the one being written.
          askAbout: undefined,
          focusComposer: () => {
            inputRef.current?.focus();
          },
          openPage,
          openPath: (path, options) => {
            orchestrator.openPath(path, { ...options, group });
          },
          openScreen,
          opensNewTab: true,
        }}
      >
        <FileOpenContext
          value={(path) => {
            if (path.endsWith("/")) {
              openFolder(path.slice(0, -1));
            } else {
              openFile(path);
            }
          }}
        >
          <PageOpenContext value={openPage}>
            <FileDropRegion className="flex h-full min-h-0 flex-col">
              <div className="flex h-12 shrink-0 items-center gap-1.5 px-3 select-none">
                <PencilSimpleIcon className="size-4 shrink-0 text-muted-foreground" />
                <span className="shrink-0 text-[13px] font-medium">
                  New thread
                </span>
                <TopicSlot
                  onClear={() => {
                    onChange((current) => {
                      const { topicId: _dropped, ...rest } = current;
                      return rest;
                    });
                  }}
                  onPick={(picked) => {
                    onChange((current) => ({ ...current, topicId: picked.id }));
                  }}
                  topic={topic}
                  topics={topics}
                />
                {/* The composer's own row, drawn here by the box below. */}
                <div
                  className="flex min-w-0 flex-1 items-center pl-2"
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
                className="flex min-h-24 shrink flex-col select-text [&_.prompt-editor]:min-h-18 [&_.prompt-editor]:text-[15px] [&_.prompt-editor]:leading-6"
                ref={wordsWrapRef}
              >
                <PromptInput
                  actionsInto={headSlot}
                  // The band's rows are the ways in; a plus beside them
                  // would be a second door to the same rooms.
                  addMenu={false}
                  autoFocus
                  autoResizeMaxHeight={WORDS_MAX_HEIGHT}
                  beforeModel={
                    <OutputPicker
                      disabled={isStarting}
                      onChange={(name) => {
                        onChange((current) => {
                          const { output: _dropped, ...rest } = current;
                          return name === undefined
                            ? rest
                            : { ...rest, output: name };
                        });
                      }}
                      value={draft.output}
                    />
                  }
                  className="min-h-0 flex-1"
                  draftKey={key}
                  isLoading={isStarting}
                  lead={
                    chosen.length > 0 || showsIncluded ? (
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
                            onLeaveOut={() => {
                              onChange((current) => {
                                const { included: _left, ...rest } = current;
                                return rest;
                              });
                            }}
                            items={includedItems}
                            tab={included}
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
                        ? { output: { name: output.name, title: output.title } }
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
              <div className="mx-2 flex min-h-80 flex-1 flex-col overflow-hidden rounded-t-xl bg-gray-200 dark:bg-gray-900">
                {showsStrip && (
                  <div className="flex h-9 shrink-0 items-center pr-1 pl-1">
                    <WindowTabStrip
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
                      threadTitles={NO_TITLES}
                    />
                  </div>
                )}
                <div className="min-h-0 flex-1">{content}</div>
              </div>
            </FileDropRegion>
          </PageOpenContext>
        </FileOpenContext>
      </OrchestratorContext>
    </motion.div>
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

/** The band's white card, for a thing drawn large in it. */
function Card({ children }: { children: ReactNode }) {
  return (
    <div className="h-full px-2 pb-2">
      <div className="h-full overflow-hidden rounded-lg bg-card">
        {children}
      </div>
    </div>
  );
}

/** A file or folder the draft was opened on by name, held for the thread until it is left out. */
function ChosenChip({
  item,
  onLeaveOut,
}: {
  item: ChosenItem;
  onLeaveOut: () => void;
}) {
  return (
    <ContextChip
      label={
        <ChipLabel
          paths={[item.path]}
          said="Stays with this draft wherever you go, and goes to Instrument with your message."
        />
      }
      mark={<ItemMark item={item} />}
      name={nameOfPath(item.path)}
      onLeaveOut={onLeaveOut}
      slot="chosen-chip"
    />
  );
}

/** A file's type icon, or the folder glyph for a folder. */
function ItemMark({ item }: { item: ChosenItem }) {
  return item.kind === "folder" ? (
    <FileSystemFolderGlyph className="h-3 w-auto" />
  ) : (
    <FileTypeIcon fileName={nameOfPath(item.path)} />
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

/**
 * The address of the computer screen standing in a folder, as the computer
 * route reads it, for a tab whose folder browser has walked somewhere.
 */
function computerHref({ path, root }: { path: string; root: string }) {
  return `/orchestrator/computer?path=${encodeURIComponent(path)}&root=${encodeURIComponent(root)}`;
}

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

/**
 * The chip at the head of the words naming what the screen already gives
 * the draft: the thing it was opened over, in the row an attached file lands
 * in, since it goes with the words as a file does. One quiet line, its mark
 * and name in grey with an x that leaves it out, so it takes no room from
 * the words and does not ask to be read; what it is for is in its tooltip.
 * Nothing of the thing itself is drawn in the draft, which stands over it.
 */
function IncludedChip({
  appsBySlug,
  items,
  onLeaveOut,
  tab,
}: {
  appsBySlug: Map<string, { name: string; site: string | undefined }>;
  /** What the thing points at on this computer, which the chip names in place of the tab. */
  items: ChosenItem[] | undefined;
  onLeaveOut: () => void;
  tab: WindowTab;
}) {
  const [one] = items ?? [];
  const name =
    items !== undefined && items.length > 1
      ? `${items.length} items`
      : one === undefined
        ? tab.kind === "page"
          ? pageTabTitle(tab) || "Page"
          : screenPresentation(tab.href, { appsBySlug }).title
        : nameOfPath(one.path);
  return (
    <ContextChip
      label={
        <ChipLabel
          paths={(items ?? []).map((item) => item.path)}
          said="On screen now, so it goes to Instrument with your message. It follows what you look at next."
        />
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

/**
 * What a tab a draft was opened over points at on this computer, less what
 * the draft already holds by name: what is selected in the Finder on screen,
 * or its folder when nothing else is; a file tab's file; a folder tab's
 * folder. Nothing on this computer, for a web page or an app, which the chip
 * names as itself; empty when everything it points at is already held.
 */
function includedItemsOf(
  tab: WindowTab,
  finder: null | { folder: string; selected: ChosenItem[] },
  chosen: ChosenItem[],
): ChosenItem[] | undefined {
  const held = new Set(chosen.map((item) => withoutSlash(item.path)));
  const unheld = (items: ChosenItem[]) =>
    items.filter((item) => !held.has(withoutSlash(item.path)));
  if (tab.kind === "page") {
    const file = hostPathOfFileUrl(tab.url);
    return file === undefined
      ? undefined
      : unheld([{ kind: "file", path: file }]);
  }
  const computer = computerTabOf(tab.href);
  if (!computer) {
    return;
  }
  if (computer.file !== undefined) {
    return unheld([{ kind: "file", path: computer.file }]);
  }
  if (finder) {
    const selected = unheld(finder.selected);
    return selected.length > 0
      ? selected
      : unheld([{ kind: "folder", path: finder.folder }]);
  }
  // A root the address names by a word (home, the recents) is not a path.
  return /^(?:\/|[A-Za-z]:)/.test(computer.root)
    ? unheld([
        { kind: "folder", path: joinHostPath(computer.root, computer.path) },
      ])
    : undefined;
}

function withoutSlash(path: string) {
  return path.length > 1 ? path.replace(/[/\\]+$/, "") : path;
}

/** The last name in a path, which is what a chip calls the thing. */
function nameOfPath(path: string) {
  return segmentsOf(path).at(-1) ?? path;
}

/**
 * The topic the thread will be filed under, after the draft's name: the pill
 * the thread will wear with a way to take it off, or a dashed slot that
 * offers the topics when none is picked yet.
 */
function TopicSlot({
  onClear,
  onPick,
  topic,
  topics,
}: {
  onClear: () => void;
  onPick: (topic: Topic) => void;
  topic: Topic | undefined;
  topics: Topic[];
}) {
  if (topic) {
    return (
      <span className="flex min-w-0 items-center gap-0.5">
        <TopicPill topic={topic} />
        <button
          aria-label={`Don't file under ${topic.name}`}
          className="grid size-5 shrink-0 place-items-center rounded-sm text-muted-foreground hover:bg-foreground/8 hover:text-foreground"
          onClick={onClear}
          title={`Don't file under ${topic.name}`}
          type="button"
        >
          <XIcon className="size-3" weight="bold" />
        </button>
      </span>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full border border-dashed border-border px-2 text-[11px] text-muted-foreground hover:border-foreground/30 hover:text-foreground data-[state=open]:text-foreground"
          type="button"
        >
          <PlusIcon className="size-3" />
          Topic
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {topics.length === 0 ? (
          <DropdownMenuItem disabled>No topics yet</DropdownMenuItem>
        ) : (
          topics.map((entry) => (
            <DropdownMenuItem
              key={entry.id}
              onSelect={() => {
                onPick(entry);
              }}
            >
              <TopicMark size="sm" topic={entry} />
              {entry.name}
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
