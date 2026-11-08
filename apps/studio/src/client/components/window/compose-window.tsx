import {
  draftSnapshotsAtom,
  storedWordsAtom,
} from "@/client/atoms/prompt-value";
import { type Draft, draftGroupOf, isLeftEmpty } from "@/shared/drafts";
import { APPS_HREF, BROWSER_HREF, filesHrefAtom } from "@/client/atoms/window";
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
import { fileUrlOf } from "@/client/lib/file-url";
import { getFileType } from "@/client/lib/get-file-type";
import { osConventions } from "@/client/lib/utils";
import {
  itemsOf,
  useDraftStaging,
  useFolderItems,
} from "@/client/components/draft-staging";
import { ChipPresence } from "@/client/components/attached-item-preview";
import { fileHref, folderHref } from "@/shared/computer-href";
import { type AIGatewayModelURI } from "@instrument-org/ai-gateway/client";
import { type FileUpload } from "@instrument-org/workspace/client";
import { ArrowsOutSimpleIcon } from "@phosphor-icons/react/ArrowsOutSimple";
import { CircleDashedIcon } from "@phosphor-icons/react/CircleDashed";
import { MinusIcon } from "@phosphor-icons/react/Minus";
import { TrashIcon } from "@phosphor-icons/react/Trash";
import { XIcon } from "@phosphor-icons/react/X";
import { useAtomValue, useSetAtom } from "jotai";
import { AnimatePresence, motion, useIsPresent } from "motion/react";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";

import { AskPills } from "./ask-pills";
import { type BrowserTabsHandle, type PageChromeSlots } from "./browser-tabs";
import { draftTitle, type Project } from "./chats";
import {
  COMPOSE_BAR_WIDTH,
  COMPOSE_GUEST_LAYER,
  COMPOSE_MOTION,
  COMPOSE_WIDTH,
} from "./compose-layout";
import { asksOwnPlace, useWindow, WindowContext } from "./context";
import { ContextChips, ContextSuggestion } from "./context-chip";
import { appTabsAtom } from "./app-tabs";
import { type BandTarget, openInBand, targetsOf } from "./draft-band";
import { includedItemsOf } from "./draft-context";
import { GroupItem } from "./group-item";
import { usePageHost } from "./page-hosts";
import { tabSurfaceAtom } from "./tab-surface";
import { segmentsOf } from "./host-path";
import { LinkSurface } from "./link-surface";
import { useComposerAsks, useStagedAskActions } from "./staged-asks";
import { projectColor } from "./project-colors";
import { ProjectMark } from "./project-mark";
import { AddProjectChip, ProjectPicker } from "./project-picker";
import { projectTint } from "./project-tint";
import { useDraftChips } from "./use-draft-chips";
import { useDraftProjectSuggestion } from "./use-draft-project-suggestion";
import { useTabInView } from "./use-tab-in-view";
import { isHomeTab } from "./tab-model";
import { matchScreen } from "./window-href";
import { useWindowTabs } from "./window-tabs";

/** What the composer hands over to start the chat. */
export interface DraftSend {
  files?: FileUpload.Input[];
  folders?: { path: string }[];
  modelURI: AIGatewayModelURI.Type;
  prompt: string;
}

/** The most the words take before they scroll, whatever the window could give them. */
const WORDS_MAX_HEIGHT = 192;

/** A docked window's height, in layout px, while its well is open, however long the words run: they scroll inside it, and Expand is there for more room. */
const COMPOSE_HEIGHT = 640;

