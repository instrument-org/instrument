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
import { fileHref, folderHref } from "@/shared/computer-href";
import {
  PromptInput,
  type PromptInputRef,
} from "@/client/components/prompt-input";
import {
  bindNewChatBoxAtom,
  draftInNewChatBox,
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
import { type Draft } from "@/shared/drafts";
import { cn, osConventions } from "@/client/lib/utils";
import {
  locateTypedPath,
  missedPathNotice,
  typedPathHere,
} from "@/client/lib/locate-typed-path";
import { type TypedPath } from "@/client/lib/typed-path";
import { projectCommand } from "@/client/lib/app-commands";
import { useSearchPicks } from "@/client/hooks/use-search-picks";
import { rememberedPick } from "@/shared/remembered-picks";
import { toast } from "@/client/lib/toast";
import { targetOfAddress } from "@/client/bookmarks/address";
import { hrefOfTarget } from "@/client/bookmarks/open-address";
import { APP_NAME } from "@instrument-org/shared";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import {
  type ReactNode,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { appTabsAtom } from "./app-tabs";
import { AskPills } from "./ask-pills";
import { chatListOptions } from "./chat-list-query";
import { type Project } from "./chats";
import { closedGroupsOf } from "./closed-groups";
import { windowTabGroupsAtom } from "./open-groups";
import { projectColor } from "./project-colors";
import { NewChatProjectButton } from "./new-chat-project-button";
import { ProjectMark } from "./project-mark";
import { projectTint } from "./project-tint";
import { includedItemsOf } from "./draft-context";
import { useShell } from "./shell-context";
import { useAppsBySlug } from "./apps-by-slug";
import { useGroupTab } from "./group-tab";
import { useShowChatGroup } from "./chat-group";
import { NewTabCompletionList } from "./new-tab-completion-list";
import {
  boxAddress,
  type BoxCompletion,
  boxCompletions,
  offersToOpen,
  siteToComplete,
} from "./new-tab-completions";
import { type SearchThing, useSearchSources } from "./search-sources";
import { RecentGroupRows } from "./recent-group-rows";
import { type RecentGroup, recentGroupsOf } from "./recent-groups";
import { typedAddressName } from "./typed-address-row";
import { useComposerAsks } from "./staged-asks";
import { useDraftProjectSuggestion } from "./use-draft-project-suggestion";
import { IdeaRows } from "./idea-rows";
import { openSettings } from "@/client/atoms/settings-modal";
import {
  ideaSourcesOf,
  noteIdeaTaken,
  useIdeasAvailable,
  useTabIdeas,
} from "./use-tab-ideas";
import {
  arrivingNewChatTabsAtom,
  useWindowTabs,
  windowTabsAtom,
} from "./window-tabs";
import { chatHref, CHATS_INDEX_HREF } from "./window-href";

/**
 * A new chat, written in its tab group: the room a chat would have, with the
 * chat's own composer and nothing made until something is written in it.
 * Filling the group, it opens as a new chat did in 1.0: the composer at the
 * middle, under the Instrument mark and a line, a pale glint crossing it
 * once as a new tab opens on it. In the column
 * beside the group's tabs, the composer is at the foot. The draft its first words make is named in the tab's address, so a
 * draft opened from the Chats page's Drafts comes up here. What it carries besides its words
 * is what a chat's composer carries: its group's tabs and what the person
 * attached. Its title and menu are the chat's tab's. The only tab of its
 * group, it lists the tab groups had most recently under its box
 * (`RecentGroupRows`), which stays where it is whatever the list holds; a
 * pick there takes the group's place.
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
  const updateDraft = useSetAtom(updateDraftAtom);
  const snapshots = useAtomValue(draftSnapshotsAtom);
  const setSnapshots = useSetAtom(draftSnapshotsAtom);
  const inputRef = useRef<PromptInputRef>(null);
  const draft = draftInNewChatBox(drafts, boxes, tabId);
  const boundId = boxes[tabId]?.draftId ?? null;
  const key = { scope: "newChat" as const, tabId };
  const [glints, setGlints] = useState(() =>
    store.get(arrivingNewChatTabsAtom).has(tabId),
  );
  useEffect(() => {
    const ids = store.get(arrivingNewChatTabsAtom);
    if (ids.has(tabId)) {
      const rest = new Set(ids);
      rest.delete(tabId);
      store.set(arrivingNewChatTabsAtom, rest);
    }
  }, [store, tabId]);

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
      (entry) => entry.id === draftId && entry.sendingTo === undefined,
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
    useAtomValue(windowTabsAtom).groups?.[
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
  // again as it was.
  useLayoutEffect(() => {
    if (boundId === null) {
      return;
    }
    const input = inputRef.current;
    return () => {
      const kept = input?.snapshot();
      if (kept) {
        setSnapshots((current) => ({ ...current, [boundId]: kept }));
      }
    };
  }, [boundId, setSnapshots]);
  // The draft sent from here is the chat on its way, so the box lets go of
  // it as the tab moves to the chat, and a new chat here starts empty.
  useEffect(
    () => () => {
      const sent = draftInNewChatBox(
        store.get(draftsAtom),
        store.get(newChatBoxesAtom),
        tabId,
      );
      if (sent?.sendingTo !== undefined) {
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

  // The plus opens the web, the computer and Apps beside the new chat, in
  // the side panel, the way a chat's plus opens them beside the chat.
  const openBeside = (href: string) => {
    const opened = ensureGroup();
    windowTabs.openScreen(href, {
      after: tabId,
      group: opened,
      isOpened: true,
      select: true,
    });
    onOpenBeside(opened);
  };
  // A box of one line with no space in it offers what it would open: the
  // words themselves, when they are an address or a place on the computer,
  // the site they start, then what they find by name as the command menu
  // finds it. Return opens the one picked, in this tab, where Back comes
  // back to these words; with none picked, or once Shift-Return has put the
  // offer away, it sends the words. The command key with Return (or Send)
  // always sends them.
  const groupTab = useGroupTab();
  const appsBySlug = useAppsBySlug();
  const showChatGroup = useShowChatGroup();
  const { keyJoiner, modifierKeys } = osConventions();
  const commandEnter = [modifierKeys.command, "↵"].join(keyJoiner);
  // The words the person typed, and after them the rest of a site's address
  // the box wrote in after the caret (`ahead`), which is in the box and is
  // not theirs.
  const [words, setWords] = useState("");
  const [ahead, setAhead] = useState("");
  // Whether the last key pressed in the box was a letter typed.
  const letterTyped = useRef(false);
  const [isOfferPutAway, setOfferPutAway] = useState(false);
  if (isOfferPutAway && words === "") {
    setOfferPutAway(false);
  }
  const typedPath = groupTab ? typedPathHere(words) : undefined;
  const offers =
    groupTab !== undefined && !isOfferPutAway && offersToOpen(words, typedPath);
  const sources = useSearchSources({ enabled: groupTab !== undefined });
  const picks = useSearchPicks({ enabled: groupTab !== undefined });
  /**
   * The box's words as they change. A letter typed onto the end of one word
   * that starts a site the person goes to has the rest of the site's
   * address written in after the caret, selected, so the next letter
   * replaces it and Backspace takes it away, the way an address field
   * finishes an address.
   */
  const takeWords = (next: string) => {
    if (ahead !== "" && next === `${words}${ahead}`) {
      return;
    }
    const isTypedOn =
      letterTyped.current &&
      next.length > words.length &&
      next.startsWith(words);
    letterTyped.current = false;
    setWords(next);
    const rest =
      isTypedOn &&
      groupTab !== undefined &&
      !isOfferPutAway &&
      typedPathHere(next) === undefined &&
      offersToOpen(next, undefined)
        ? siteToComplete(next, sources.visited)
        : undefined;
    setAhead(
      rest !== undefined && inputRef.current?.completeAhead(rest) ? rest : "",
    );
  };
  const completions = offers
    ? boxCompletions({
        address: typedPath ? undefined : boxAddress(words),
        bookmarkPages: sources.bookmarkPages,
        isCompleted: ahead !== "",
        named: [
          ...sources.named.tabs,
          ...sources.named.chats,
          ...sources.named.folders,
          ...sources.named.files,
          ...sources.named.projects,
          ...sources.named.pages,
        ],
        path: typedPath,
        recentPages: sources.recentPages,
        remembered: rememberedPick(picks.log, words, sources.now),
        words,
      })
    : { picked: -1, rows: [] };
  const [pickedFor, setPickedFor] = useState<{
    index: number;
    words: string;
  }>();
  const picked =
    pickedFor?.words === words && pickedFor.index < completions.rows.length
      ? pickedFor.index
      : completions.picked;
  const pick = (index: number) => {
    setPickedFor({ index, words });
  };
  // In this tab whatever it opens, a chat included, as sending turns a new
  // tab into its chat in place.
  const openAddress = (address: string) => {
    const target = targetOfAddress(address);
    if (!target) {
      return;
    }
    if (target.kind === "page") {
      groupTab?.showPage(target.url);
    } else {
      windowTabs.visitHref(tabId, hrefOfTarget(target));
    }
  };
  const openPath = async (path: TypedPath) => {
    const located = await locateTypedPath(path);
    if (located.kind === "failed" || located.kind === "missing") {
      toast.error(missedPathNotice(located));
      return;
    }
    windowTabs.visitHref(
      tabId,
      located.kind === "file"
        ? fileHref(located.path)
        : folderHref(located.path),
    );
  };
  // The new tab's own group, which gives way to a group picked from it
  // while this tab is all it holds.
  const ownGroup = windowTabs.allTabs.find((tab) => tab.id === tabId)?.group;
  const isOnlyTab =
    ownGroup !== undefined &&
    windowTabs.allTabs.filter((tab) => tab.group === ownGroup).length === 1;
  const givesWay = isOnlyTab ? { from: ownGroup } : undefined;
  // What the words found by name: a tab or a chat's group comes up, and
  // anything else opens in this tab.
  const openThing = (thing: SearchThing) => {
    switch (thing.kind) {
      case "chat": {
        if (!showChatGroup(thing.chat.id, givesWay)) {
          windowTabs.visitHref(tabId, chatHref(thing.chat.id));
        }
        break;
      }
      case "file": {
        windowTabs.visitHref(tabId, fileHref(thing.file.path));
        break;
      }
      case "folder": {
        windowTabs.visitHref(tabId, folderHref(thing.folder.path));
        break;
      }
      case "page": {
        openAddress(thing.page.url);
        break;
      }
      case "project": {
        shell.openProject(thing.project.id);
        break;
      }
      case "tab": {
        windowTabs.select(thing.tab.id);
        if (thing.tab.group !== undefined) {
          shell.showGroup(thing.tab.group, givesWay);
        }
        break;
      }
    }
  };
  const openCompletion = (row: BoxCompletion) => {
    if (row.kind === "path") {
      void openPath(row.path);
    } else if (row.kind === "site") {
      openAddress(row.page.url);
    } else if (row.kind === "thing") {
      picks.note(words, row.id);
      openThing(row.thing);
    } else {
      openAddress(
        row.address.kind === "page" ? row.address.url : row.address.address,
      );
    }
  };
  const isOffering = completions.rows.length > 0;
  // Ideas for a new chat, made from the pages, files and folders beside it
  // in its group, as next-message rows under the centered box. A new chat
  // with nothing beside it has none.
  const ideaSources =
    ownGroup === undefined
      ? []
      : ideaSourcesOf(windowTabs.layoutOf(ownGroup), tabId);
  const ideasOn = useIdeasAvailable() && isCentered && ideaSources.length > 0;
  const ideas = useTabIdeas({
    isOn: ideasOn,
    tabs: ideaSources,
    trigger: "new-tab",
  });
  // Alone in its group, the new tab is where the window's other groups are
  // picked up again: the ones had most recently, and every chat past them.
  const isAlone = isCentered && isOnlyTab;
  const recentGroups = recentGroupsOf({
    closed: closedGroupsOf(useAtomValue(appTabsAtom).recentlyClosed),
    home: ownGroup,
    listed: useAtomValue(windowTabGroupsAtom) ?? [],
    state: useAtomValue(windowTabsAtom),
  });
  const hasChats = (useQuery(chatListOptions()).data?.length ?? 0) > 0;
  const recentRows = useRef<HTMLDivElement>(null);
  const pickGroup = ({ pick: picking }: RecentGroup) => {
    const from = { from: ownGroup };
    if (picking.kind === "open") {
      shell.showGroup(picking.group, from);
    } else {
      shell.reopenClosed(picking.id, from);
    }
  };
  const sendIdea = (line: string) => {
    if (shell.defaultModelURI === undefined) {
      return;
    }
    noteIdeaTaken();
    cancelWords(newChatWordsKey(tabId));
    const id = draft?.id ?? makeDraft({ tabId, words: line });
    shell.startChat(
      id,
      { modelURI: shell.defaultModelURI, prompt: line },
      tabId,
    );
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
          // Down from an empty box goes into the groups listed under it.
          const firstRow = recentRows.current?.querySelector("button");
          if (
            firstRow &&
            words === "" &&
            event.key === "ArrowDown" &&
            !event.shiftKey &&
            !event.altKey &&
            !event.metaKey &&
            !event.ctrlKey &&
            !event.nativeEvent.isComposing
          ) {
            event.preventDefault();
            event.stopPropagation();
            firstRow.focus();
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
          if (letterTyped.current && ahead !== "" && event.key === ahead) {
            setWords(`${words}${ahead}`);
            setAhead("");
          }
          if (
            !isOffering ||
            event.altKey ||
            event.metaKey ||
            event.ctrlKey ||
            event.nativeEvent.isComposing
          ) {
            return;
          }
          if (event.key === "Enter" && event.shiftKey) {
            event.preventDefault();
            event.stopPropagation();
            setOfferPutAway(true);
            return;
          }
          if (event.shiftKey) {
            return;
          }
          const row = completions.rows[picked];
          if (event.key === "Enter" && row) {
            event.preventDefault();
            event.stopPropagation();
            openCompletion(row);
          } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            event.stopPropagation();
            pick(
              event.key === "ArrowDown"
                ? Math.min(picked + 1, completions.rows.length - 1)
                : Math.max(picked - 1, -1),
            );
          }
        }}
      >
        <PromptInput
          attachmentsLead={
            draft ? <MarkedPills draftId={draft.id} /> : undefined
          }
          autoFocus={takesCaret}
          commands={commands}
          draftKey={key}
          isLoading={false}
          keyboardHome
          besidePlus={
            <>
              {projectButton}
              {picked >= 0 && (
                <span className="text-xs whitespace-nowrap text-muted-foreground">
                  {commandEnter} sends to chat
                </span>
              )}
            </>
          }
          modelURI={shell.defaultModelURI}
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
          onCommandEnterWhenEmpty={
            ideas.lines[0] === undefined
              ? undefined
              : () => {
                  sendIdea(ideas.lines[0] ?? "");
                }
          }
          onModelChange={shell.setDefaultModelURI}
          onWordsChange={takeWords}
          // Once, as a new tab's composer first comes up: never as the tab
          // is shown again or its first words name a draft. Over the box
          // alone, so a note docked above it stays out of the ring.
          overlay={
            isCentered &&
            glints && (
              <span
                aria-hidden
                className="pointer-events-none absolute -inset-0.5 z-10 field-glint rounded-[20px]"
                data-slot="composer-glint"
                onAnimationEnd={(event) => {
                  if (event.animationName === "field-glint-ring") {
                    setGlints(false);
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
            as the row comes and goes; over it for a box at the foot. */}
        {isOffering && (
          <NewTabCompletionList
            className={cn(
              "absolute inset-x-3",
              isCentered ? "top-full mt-2" : "bottom-full mb-2",
            )}
            nameOfAddress={(row) =>
              typedAddressName(row.address, {
                appsBySlug,
                chatTitles: shell.chatTitles,
              })
            }
            onOpen={openCompletion}
            onPick={pick}
            picked={picked}
            rows={completions.rows}
          />
        )}
        {!isOffering && ideasOn && (
          <IdeaRows
            className="absolute inset-x-6 top-full mt-3"
            isBoxEmpty={words.trim() === ""}
            isMaking={ideas.isMaking}
            lines={ideas.lines}
            onSend={sendIdea}
            trailing={
              <button
                className="px-1 text-[11px] text-muted-foreground/60 hover:text-muted-foreground"
                onClick={() => {
                  openSettings({ setting: "show-ideas" });
                }}
                type="button"
              >
                Turn off ideas
              </button>
            }
          />
        )}
      </div>
      {/* As much room under the composer as over it, so it stands at the
          middle; what is listed there scrolls in that room. */}
      {isCentered && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {isAlone && (
            <RecentGroupRows
              chatTitles={shell.chatTitles}
              groups={recentGroups}
              hasChats={hasChats}
              onAllChats={() => {
                windowTabs.visitHref(tabId, CHATS_INDEX_HREF);
              }}
              onLeave={() => {
                inputRef.current?.focus();
              }}
              onPick={pickGroup}
              ref={recentRows}
            />
          )}
        </div>
      )}
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
