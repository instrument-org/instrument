import { draftSnapshotsAtom } from "@/client/atoms/prompt-value";
import { AnimatedOutlineBrandIconGlyph } from "@/client/components/brand-icon";
import { APPS_HREF, BROWSER_HREF } from "@/client/atoms/window";
import { sidebarProjectAtom } from "@/client/atoms/tab-groups";
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
import { addressInMessage } from "@/client/lib/address-in-message";
import { targetOfAddress } from "@/client/bookmarks/address";
import { hrefOfTarget } from "@/client/bookmarks/open-address";
import { Kbd } from "@/client/components/ui/kbd";
import { APP_NAME } from "@instrument-org/shared";
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

import { AskPills } from "./ask-pills";
import { type Project } from "./chats";
import { projectColor } from "./project-colors";
import { NewChatProjectButton } from "./new-chat-project-button";
import { ProjectMark } from "./project-mark";
import { projectTint } from "./project-tint";
import { includedItemsOf } from "./draft-context";
import { useShell } from "./shell-context";
import { AddressMark } from "./app-chip";
import { useAppsBySlug } from "./apps-by-slug";
import { useGroupTab } from "./group-tab";
import { screenPresentation, type ScreenNames } from "./screen-presentation";
import { useComposerAsks } from "./staged-asks";
import { useDraftProjectSuggestion } from "./use-draft-project-suggestion";
import { IdeaRows } from "./idea-rows";
import { openSettings } from "@/client/atoms/settings-modal";
import {
  ideaTabsOf,
  noteIdeaTaken,
  useIdeasAvailable,
  useTabIdeas,
} from "./use-tab-ideas";
import { arrivingNewChatTabsAtom, useWindowTabs } from "./window-tabs";

/**
 * A new chat, written in its tab group: the room a chat would have, with the
 * chat's own composer and nothing made until something is written in it.
 * Filling the group, it opens as a new chat did in 1.0: the composer at the
 * middle, under the Instrument mark and a line, a pale glint crossing it
 * once as a new tab opens on it. In the column
 * beside the group's tabs, the composer is at the foot. The draft its first words make is named in the tab's address, so a
 * draft opened from the Chats page's Drafts comes up here. What it carries besides its words
 * is what a chat's composer carries: its group's tabs, marked in `besidePlus`,
 * and what the person attached. Its title and menu are the chat's tab's.
 *
 * Its draft is its tab's, kept however empty it gets while the tab is open;
 * closing the tab, or its group, throws away one emptied of everything.
 */
export function NewChatView({
  draftId,
  ensureGroup,
  isCentered,
  besidePlus,
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
  /** Drawn beside the composer's plus, as a chat's has it: what goes with a message besides its words. */
  besidePlus?: ReactNode;
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

  const projectId = draft?.projectId ?? boxes[tabId]?.projectId;
  const project = shell.projects.find((entry) => entry.id === projectId);
  // Picked for it (New in a project, or its Project button), or with
  // the sidebar standing in the project it is filed under, the new chat is
  // that project's room, and says so. A project only suggested by its words
  // files it quietly.
  const sidebarProject = useAtomValue(sidebarProjectAtom);
  const roomOf =
    project &&
    (sidebarProject === project.id || boxes[tabId]?.projectId === project.id)
      ? project
      : undefined;
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
  // A message that is one address offers to go there: Enter goes in this
  // tab, where Back comes back to these words, and the command key with
  // Enter (or Send) sends it to the chat as it is. An address of the app's
  // own goes by the name of what it opens.
  const groupTab = useGroupTab();
  const appsBySlug = useAppsBySlug();
  const { keyJoiner, modifierKeys } = osConventions();
  const commandEnter = [modifierKeys.command, "↵"].join(keyJoiner);
  const [words, setWords] = useState("");
  const address = groupTab ? addressInMessage(words) : undefined;
  const goTo = address && {
    address: address.kind === "page" ? address.url : address.address,
    shown:
      address.kind === "page"
        ? address.shown
        : appAddressName(address.address, {
            appsBySlug,
            chatTitles: shell.chatTitles,
          }),
  };
  // In this tab whatever it opens, a chat included, as sending turns a new
  // tab into its chat in place.
  const goToAddress = () => {
    const target = goTo && targetOfAddress(goTo.address);
    if (!target) {
      return;
    }
    if (target.kind === "page") {
      groupTab?.showPage(target.url);
    } else {
      windowTabs.visitHref(tabId, hrefOfTarget(target));
    }
  };
  // Ideas for a new chat, from what else its group has open and what the
  // person did lately, as next-message rows under the centered box.
  const ideasOn = useIdeasAvailable() && isCentered;
  const ownGroup = windowTabs.allTabs.find((tab) => tab.id === tabId)?.group;
  const ideas = useTabIdeas({
    isOn: ideasOn && ownGroup !== undefined,
    tabs:
      ownGroup === undefined
        ? []
        : ideaTabsOf(windowTabs.layoutOf(ownGroup), tabId),
    trigger: "new-tab",
  });
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
  const projectButton = (
    <NewChatProjectButton
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
          "relative isolate mx-auto w-full shrink-0 px-3",
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
          if (
            address &&
            event.key === "Enter" &&
            !event.shiftKey &&
            !event.altKey &&
            !event.metaKey &&
            !event.ctrlKey &&
            !event.nativeEvent.isComposing
          ) {
            event.preventDefault();
            event.stopPropagation();
            goToAddress();
          }
        }}
      >
        <PromptInput
          attachmentsLead={
            draft ? <MarkedPills draftId={draft.id} /> : undefined
          }
          autoFocus={takesCaret}
          draftKey={key}
          isLoading={false}
          keyboardHome
          besidePlus={
            <>
              {projectButton}
              {besidePlus}
              {address && (
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
          onWordsChange={setWords}
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
        {goTo && (
          <button
            className={cn(
              "absolute inset-x-3 flex h-10 items-center gap-2.5 rounded-xl bg-card px-3 text-left text-sm shadow-xs ring-1 ring-foreground/6 hover:bg-accent",
              isCentered ? "top-full mt-2" : "bottom-full mb-2",
            )}
            data-address-go=""
            onClick={goToAddress}
            type="button"
          >
            <span className="grid size-4 shrink-0 place-items-center">
              <AddressMark address={goTo.address} className="size-4" />
            </span>
            <span className="min-w-0 flex-1 truncate">
              Go to <span className="font-medium">{goTo.shown}</span>
            </span>
            <Kbd>↵</Kbd>
          </button>
        )}
        {!goTo && ideasOn && (
          <IdeaRows
            className="absolute inset-x-6 top-full mt-3"
            isBoxEmpty={words.trim() === ""}
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

/** What an address of the app's own opens, named as its tab would be: a chat's title, a page's name. */
function appAddressName(address: string, names: ScreenNames): string {
  const target = targetOfAddress(address);
  return target && target.kind !== "page"
    ? screenPresentation(hrefOfTarget(target), names).title
    : address;
}
