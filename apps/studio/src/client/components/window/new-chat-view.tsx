import { draftSnapshotsAtom } from "@/client/atoms/prompt-value";
import { ChatCircleIcon } from "@phosphor-icons/react/ChatCircle";
import { APPS_HREF, BROWSER_HREF, filesHrefAtom } from "@/client/atoms/window";
import { sidebarProjectAtom } from "@/client/atoms/tab-groups";
import {
  itemsOf,
  useDraftStaging,
  useFolderItems,
} from "@/client/components/draft-staging";
import { FileDropRegion } from "@/client/components/file-drop-region";
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
import { APP_NAME } from "@instrument-org/shared";
import { useRouter } from "@tanstack/react-router";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import {
  type ReactNode,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
} from "react";

import { AskPills } from "./ask-pills";
import { type Project } from "./chats";
import { projectColor } from "./project-colors";
import { ProjectMark } from "./project-mark";
import { projectTint } from "./project-tint";
import { includedItemsOf } from "./draft-context";
import { useShell } from "./shell-context";
import { useComposerAsks } from "./staged-asks";
import { useDraftProjectSuggestion } from "./use-draft-project-suggestion";
import { newChatHref } from "./window-href";
import { useWindowTabs } from "./window-tabs";

/**
 * A new chat, written in its tab group: the room a chat would have, with the
 * chat's own composer and nothing made until something is written in it.
 * Filling the group, it opens as a new chat did in 1.0: the composer at the
 * middle, under the Instrument mark and a line, a pale glint crossing it as
 * it arrives. In the column
 * beside the group's tabs, the composer is at the foot. The draft its first words make is named in the tab's address, so a
 * draft opened from the Chats page's Drafts comes up here. What it carries besides its words
 * is what a chat's composer carries: its group's tabs, summed up in `lead`,
 * and what the person attached. Its title and menu are the chat's tab's.
 *
 * Its draft is its tab group's, kept however empty it gets while the group
 * is open; closing the group throws away one that holds nothing.
 */
export function NewChatView({
  draftId,
  ensureGroup,
  isCentered,
  isPaneShown,
  lead,
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
  /** Drawn at the head of the composer, as a chat's has it: what goes with a message besides its words. */
  lead?: ReactNode;
  /** Brings the side panel up for something just opened into it. */
  onOpenBeside: (group: string) => void;
  tabId: string;
  /** Whether its composer takes the caret: while nothing beside it has a field of its own. */
  takesCaret: boolean;
}) {
  const shell = useShell();
  const router = useRouter();
  const windowTabs = useWindowTabs();
  const filesHref = useAtomValue(filesHrefAtom);
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

  // The address says which draft is written here: one arriving there (from
  // a window expanded, from Drafts, from back) is taken up, its words and
  // what was attached to it put in the box, and an address naming none
  // starts a new chat with an empty box. A draft made here is already the
  // one the box writes into by the time the address names it, and keeps
  // whatever was typed since. The box is read as it stands now rather than
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
  // is kept with the draft as the box lets go of it, popped out or left, so
  // its window or this screen shows it again as it was.
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
  // A draft made here, by the first words or the first thing opened beside
  // them, is put in the address, so a back or a relaunch finds it. Only one
  // made here: a draft taken up from the address is the address's to name,
  // and naming it again from here would fight the address as it moves on.
  useEffect(() => {
    const box = store.get(newChatBoxesAtom)[tabId];
    if (
      box?.isMadeHere === true &&
      box.draftId !== null &&
      box.draftId !== draftId
    ) {
      router.history.replace(newChatHref(box.draftId));
    }
  }, [boundId, draftId, router, store, tabId]);
  // As the screen goes (its group switched away from, its tab closed), words
  // typed a moment before are written now, ahead of the composer's own
  // write as it goes, which is too late for the effect above: a draft they
  // make is named in the address here, so the screen comes back with them.
  // The router has stopped following its address by now, so it is told.
  const nameAsItGoes = useEffectEvent(() => {
    const made = settleMadeDraft(store, tabId);
    if (made !== undefined && made !== draftId) {
      router.history.replace(newChatHref(made));
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
  // With the sidebar standing in the project it is filed under, the new
  // chat is that project's room, and says so.
  const sidebarProject = useAtomValue(sidebarProjectAtom);
  const roomOf = project && sidebarProject === project.id ? project : undefined;

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

  return (
    <FileDropRegion className="flex h-full min-h-0 flex-col">
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
        data-attaches-files=""
      >
        <PromptInput
          attachmentsLead={
            draft ? <MarkedPills draftId={draft.id} /> : undefined
          }
          autoFocus={takesCaret}
          draftKey={key}
          isLoading={false}
          keyboardHome
          lead={lead}
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
          onModelChange={shell.setDefaultModelURI}
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
        {/* Drawn again for each new chat that fills its group, so the glint
            crosses the composer as the chat arrives. */}
        {isCentered && (
          <span
            aria-hidden
            className="pointer-events-none absolute -top-0.5 right-2.5 -bottom-0.5 left-2.5 z-10 field-glint rounded-[20px]"
            key={draftId ?? tabId}
          />
        )}
      </div>
      {/* As much room under the composer as over it, so it stands at the
          middle. */}
      {isCentered && <div className="min-h-0 flex-1" />}
      {draft && <ProjectSuggestion draft={draft} />}
    </FileDropRegion>
  );
}

/** The chat bubble over a line, as a new chat in 1.0 opened under them. */
function NewChatIntro() {
  return (
    <div className="flex flex-col items-center gap-y-5">
      <ChatCircleIcon
        className="size-18 text-brown-300/34 dark:text-brown-900/34"
        weight="fill"
      />
      <h1 className="font-serif text-2xl leading-none font-normal tracking-[-0.03em] whitespace-nowrap text-foreground @xl/app-content:text-3xl @3xl/app-content:text-4xl">
        How can I help?
      </h1>
    </div>
  );
}

/** The project a new chat beside its list opens in: its mark, its name, and where the chat goes. */
function ProjectRoom({ project }: { project: Project }) {
  return (
    <div
      className="project-room-in flex flex-col items-center pb-16 text-center project-tint"
      style={projectTint(projectColor(project))}
    >
      <span className="grid size-12 place-items-center rounded-xl bg-background shadow-xs ring-1 ring-border/60">
        <ProjectMark
          className="size-7 text-[22px]"
          plain
          project={project}
          size="lg"
        />
      </span>
      <h3 className="mt-3 text-xl font-semibold text-(--project-tint-ink)">
        {project.name}
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">
        New chats here go into this project.
      </p>
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
