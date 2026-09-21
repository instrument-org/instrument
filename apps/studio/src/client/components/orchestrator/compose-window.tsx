import {
  type ComposePlacement,
  type Draft,
  draftGroupOf,
  draftSnapshotsAtom,
  NEW_TAB_HREF,
  type ScreenView,
  type WindowTab,
} from "@/client/atoms/orchestrator";
import { promptDraftAtom } from "@/client/atoms/prompt-value";
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
import { appMentionToken } from "@/client/lib/app-mention";
import { fileUrlOf } from "@/client/lib/file-url";
import { getFileType } from "@/client/lib/get-file-type";
import { cn } from "@/client/lib/utils";
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
import { COMPOSE_BAR_WIDTH, COMPOSE_WIDTH } from "./compose-layout";
import { ComposeZeroState } from "./compose-zero-state";
import { OrchestratorContext, useOrchestrator } from "./context";
import { computerTabOf, fileHref, folderHref } from "./file-tabs";
import { segmentsOf } from "./host-path";
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
    <div
      className="absolute bottom-0 z-40 flex h-9 items-center overflow-hidden rounded-t-lg bg-gray-900 text-[12px] font-medium text-white shadow-xl dark:bg-gray-700"
      data-slot="compose-bar"
      style={{ right, width: COMPOSE_BAR_WIDTH }}
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
    </div>
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
  onPageHost,
  onPlacementChange,
  onStart,
  onViewChange,
  openOutside,
  placement,
  right,
  topics,
}: {
  browser: BrowserTabsHandle | null;
  draft: Draft;
  isStarting: boolean;
  modelURI: AIGatewayModelURI.Type | undefined;
  onChange: (update: (draft: Draft) => Draft) => void;
  /** The window's close: the caller keeps or throws the draft away by what it holds. */
  onClose: () => void;
  onModelChange: (modelURI: AIGatewayModelURI.Type) => void;
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
}) {
  const orchestrator = useOrchestrator();
  const { taskId } = orchestrator;
  const windowTabs = useWindowTabs();
  const appsBySlug = useAppsBySlug();
  const group = draftGroupOf(draft.id);
  const tabs = windowTabs.allTabs.filter((tab) => tab.group === group);
  const up = windowTabs.tabUpIn(group);
  const isExpanded = placement === "expanded";

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
  useEffect(() => {
    if (isRestoringRef.current) {
      isRestoringRef.current = false;
      return;
    }
    if (words !== draft.words) {
      onChange((current) => ({ ...current, words }));
    }
    // The record follows the box; the box never follows the record.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [words]);

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

  // What the band opens lands in the draft's group and comes up in the band,
  // never on screen behind the window.
  const openPage = (url: string) => {
    const id = browser?.openOrFocus(url, { group });
    if (id !== undefined) {
      windowTabs.selectIn(group, id);
    }
  };
  const openScreenIn = (href: string) => {
    windowTabs.openOrFocusScreen(href, {
      activate: true,
      group,
      isOpened: true,
    });
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
          onAttach={() => {
            inputRef.current?.pickFiles();
          }}
          onOpenApp={nameApp}
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
          <p>This opens beside the thread rather than in a draft.</p>
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
    <div
      className={cn(
        "absolute z-40 flex flex-col overflow-hidden bg-card text-foreground shadow-xl ring-1 ring-black/10 dark:ring-white/10",
        isExpanded
          ? "inset-3 rounded-2xl"
          : "bottom-0 h-[640px] max-h-[calc(100%-1rem)] rounded-t-2xl",
      )}
      data-slot="compose-window"
      style={isExpanded ? undefined : { right, width: COMPOSE_WIDTH }}
    >
      <OrchestratorContext
        value={{
          ...orchestrator,
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
                  <WindowButton label="Close" onClick={onClose}>
                    <XIcon className="size-4" />
                  </WindowButton>
                </div>
              </div>
              <div className="shrink-0 select-text [&_.prompt-editor]:text-[15px] [&_.prompt-editor]:leading-6">
                <PromptInput
                  actionsInto={headSlot}
                  // The band's rows are the ways in; a plus beside them
                  // would be a second door to the same rooms.
                  addMenu={false}
                  autoFocus
                  autoResizeMaxHeight={isExpanded ? 380 : 220}
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
                  draftKey={key}
                  isLoading={isStarting}
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
              <div className="mx-2 flex min-h-0 flex-1 flex-col overflow-hidden rounded-t-xl bg-gray-200 dark:bg-gray-900">
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
    </div>
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

/**
 * The address of the computer screen standing in a folder, as the computer
 * route reads it, for a tab whose folder browser has walked somewhere.
 */
function computerHref({ path, root }: { path: string; root: string }) {
  return `/orchestrator/computer?path=${encodeURIComponent(path)}&root=${encodeURIComponent(root)}`;
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

/** One of the window's own buttons: minimize, expand, close. */
function WindowButton({
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
