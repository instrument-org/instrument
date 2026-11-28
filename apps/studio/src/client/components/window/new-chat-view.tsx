import { sidebarProjectAtom } from "@/client/atoms/tab-groups";
import { draftSnapshotsAtom } from "@/client/atoms/prompt-value";
import { AnimatedOutlineBrandIconGlyph } from "@/client/components/brand-icon";
import { APPS_HREF, BROWSER_HREF } from "@/client/atoms/window";
import { useFilesStartHref } from "@/client/hooks/use-files-start-href";
import {
  itemsOf,
  useDraftStaging,
  useFolderItems,
} from "@/client/components/draft-staging";
import { fileHref, folderHref, missingPathHref } from "@/shared/computer-href";
import {
  PromptInput,
  type PromptInputRef,
} from "@/client/components/prompt-input";
import {
  bindNewChatBoxAtom,
  draftInNewChatBox,
  dropNewChatWordsAtom,
  makeNewChatDraftAtom,
  newChatBoxesAtom,
  newChatWordsKey,
  pickedNewChatProject,
  pickNewChatProjectAtom,
  settleMadeDraft,
} from "@/client/drafts/new-chat-box";
import { cancelWords } from "@/client/drafts/settle-words";
import {
  draftsAtom,
  draftsLoadedAtom,
  updateDraftAtom,
} from "@/client/drafts/store";
import { type Draft, holdsSomething, isOnItsWay } from "@/shared/drafts";
import { omit } from "radashi";
import { cn, osConventions } from "@/client/lib/utils";
import {
  locateTypedPath,
  missedPathNotice,
  typedPathHere,
} from "@/client/lib/locate-typed-path";
import { type TypedPath } from "@/client/lib/typed-path";
import { projectCommand } from "@/client/lib/app-commands";
import { webSearchUrl } from "@/client/lib/resolve-url-or-search";
import { toast } from "@/client/lib/toast";
import { targetOfAddress } from "@/client/bookmarks/address";
import { hrefOfTarget } from "@/client/bookmarks/open-address";
import { APP_NAME } from "@instrument-org/shared";
import { useRouter } from "@tanstack/react-router";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import { selectAtom } from "jotai/utils";
import {
  type ReactNode,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { AskPills } from "./ask-pills";
import { type Project } from "./chats";
import { projectColor } from "./project-colors";
import { NewChatProjectButton } from "./new-chat-project-button";
import { ProjectMark } from "./project-mark";
import { projectTint } from "./project-tint";
import { includedItemsOf } from "./draft-context";
import { DraftLinkChips } from "./draft-link-chips";
import { draftLinksOf } from "./draft-links";
import { useShell } from "./shell-context";
import { useGroupTab } from "./group-tab";
import { useFieldPages } from "./known-pages";
import {
  boxOpens,
  type BoxOpens,
  boxPageRows,
  boxSearchWords,
  siteToComplete,
} from "./new-tab-box";
import { NewTabPageList } from "./new-tab-page-list";
import { type PageRow } from "./page-rows";
import { useComposerAsks } from "./staged-asks";
import { useDraftProjectSuggestion } from "./use-draft-project-suggestion";
import {
  glintingNewChatTabsAtom,
  useTabsAtom,
  useWindowTabs,
} from "./window-tabs";

/**
 * A new chat, written in its tab group: the room a chat would have, with the
 * chat's own composer and nothing made until something is written in it.
 * Filling the group, it opens as a new chat did in 1.0: the composer at the
 * middle, under the Instrument mark and a line, a pale glint crossing it
 * once as a new tab or New is asked for over an empty new tab. In the column
 * beside the group's tabs, the composer is at the foot. The draft its first words make is named in the tab's address, so a
 * draft opened from the side panel's Drafts comes up here. What it carries besides its words
 * is what a chat's composer carries: its group's tabs and what the person
 * attached. Its title and menu are the chat's tab's.
 *
 * Its draft is its tab's, kept however empty it gets while the tab is open;
 * closing the tab, or its group, throws away one emptied of everything.
 */
export function NewChatView({
  draftId,
  ensureGroup,
  isCentered,
  isPaneShown,
  onOpenBeside,
  tabId,
  takesCaret,
}: {
  /** The draft the tab's address names, if it names one. */
  draftId: string | undefined;
  /** The group the new chat's tabs are kept under, making its draft first when it has none. */
  ensureGroup: () => string;
  /** Whether it fills its group, with the composer at the middle rather than at the foot. */
  isCentered: boolean;
  /** Whether the side panel shows the draft's tab up, where its tabs stand as a strip rather than as chips. */
  isPaneShown: boolean;
  /** Brings the side panel up for something just opened into it. */
  onOpenBeside: (group: string) => void;
  tabId: string;
  /** Whether its composer takes the caret: while nothing beside it has a field of its own. */
  takesCaret: boolean;
}) {
  const shell = useShell();
  const router = useRouter();
  const windowTabs = useWindowTabs();
  const filesHref = useFilesStartHref();
  const drafts = useAtomValue(draftsAtom);
  const draftsLoaded = useAtomValue(draftsLoadedAtom);
  const store = useStore();
  const boxes = useAtomValue(newChatBoxesAtom);
  const bindBox = useSetAtom(bindNewChatBoxAtom);
  const makeDraft = useSetAtom(makeNewChatDraftAtom);
  const dropNewChatWords = useSetAtom(dropNewChatWordsAtom);
  const updateDraft = useSetAtom(updateDraftAtom);
  const snapshots = useAtomValue(draftSnapshotsAtom);
  const setSnapshots = useSetAtom(draftSnapshotsAtom);
  const inputRef = useRef<PromptInputRef>(null);
  const draft = draftInNewChatBox(drafts, boxes, tabId);
  // What was marked in files and moved here, which shows as pills and is
  // enough to send.
  const markedCount = useComposerAsks({
    draftId: draft?.id ?? "",
    kind: "draft",
  }).length;
  const boundId = boxes[tabId]?.draftId ?? null;
  const key = { scope: "newChat" as const, tabId };
  const glints = useAtomValue(
    useMemo(
      () => selectAtom(glintingNewChatTabsAtom, (ids) => ids.get(tabId)),
      [tabId],
    ),
  );
  const endGlint = () =>
    store.set(glintingNewChatTabsAtom, (ids) => withoutTab(ids, tabId));
  useEffect(
    () => () =>
      store.set(glintingNewChatTabsAtom, (ids) => withoutTab(ids, tabId)),
    [store, tabId],
  );

  // The address says which draft is written here: one arriving there (from
  // a window expanded, from Drafts, from back) is taken up, its words and
  // what was attached to it put in the box, and an address naming none
  // starts a new chat with an empty box. A draft made here is named in the
  // address as it is made, and is already the one the box writes into. The box is read as it stands now rather than
  // as this render saw it, since these effects change it.
  const followAddress = useEffectEvent(() => {
    if (!draftsLoaded) {
      return;
    }
    const named = drafts.find(
      (entry) => entry.id === draftId && !isOnItsWay(entry),
    );
    const next = named?.id ?? null;
    if (next === (store.get(newChatBoxesAtom)[tabId]?.draftId ?? null)) {
      return;
    }
    bindBox({ draftId: next, tabId });
    const kept = named ? snapshots[named.id] : undefined;
    inputRef.current?.swapIn({
      items: kept?.items ?? itemsOf(named),
      prompt: named?.words ?? "",
    });
  });
  // Only as the address changes, and once main has read the drafts, before
  // which the draft the address names may only be unread.
  useLayoutEffect(() => {
    followAddress();
  }, [draftId, draftsLoaded, tabId]);
  // A new chat that has been filed nowhere yet starts filed under the
  // project its tab group is in, or the one the sidebar stands in.
  const ownProject =
    useAtomValue(useTabsAtom()).groups?.[
      windowTabs.allTabs.find((tab) => tab.id === tabId)?.group ?? ""
    ]?.project;
  const startFiled = useEffectEvent(() => {
    if (
      draftId !== undefined ||
      store.get(newChatBoxesAtom)[tabId] !== undefined
    ) {
      return;
    }
    const start = ownProject ?? store.get(sidebarProjectAtom);
    if (shell.projects.some((entry) => entry.id === start)) {
      store.set(pickNewChatProjectAtom, { projectId: start, tabId });
    }
  });
  const areProjectsLoaded = shell.projects.length > 0;
  useLayoutEffect(() => {
    startFiled();
  }, [areProjectsLoaded, draftId, tabId]);
  // What the box held besides its words (a picture's own preview among it)
  // is kept with the draft as the box lets go of it, so this screen shows it
  // again as it was. A draft sent from here keeps nothing of the box, which
  // the send emptied: it comes back, if its message is taken back, as its
  // record has it.
  useLayoutEffect(() => {
    if (boundId === null) {
      return;
    }
    const input = inputRef.current;
    return () => {
      const bound = store.get(draftsAtom).find((entry) => entry.id === boundId);
      const kept = input?.snapshot();
      if (bound !== undefined && isOnItsWay(bound)) {
        setSnapshots((current) => omit(current, [boundId]));
      } else if (kept) {
        setSnapshots((current) => ({ ...current, [boundId]: kept }));
      }
    };
  }, [boundId, setSnapshots, store]);
  // The draft sent from here is the chat on its way, so the box lets go of
  // it as the tab moves to the chat, and a new chat here starts empty.
  useEffect(
    () => () => {
      const sent = draftInNewChatBox(
        store.get(draftsAtom),
        store.get(newChatBoxesAtom),
        tabId,
      );
      if (sent !== undefined && isOnItsWay(sent)) {
        bindBox({ draftId: null, tabId });
      }
    },
    [bindBox, store, tabId],
  );
  // As the screen goes (its group switched away from, its tab closed), words
  // typed a moment before are written now, ahead of the composer's own
  // write as it goes: a draft they make is named in the tab's address as it
  // is made (`makeNewChatDraftAtom`), so the screen comes back with them.
  // The router has stopped following its address by now, so it is told.
  const nameAsItGoes = useEffectEvent(() => {
    if (settleMadeDraft(store, tabId) !== undefined) {
      void router.load();
    }
  });
  useEffect(
    () => () => {
      nameAsItGoes();
    },
    [],
  );

  // The tab up on the other side: the attached file or folder it shows has
  // its chip raised.
  const up = isPaneShown ? undefined : windowTabs.besideOf(tabId);
  const shownPath = up ? includedItemsOf(up, null, [])?.[0]?.path : undefined;

  const staging = useDraftStaging({
    // A paste is on disk the moment it arrives, so it makes the draft.
    draftFor: (make) => draft?.id ?? (make ? makeDraft({ tabId }) : undefined),
    onChange: (id, update) => {
      updateDraft({ id, update });
    },
  });
  useFolderItems({ draft, input: inputRef, staging });

  // Picked for it (New in a project, or its Project button), the new chat
  // is that project's room, and says so over its box. A project only
  // suggested by its words files it quietly.
  const pickedId = pickedNewChatProject(draft, boxes[tabId]);
  const roomOf = shell.projects.find((entry) => entry.id === pickedId);
  const pickProject = useSetAtom(pickNewChatProjectAtom);
  /**
   * The new chat filed under a project from its Project button, as New in
   * that project files one, or taken out of the one it is under.
   */
  const fileUnder = (picked: Project | undefined) => {
    const next = picked?.id;
    pickProject({ projectId: next, tabId });
    if (draft) {
      updateDraft({
        id: draft.id,
        update: ({ projectId: _was, ...current }) => ({
          ...current,
          ...(next === undefined ? {} : { projectId: next }),
          projectSource: "chosen",
        }),
      });
    }
  };

  // The plus opens the web, the computer and Apps beside the new chat, the
  // way a chat's plus opens them beside the chat (`openBesideChat`): on the
  // other side, made where the group has one.
  const openBeside = (href: string) => {
    const opened = ensureGroup();
    if (
      windowTabs.openScreenBeside(href, { chatTab: tabId, gesture: "click" })
    ) {
      onOpenBeside(opened);
      return;
    }
    windowTabs.openScreen(href, {
      after: tabId,
      group: opened,
      from: { reason: "link", tab: tabId },
      select: true,
    });
    onOpenBeside(opened);
  };
  // A box holding one address or one place on the computer and nothing
  // else opens it on Return, in this tab, and what was
  // typed to go there is no draft (`takeBackWords`); anything else in it is a message, which Return sends. The
  // command key with Return always sends.
  const groupTab = useGroupTab();
  // The words the person typed, and after them the rest of a site's address
  // the box wrote in after the caret (`ahead`), which is in the box and is
  // not theirs.
  const [words, setWords] = useState("");
  // Whether the words fit on one line of the box, as of their last change.
  const [isOneLine, setOneLine] = useState(true);
  const [ahead, setAhead] = useState<{ rest: string; url: string }>();
  // Whether the last key pressed in the box was a letter typed.
  const letterTyped = useRef(false);
  const typedPath = groupTab ? typedPathHere(words) : undefined;
  const { completable, offered } = useFieldPages({
    enabled: groupTab !== undefined,
  });
  /**
   * The box's words as they change. A letter typed onto the end of one word
   * that starts a site the person goes to has the rest of the site's
   * address written in after the caret, selected, so the next letter
   * replaces it and Backspace takes it away, the way an address field
   * finishes an address.
   */
  const takeWords = (next: string) => {
    if (ahead !== undefined && next === `${words}${ahead.rest}`) {
      return;
    }
    const isTypedOn =
      letterTyped.current &&
      next.length > words.length &&
      next.startsWith(words);
    letterTyped.current = false;
    setWords(next);
    setOneLine(inputRef.current?.isOneLine() ?? true);
    const site =
      isTypedOn && groupTab !== undefined && typedPathHere(next) === undefined
        ? siteToComplete(next, completable)
        : undefined;
    setAhead(
      site !== undefined && inputRef.current?.completeAhead(site.rest)
        ? site
        : undefined,
    );
  };
  const opens =
    groupTab === undefined
      ? undefined
      : boxOpens({ completedSite: ahead?.url, path: typedPath, words });
  // The list under the box, until Escape puts it away for these words or the
  // box is emptied.
  const [isListPutAway, setListPutAway] = useState(false);
  if (isListPutAway && words === "") {
    setListPutAway(false);
  }
  const pageRows =
    groupTab === undefined || isListPutAway
      ? []
      : boxPageRows({
          completedSite: ahead?.url,
          pages: offered,
          path: typedPath,
          words,
        });
  // The words as a web search, the list's last row while they fit on one line.
  const searchWords =
    groupTab === undefined || isListPutAway || !isOneLine
      ? undefined
      : boxSearchWords(words, typedPath);
  const rowCount = pageRows.length + (searchWords === undefined ? 0 : 1);
  // What Return opens, as the list's first row, lit while no other row is.
  const goRow = groupTab === undefined || isListPutAway ? undefined : opens;
  const isListed = rowCount > 0 || goRow !== undefined;
  // The row the arrows moved to for these words. No row is lit until Down
  // goes into the list; -1 is the box, where Return does what Send shows.
  const [litFor, setLitFor] = useState<{ index: number; words: string }>();
  const lit =
    litFor?.words === words && litFor.index < rowCount ? litFor.index : -1;
  const light = (index: number) => {
    setLitFor({ index, words });
  };
  /**
   * The words taken out of the box as they open a place, with the draft they
   * made: an address is not something to send later. A draft holding more
   * than words stays as it is. Back comes to the new chat, empty, under the
   * project it was filed under.
   */
  const takeBackWords = () => {
    const held = draftInNewChatBox(
      store.get(draftsAtom),
      store.get(newChatBoxesAtom),
      tabId,
    );
    const isBoxWordsOnly =
      (inputRef.current?.snapshot()?.items.length ?? 0) === 0;
    if (!isBoxWordsOnly || (held !== undefined && !isWordsOnly(held))) {
      return;
    }
    inputRef.current?.swapIn({ items: [], prompt: "" });
    dropNewChatWords({ projectId: pickedId, tabId });
  };
  // In this tab whatever it opens, a chat included, as sending turns a new
  // tab into its chat in place.
  const openAddress = (address: string) => {
    const target = targetOfAddress(address);
    if (!target) {
      return;
    }
    takeBackWords();
    if (target.kind === "page") {
      groupTab?.showPage(target.url);
    } else {
      windowTabs.visitHref(tabId, hrefOfTarget(target));
    }
  };
  const openPath = async (path: TypedPath) => {
    const located = await locateTypedPath(path);
    if (located.kind === "failed") {
      toast.error(missedPathNotice(located, path.shown));
      return;
    }
    takeBackWords();
    // A path with nothing at it opens a tab at it that says it can't find it.
    windowTabs.visitHref(
      tabId,
      located.kind === "missing"
        ? missingPathHref(located.path, path.written)
        : located.kind === "file"
          ? fileHref(located.path)
          : folderHref(located.path),
    );
  };
  const go = (to: BoxOpens) => {
    if (to.kind === "path") {
      void openPath(to.path);
    } else if (to.kind === "site") {
      openAddress(to.url);
    } else {
      openAddress(
        to.address.kind === "page" ? to.address.url : to.address.address,
      );
    }
  };
  const openRow = (row: PageRow) => {
    openAddress(row.page.url);
  };
  const searchWeb = () => {
    if (searchWords !== undefined) {
      takeBackWords();
      groupTab?.showPage(webSearchUrl(searchWords));
    }
  };
  const openLit = () => {
    const row = pageRows[lit];
    if (row) {
      openRow(row);
    } else {
      searchWeb();
    }
  };
  const places = {
    computerName: osConventions().computer,
    onOpenApps: () => {
      openBeside(APPS_HREF);
    },
    onOpenComputer: () => {
      openBeside(filesHref);
    },
    onOpenWeb: () => {
      openBeside(BROWSER_HREF);
    },
  };
  const [isProjectListOpen, setProjectListOpen] = useState(false);
  // `/project` opens the Project button's list, under the box, to type into.
  const commands = [
    projectCommand(() => {
      setProjectListOpen(true);
    }),
  ];
  const projectButton = (
    <NewChatProjectButton
      isOpen={isProjectListOpen}
      onOpenChange={setProjectListOpen}
      onPick={fileUnder}
      onReturnFocus={() => {
        inputRef.current?.focus();
      }}
      picked={roomOf}
      projects={shell.projects.filter((entry) => !entry.retired)}
    />
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Over the composer: filling the group, the mark and its line, with
          the composer at the middle; in the column, the room over a
          composer at the foot. */}
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col items-center overflow-hidden px-6",
          isCentered ? "justify-end pb-12" : "justify-center",
        )}
      >
        {roomOf ? (
          <ProjectRoom key={roomOf.id} project={roomOf} />
        ) : (
          isCentered && <NewChatIntro />
        )}
      </div>
      {/* The composer, where files let go on a new tab nobody has written
          in attach to the first message; anywhere else on the tab they
          open in it (`useSidePagesTarget`). */}
      <div
        className={cn(
          "relative isolate z-10 mx-auto w-full shrink-0 px-3",
          isCentered ? "max-w-2xl" : "max-w-3xl pb-3",
        )}
        onKeyDownCapture={(event) => {
          // Backspace in an empty box takes the project off, the way a
          // token comes out of a search field.
          if (
            roomOf &&
            words === "" &&
            event.key === "Backspace" &&
            !event.shiftKey &&
            !event.altKey &&
            !event.metaKey &&
            !event.ctrlKey &&
            event.target instanceof HTMLElement &&
            event.target.isContentEditable
          ) {
            event.preventDefault();
            fileUnder(undefined);
            return;
          }
          letterTyped.current =
            event.key.length === 1 &&
            !event.altKey &&
            !event.metaKey &&
            !event.ctrlKey &&
            !event.nativeEvent.isComposing;
          // The one letter left of what was written in, typed: the box's
          // words stay as they read, so they are taken as typed here.
          if (
            letterTyped.current &&
            ahead !== undefined &&
            event.key === ahead.rest
          ) {
            setWords(`${words}${ahead.rest}`);
            setAhead(undefined);
          }
          const isPlain =
            !event.altKey &&
            !event.metaKey &&
            !event.ctrlKey &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing;
          if (isListed && isPlain) {
            // Down and Up move the caret until it stands at the end of the
            // words, where Down goes into the list.
            if (
              event.key === "ArrowDown" &&
              (lit >= 0 || inputRef.current?.isCaretAtEnd())
            ) {
              event.preventDefault();
              event.stopPropagation();
              light(Math.min(lit + 1, rowCount - 1));
              return;
            }
            if (event.key === "ArrowUp" && lit >= 0) {
              event.preventDefault();
              event.stopPropagation();
              light(lit - 1);
              return;
            }
            // A key that moves the caret is back in the box.
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
              light(-1);
            }
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              setListPutAway(true);
              return;
            }
            if (event.key === "Enter" && lit >= 0) {
              event.preventDefault();
              event.stopPropagation();
              openLit();
              return;
            }
          }
          if (
            opens !== undefined &&
            event.key === "Enter" &&
            !event.shiftKey &&
            !event.altKey &&
            !event.metaKey &&
            !event.ctrlKey &&
            !event.nativeEvent.isComposing
          ) {
            event.preventDefault();
            event.stopPropagation();
            go(opens);
          }
        }}
      >
        <PromptInput
          attachmentsLead={
            draft ? (
              <>
                <MarkedPills draftId={draft.id} />
                <DraftLinkChips draft={draft} />
              </>
            ) : undefined
          }
          autoFocus={takesCaret}
          commands={commands}
          draftKey={key}
          hasAttachmentsLead={markedCount > 0 || draftLinksOf(draft).length > 0}
          isLoading={false}
          keyboardHome
          besidePlus={projectButton}
          modelChoice={shell.defaultModelChoice}
          modelURI={shell.defaultModelURI}
          onGo={
            lit >= 0
              ? openLit
              : opens === undefined
                ? undefined
                : () => {
                    go(opens);
                  }
          }
          onFolders={(paths) => {
            for (const path of paths) {
              openBeside(folderHref(path));
            }
          }}
          onItemRemoved={staging.removeItem}
          onItemsChange={staging.keepItems}
          onShowItem={(item) => {
            if (item.path !== shownPath) {
              openBeside(
                item.kind === "folder"
                  ? folderHref(item.path)
                  : fileHref(item.path),
              );
            }
          }}
          shownPath={shownPath}
          onModelChange={shell.setDefaultModelURI}
          onModelChoiceChange={shell.setDefaultModelChoice}
          onWordsChange={takeWords}
          // Once, as a new tab or New is asked for over an empty new tab
          // (`glintingNewChatTabsAtom`): never as the tab is shown again or
          // its first words name a draft. Over the box alone, so a note
          // docked above it stays out of the ring.
          overlay={
            isCentered &&
            glints !== undefined && (
              <span
                // A new count is a new ring, which plays from the start.
                key={glints}
                aria-hidden
                className="pointer-events-none absolute -inset-0.5 z-10 field-glint rounded-[20px]"
                data-slot="composer-glint"
                onAnimationEnd={(event) => {
                  if (event.animationName === "field-glint-ring") {
                    endGlint();
                  }
                }}
              />
            )
          }
          onSubmit={(sending) => {
            const send = staging.asStaged(sending);
            cancelWords(newChatWordsKey(tabId));
            const id = draft?.id ?? makeDraft({ tabId, words: send.prompt });
            // The screen stays as it was sent, the words and the project
            // with it, until the tab moves to the chat, which has them in
            // its place from its first frame.
            shell.startChat(id, send, tabId);
          }}
          placeholder={`Talk to ${APP_NAME}`}
          places={places}
          ref={inputRef}
        />
        {/* Under the box without moving it, so the box stays where it was
            as the list comes and goes; over it for a box at the foot. */}
        {isListed && (
          <NewTabPageList
            className={cn(
              "absolute inset-x-3",
              isCentered ? "top-full mt-2" : "bottom-full mb-2",
            )}
            lit={lit}
            onGo={() => {
              if (opens !== undefined) {
                go(opens);
              }
            }}
            onOpen={openRow}
            onSearch={searchWeb}
            opens={goRow}
            pages={offered}
            rows={pageRows}
            searchWords={searchWords}
          />
        )}
      </div>
      {/* As much room under the composer as over it, so it stands at the
          middle. */}
      {isCentered && <div className="min-h-0 flex-1" />}
      {draft && <ProjectSuggestion draft={draft} />}
    </div>
  );
}