/**
 * The draft put down: a dark bar along the window's foot with its first
 * words, brought back up by a press, closed by its cross. Flush with the foot
 * in the light theme, where it has no ring to double the edge the system
 * draws there; a screen pixel up in the dark one, where it has.
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
  const isPresent = useIsPresent();
  return (
    <motion.div
      animate={{ opacity: 1, right, y: 0 }}
      className="pointer-events-auto absolute bottom-0 z-40 flex h-9 items-center overflow-hidden rounded-t-lg bg-gray-900 text-[12px] font-medium text-white shadow-xl-soft [clip-path:inset(-4rem_-4rem_0_-4rem)] dark:bottom-[calc(1px/var(--app-zoom))] dark:bg-gray-800 dark:ring-1 dark:ring-[color-mix(in_srgb,#fff_10%,var(--background))]"
      data-slot="compose-bar"
      exit={{ opacity: 0, y: 36 }}
      inert={!isPresent}
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
 * A draft of a new chat, in a window that floats over Files, the browser or
 * Apps the way a mail client's compose window does, docked at the window's
 * bottom-right corner. On a tinted shell: a head with the draft's name, the
 * project it will be filed under, and the window's own buttons (trash, then
 * minimize to a bar, expand into the Chat screen, close); under it the chat's
 * own composer; and
 * under that, once the draft has something open, a well that is the draft's
 * own pane. The composer's chips are that pane's tabs: the one picked is the
 * one drawn in the well, and taking one off closes it. The draft's tabs are
 * the chat's tabs from the moment it starts; nothing is handed over.
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
  onExpand,
  onMinimize,
  onModelChange,
  onNewProject,
  onStart,
  right,
  projects,
  width = COMPOSE_WIDTH,
}: {
  browser: BrowserTabsHandle | null;
  draft: Draft;
  modelURI: AIGatewayModelURI.Type | undefined;
  onChange: (update: (draft: Draft) => Draft) => void;
  /** The window's close, with the words as the box has them that moment and whether it is dictating more: the caller keeps or throws the draft away by them. */
  onClose: (words: string, dictating: boolean) => void;
  /** Throws the draft away, from the head's trash, offered while it has anything to lose (`isLeftEmpty`). */
  onDiscard: () => void;
  /** Takes the draft into the Chat screen, written there in full beside the chat list. */
  onExpand: () => void;
  /** Puts the window down to a bar along the foot. */
  onMinimize: () => void;
  onModelChange: (modelURI: AIGatewayModelURI.Type) => void;
  /** Makes a project named for what was typed in the head's project picker, and files the draft under it. */
  onNewProject: (name: string) => void;
  onStart: (send: DraftSend) => void;
  /** Where a docked window stands along the foot, in layout px from the right edge; the windows beside it are placed the same way. */
  right: number;
  projects: Project[];
  /** A docked window's width, narrower than its own on a row with less room. */
  width?: number;
}) {
  // On its way out it is still drawn, with the handlers of the render before
  // it left, so it takes no input then.
  const isPresent = useIsPresent();
  const appWindow = useWindow();
  const appTabs = useAtomValue(appTabsAtom).tabs;
  const windowTabs = useWindowTabs();
  const filesHref = useAtomValue(filesHrefAtom);
  const group = draftGroupOf(draft.id);
  // A new-tab page a build before this one opened a draft on is no tab of
  // the draft's: it is left out of the chips and never drawn in the well.
  const tabs = windowTabs.allTabs.filter(
    (tab) => tab.group === group && !isHomeTab(tab),
  );
  // What was marked in files and moved here, as pills that go with the words.
  const marked = useComposerAsks({ draftId: draft.id, kind: "draft" });
  const { moveTo: moveAsks } = useStagedAskActions();
  const selected = windowTabs.selectedTabIn(group);
  // The well opens on what the person asks to see (a chip pressed, a place
  // opened from the plus) and closes on a second press of the chip it shows,
  // so taking something in adds its chip without covering the screen.
  const [isWellOpen, setWellOpen] = useState(false);
  const up = isWellOpen
    ? selected && !isHomeTab(selected)
      ? selected
      : (tabs.at(-1) ?? undefined)
    : undefined;
  const surfaces = useAtomValue(tabSurfaceAtom);
  const inView = useTabInView();

  // The words are the draft's own, wherever they are read; what else the
  // box held when it was put away is put back as it comes up.
  const key = { draftId: draft.id, scope: "draft" as const };
  const snapshots = useAtomValue(draftSnapshotsAtom);
  const setSnapshots = useSetAtom(draftSnapshotsAtom);
  const snapshot = snapshots[draft.id];
  const words = useAtomValue(storedWordsAtom(key));

  const inputRef = useRef<PromptInputRef>(null);
  const [dictating, setDictating] = useState(false);

  // What the box holds besides its words, kept with the draft.
  const staging = useDraftStaging({
    draftFor: () => draft.id,
    onChange: (_draftId, update) => {
      onChange(update);
    },
  });
  const { asStaged, keepItems, removeItem } = staging;
  useFolderItems({ draft, input: inputRef, staging });
  // Layout rather than passive effects: on the way in the box's handle is
  // set by then and on the way out it is still there, which a passive
  // cleanup would find already gone.
  // Past a relaunch only what has a place on disk is left, from the record.
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (snapshot) {
      input?.restore({ ...snapshot, prompt: words });
    } else {
      const items = itemsOf(draft);
      if (items.length > 0) {
        input?.restore({ items, prompt: words });
      }
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

  const project = projects.find((entry) => entry.id === draft.projectId);
  // Retired projects stay nameable on a draft already filed under one, but are
  // never offered or picked again.
  const liveProjects = projects.filter((entry) => !entry.retired);
  useDraftProjectSuggestion({ draft, onChange, projects: liveProjects, words });

  // What the band opens lands in the draft's group and comes up in the band,
  // never on screen behind the window; the caret goes back to the words,
  // which are what the window is for.
  const openPage = (url: string) => {
    const id = browser?.openOrFocus(url, { group });
    if (id !== undefined) {
      windowTabs.select(id);
      setWellOpen(true);
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
    setWellOpen(true);
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
      setWellOpen(true);
      inputRef.current?.focus();
    }
  };
  // A screen asked for from inside the band: the apps and the computer open
  // in the band, and anything else (a chat, a task, a skill) has no place in
  // a draft and opens beside the chat instead. An app is named in the words
  // by mentioning it.
  const openScreen = (href: string) => {
    const { kind } = matchScreen(href);
    if (
      kind === "computer" ||
      kind === "apps" ||
      kind === "app" ||
      kind === "newTab"
    ) {
      openScreenIn(href);
      return;
    }
    appWindow.openScreen(href, { newTab: true });
  };
  // Closing what the well shows closes the well, rather than putting
  // another of the chips up in its place.
  const closeTab = (id: string) => {
    if (id === up?.id) {
      setWellOpen(false);
    }
    windowTabs.close(id);
  };
  /** A chip pressed: its tab comes up in the well, or the well closes when it already shows it. */
  const showTab = (id: string) => {
    if (id === up?.id) {
      setWellOpen(false);
      return;
    }
    windowTabs.select(id);
    setWellOpen(true);
  };
  const open = (target: BandTarget) =>
    openInBand({ appTabs, browser, group, target, windowTabs });
  // What the draft carries besides its words, as its chips: the same list
  // its chat is told at the press (see draftContextItems).
  const {
    items: contextItems,
    leaveOut,
    suggestion,
  } = useDraftChips({
    allTabs: windowTabs.allTabs,
    band: tabs,
    closeTab,
    draft,
    finderOf: (id) => surfaces[id]?.finder ?? null,
    inView,
    onChange,
    open,
  });
  // The attached file or folder the well shows, whose chip stands raised.
  const shownPath = up ? includedItemsOf(up, null, [])?.[0]?.path : undefined;

  // The element the page is drawn into, held as state so the ref React
  // calls is one stable setter: a callback made afresh each render is
  // called with null and then the element on every render, and each of
  // those would be said to the browser again. The address row takes the
  // page's reload and controls, or else the page draws its own bar.
  const [pageHost, setPageHost] = useState<HTMLDivElement | null>(null);
  const [pageChrome, setPageChrome] = useState<PageChromeSlots>();
  usePageHost(group, {
    chrome: pageChrome ?? true,
    into: pageHost,
    isActive: true,
    layer: COMPOSE_GUEST_LAYER,
    place: `${right}:${width}`,
  });

  const openBrowser = () => {
    // The caret goes to the new tab's address field, which takes it as it
    // arrives only while nothing else holds it; the words give it up rather
    // than taking it back.
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    windowTabs.openOrFocusScreen(BROWSER_HREF, {
      group,
      isOpened: true,
      select: true,
    });
    setWellOpen(true);
  };
  // The plus opens the web, the computer and Apps in the well, the way a
  // chat's plus opens them beside the chat.
  const places = {
    computerName: osConventions().computer,
    onOpenApps: () => {
      openScreenIn(APPS_HREF);
    },
    onOpenComputer: () => {
      openScreenIn(filesHref);
    },
    onOpenWeb: openBrowser,
  };

  return (
    // Arrives from a little below its place and leaves the same way, so a
    // window opening calls the eye to the corner it opens in; a docked window
    // slides to its new place along the foot when a neighbor goes, and its
    // page is placed again as it moves (see the host's `place`).
    <motion.div
      animate={{ opacity: 1, right, y: 0 }}
      // An opaque edge, and the shadow ramp without its own hairline: these
      // windows are drawn over the pane, over a page guest, and over each
      // other, and a see-through edge takes the color of whatever it lands on
      // and doubles wherever two of them cross. A screen pixel off the foot
      // at any zoom, so the ring stops short of the edge the system draws
      // along the window's bottom rather than doubling it, and clipped at its
      // own foot, so the ring's bottom side and the shadow under it never
      // reach that edge either. The bars along the foot stand on the same
      // line.
      className="pointer-events-auto absolute bottom-[calc(1px/var(--app-zoom))] z-40 flex max-h-[calc(100%-3.5rem)] flex-col overflow-hidden rounded-t-2xl bg-gray-100 text-foreground shadow-xl-soft ring-1 ring-gray-300 [clip-path:inset(-4rem_-4rem_0_-4rem)] dark:bg-gray-900 dark:ring-gray-600"
      data-slot="compose-window"
      exit={{ opacity: 0, y: 24 }}
      inert={!isPresent}
      initial={{ opacity: 0, right, y: 24 }}
      // With nothing open the window is only its head and the composer; a
      // page or a folder opens the well, which takes the window's full
      // height, and the words scroll past what is left over it.
      style={{ height: up ? COMPOSE_HEIGHT : "auto", width }}
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
            if (asksOwnPlace(options)) {
              appWindow.openPage(url, options);
            } else {
              openPage(url);
            }
          },
          openPath: (path, options) => {
            appWindow.openPath(
              path,
              asksOwnPlace(options) ? options : { ...options, group },
            );
          },
          openScreen: (href, options) => {
            if (asksOwnPlace(options)) {
              appWindow.openScreen(href, options);
            } else {
              openScreen(href);
            }
          },
        }}
      >
        <FileOpenContext
          value={(path, options) => {
            if (asksOwnPlace(options)) {
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
              if (asksOwnPlace(options)) {
                appWindow.openPage(url, options);
              } else {
                openPage(url);
              }
            }}
          >
            <FileDropRegion className="flex h-full min-h-0 flex-col">
              <div className="flex h-11 shrink-0 items-center gap-1.5 pr-2 pl-3 select-none">
                <span className="inline-flex h-7 shrink-0 items-center px-1.5 text-[13px] font-medium">
                  New chat
                </span>
                <ProjectSlot
                  onClear={() => {
                    onChange((current) => {
                      const { projectId: _dropped, ...rest } = current;
                      return { ...rest, projectSource: "chosen" };
                    });
                  }}
                  onNew={onNewProject}
                  onPick={(picked) => {
                    onChange((current) => ({
                      ...current,
                      projectId: picked.id,
                      projectSource: "chosen",
                    }));
                  }}
                  suggested={draft.projectSource === "suggested"}
                  project={project}
                  projects={liveProjects}
                />
                <div className="ml-auto flex shrink-0 items-center gap-0.5">
                  {/* Always there, so words landing in the draft don't move the
                      buttons beside it. */}
                  <WindowButton
                    disabled={isLeftEmpty(draft, {
                      hasTabs: tabs.length > 0,
                      words,
                    })}
                    label="Discard draft"
                    onClick={onDiscard}
                  >
                    <TrashIcon className="size-4" />
                  </WindowButton>
                  <span className="mx-1 h-4 w-px bg-border" />
                  <WindowButton label="Minimize" onClick={onMinimize}>
                    <MinusIcon className="size-4" />
                  </WindowButton>
                  <WindowButton label="Expand" onClick={onExpand}>
                    <ArrowsOutSimpleIcon className="size-4" />
                  </WindowButton>
                  <WindowButton
                    label="Close"
                    onClick={() => {
                      onClose(words, dictating);
                    }}
                  >
                    <XIcon className="size-4" />
                  </WindowButton>
                </div>
              </div>
              {/* The composer on a card of its own: what goes with the
                  message over the words, always shown, since in a draft
                  they are what is attached; a few lines for the words; and
                  along the foot the plus at the left and the model, the mic
                  and send at the right. Over the well the words scroll past
                  a few lines, so the page keeps its room. */}
              <div className="mx-2 mb-2 shrink-0 rounded-[18px] bg-card shadow-[0_1px_2px_rgb(0_0_0/0.05),0_4px_12px_-4px_rgb(0_0_0/0.08)] ring-1 ring-black/6 select-text dark:ring-white/8 [&_.prompt-editor]:min-h-12 [&_.prompt-editor]:text-[14px] [&_.prompt-editor]:leading-6 [&_[data-slot=composer-frame]]:px-3 [&_[data-slot=composer-frame]]:pt-3 [&_[data-slot=composer-frame]]:pb-2">
                <PromptInput
                  attachmentsLead={
                    marked.length > 0 ? <AskPills asks={marked} /> : undefined
                  }
                  autoFocus
                  {...(up ? { autoResizeMaxHeight: WORDS_MAX_HEIGHT } : {})}
                  besidePlus={
                    <AnimatePresence initial={false}>
                      {suggestion && (
                        <ChipPresence key={suggestion.key}>
                          <ContextSuggestion
                            item={suggestion}
                            onTake={() => {
                              for (const target of targetsOf(suggestion)) {
                                open(target);
                              }
                            }}
                          />
                        </ChipPresence>
                      )}
                    </AnimatePresence>
                  }
                  draftKey={key}
                  hasAttachmentsLead={marked.length > 0}
                  onDictatingChange={setDictating}
                  onFolders={(paths) => {
                    for (const path of paths) {
                      openFolder(path);
                    }
                  }}
                  onItemRemoved={removeItem}
                  onItemsChange={keepItems}
                  onShowItem={(item) => {
                    if (item.path === shownPath) {
                      setWellOpen(false);
                    } else if (item.kind === "folder") {
                      openFolder(item.path);
                    } else {
                      openFile(item.path);
                    }
                  }}
                  shownPath={shownPath}
                  // The window becomes the chat's at the press, so the
                  // box is never left waiting on a send.
                  isLoading={false}
                  lead={
                    contextItems.length > 0 ? (
                      <ContextChips
                        band={{
                          group,
                          onSelect: showTab,
                          selectedId: up?.id,
                        }}
                        items={contextItems}
                        onLeaveOut={leaveOut}
                      />
                    ) : undefined
                  }
                  modelURI={modelURI}
                  onModelChange={onModelChange}
                  onSubmit={(send) => {
                    onStart(asStaged(send));
                  }}
                  placeholder="What do you need?"
                  places={places}
                  ref={inputRef}
                  variant="bare"
                />
              </div>
              {/* The well: the draft's own pane, a card of its own under the
                  composer, its corners concentric with the row inside it. */}
              {up && (
                <div className="mx-2 mb-2 flex min-h-0 flex-1 flex-col overflow-hidden rounded-[18px] bg-card shadow-xs ring-1 ring-border [--background:var(--card)] [--guest-bottom-radius:18px]">
                  <LinkSurface>
                    <GroupItem
                      closeTab={closeTab}
                      group={group}
                      onPageChrome={setPageChrome}
                      onPageHost={setPageHost}
                      up={up}
                    />
                  </LinkSurface>
                </div>
              )}
            </FileDropRegion>
          </PageOpenContext>
        </FileOpenContext>
      </WindowContext>
    </motion.div>
  );
}