/**
 * What stands over a new chat's composer: a mark over a line. Both kinds,
 * the plain new chat's and a project's, are this one block, so switching
 * between them changes what it shows and nothing moves.
 */
function NewChatHead({
  heading,
  mark,
}: {
  heading: ReactNode;
  mark: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-y-5">
      <div className="grid size-18 place-items-center">{mark}</div>
      <h1 className="font-serif text-2xl leading-none font-normal tracking-[-0.03em] whitespace-nowrap @xl/app-content:text-3xl @3xl/app-content:text-4xl">
        {heading}
      </h1>
    </div>
  );
}

/** The Instrument mark over a line, as a new chat in 1.0 opened under them; the mark draws itself in outline under the pointer. */
function NewChatIntro() {
  return (
    <NewChatHead
      heading={<span className="text-foreground">How can I help?</span>}
      mark={
        <div className="text-brown-300/34 dark:text-brown-900/34">
          <AnimatedOutlineBrandIconGlyph className="size-18" />
        </div>
      }
    />
  );
}

/** The project a new chat is filed under, in the plain new chat's place: its mark and its name. */
function ProjectRoom({ project }: { project: Project }) {
  return (
    <div
      className="project-room-in project-tint"
      style={projectTint(projectColor(project))}
    >
      <NewChatHead
        heading={
          <span className="text-(--project-tint-ink)">{project.name}</span>
        }
        mark={
          <span className="grid size-16 place-items-center rounded-2xl bg-background shadow-xs ring-1 ring-border/60">
            <ProjectMark
              className="size-10 text-[32px]"
              plain
              project={project}
              size="lg"
            />
          </span>
        }
      />
    </div>
  );
}

/** Whether words are all a new chat's draft has to send. */
function isWordsOnly(draft: Draft): boolean {
  return (
    !isOnItsWay(draft) &&
    !holdsSomething({ ...draft, words: "" }) &&
    (draft.context ?? []).length === 0
  );
}

/** What was marked in files and moved to the draft, as pills that go with the words. */
function MarkedPills({ draftId }: { draftId: string }) {
  const marked = useComposerAsks({ draftId, kind: "draft" });
  return marked.length > 0 ? <AskPills asks={marked} /> : null;
}

/** Files the draft under the project what was written fits, as its window does. */
function ProjectSuggestion({ draft }: { draft: Draft }) {
  const shell = useShell();
  const updateDraft = useSetAtom(updateDraftAtom);
  useDraftProjectSuggestion({
    draft,
    onChange: (update) => {
      updateDraft({ id: draft.id, update });
    },
    projects: shell.projects.filter((entry) => !entry.retired),
    words: draft.words,
  });
  return null;
}

/** The glints without a tab's, the same map when it had none. */
function withoutTab(ids: ReadonlyMap<string, number>, tab: string) {
  if (!ids.has(tab)) {
    return ids;
  }
  const rest = new Map(ids);
  rest.delete(tab);
  return rest;
}