/**
 * One of a window's own buttons: discard, minimize, expand, close. One that
 * `keepsFocus` takes no focus when pressed, so the caret stays in the words
 * while the window changes around them.
 */
export function WindowButton({
  children,
  disabled,
  keepsFocus = false,
  label,
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  keepsFocus?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <ToolbarTooltip label={label}>
      <Button
        aria-label={label}
        className="size-7 text-muted-foreground hover:text-foreground"
        disabled={disabled}
        onClick={onClick}
        onMouseDown={
          keepsFocus
            ? (event) => {
                event.preventDefault();
              }
            : undefined
        }
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
 * The project the chat will be filed under, after what the draft is, joined by
 * "in": the pill the chat will wear, which opens the project picker, with a way
 * to take it off, or a dashed slot that opens the same picker when none is
 * picked yet. A project Instrument filed on its own explains itself on hover.
 */
export function ProjectSlot({
  onClear,
  onNew,
  onPick,
  suggested,
  project,
  projects,
}: {
  onClear: () => void;
  /** Makes a project, named for what was typed in the picker, and files the draft under it. */
  onNew: (name: string) => void;
  onPick: (project: Project) => void;
  suggested: boolean;
  project: Project | undefined;
  projects: Project[];
}) {
  const picker = (trigger: ReactNode) => (
    <ProjectPicker
      chosen={new Set(project ? [project.id] : [])}
      onNew={onNew}
      onToggle={(id) => {
        const picked = projects.find((entry) => entry.id === id);
        if (id === project?.id || !picked) {
          onClear();
        } else {
          onPick(picked);
        }
      }}
      projects={projects}
    >
      {trigger}
    </ProjectPicker>
  );
  if (!project) {
    return picker(<AddProjectChip />);
  }
  // One pill in the project's tint holding two controls: its name, which
  // opens the picker, and the × at its end that takes the project off. It
  // gives up width to the head, truncating the name, when room runs out.
  const pill = (
    <span
      className="inline-flex h-5 min-w-0 items-center rounded-full bg-(--project-tint-surface) text-[11px] leading-4 text-foreground/90 project-tint"
      style={projectTint(projectColor(project))}
    >
      {picker(
        <button
          className="flex h-full min-w-0 items-center gap-1 rounded-l-full pr-0.5 pl-1 hover:bg-(--project-tint-edge)"
          type="button"
        >
          {project.emoji ? (
            <span className="text-[10px]">{project.emoji}</span>
          ) : (
            <ProjectMark className="size-3.5 text-[10px]" project={project} />
          )}
          <span className="max-w-28 truncate">{project.name}</span>
        </button>,
      )}
      <button
        aria-label={`Don't file under ${project.name}`}
        className="grid h-full w-5 shrink-0 place-items-center rounded-r-full text-foreground/60 hover:bg-(--project-tint-edge) hover:text-foreground"
        onClick={onClear}
        title={`Don't file under ${project.name}`}
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
        // A project that arrived on its own says where it came from.
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="flex min-w-0">{pill}</span>
          </TooltipTrigger>
          <TooltipContent className="max-w-64" side="bottom">
            <p className="font-medium">Instrument picked this project</p>
            <p className="opacity-80">
              {`What you wrote fits “${project.name}”.`}
            </p>
          </TooltipContent>
        </Tooltip>
      ) : (
        pill
      )}
    </span>
  );
}
