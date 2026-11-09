import { draftSnapshotsAtom } from "@/client/atoms/prompt-value";
import {
  APPS_HREF,
  BROWSER_HREF,
  chatFiltersAtom,
  filesHrefAtom,
} from "@/client/atoms/window";
import {
  itemsOf,
  useDraftStaging,
  useFolderItems,
} from "@/client/components/draft-staging";
import { FileDropRegion } from "@/client/components/file-drop-region";
import { fileHref, folderHref } from "@/shared/computer-href";
import { type WindowTab } from "@/client/atoms/window";
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
} from "@/client/drafts/new-chat-box";
import { cancelWords } from "@/client/drafts/settle-words";
import {
  createDraftAtom,
  draftsAtom,
  removeDraftAtom,
  updateDraftAtom,
} from "@/client/drafts/store";
import { type Draft, draftGroupOf, isLeftEmpty } from "@/shared/drafts";
import { osConventions } from "@/client/lib/utils";
import { useRouter } from "@tanstack/react-router";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import {
  type ReactNode,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
} from "react";
import { ulid } from "ulid";

import { AskPills } from "./ask-pills";
import { PopOutButton } from "./chat-header";
import { type Project } from "./chats";
import { projectColor } from "./project-colors";
import { ProjectMark } from "./project-mark";
import { projectTint } from "./project-tint";
import { ProjectSlot } from "./compose-window";
import { useWindow } from "./context";
import { ContextChips } from "./context-chip";
import { appTabsAtom } from "./app-tabs";
import { putBackTakenTab } from "./take-tab";
import { type BandTarget, openInBand } from "./draft-band";
import { includedItemsOf } from "./draft-context";
import { isHomeTab } from "./tab-model";
import { tabSurfaceAtom } from "./tab-surface";
import { useShell } from "./shell-context";
import { useComposerAsks } from "./staged-asks";
import { useDraftChips } from "./use-draft-chips";
import { useDraftProjectSuggestion } from "./use-draft-project-suggestion";
import { newChatHref } from "./window-href";
import { useWindowTabs } from "./window-tabs";

/**
 * A new chat, written in the Chat screen beside the chat list: the room a
 * chat would have, with the chat's own composer at its foot and nothing made
 * until something is written in it. The draft its first words make is named
 * in the tab's address, so a draft expanded from its window, or opened from
 * Drafts, comes up here, and the pages and folders opened beside it stand in
 * the chat's side panel as the chat's would. Its head is a chat's head: the
 * project it will be filed under after its name, the pop-out under a hand,
 * and at its right whatever the screen adds.
 *
 * Emptied of everything it had (its words, what was attached, every page
 * beside it, a project picked), its draft is thrown away, so a new chat
 * opened and left leaves nothing in Drafts.
 */
export function NewChatView({
  draftId,
  ensureGroup,
  isPaneShown,
  leading,
  onOpenBeside,
  tabId,
  trailing,
}: {
  /** The draft the tab's address names, if it names one. */
  draftId: string | undefined;
  /** The group the new chat's tabs are kept under, making its draft first when it has none. */
  ensureGroup: () => string;
  /** Whether the side panel shows the draft's tab up, where its tabs stand as a strip rather than as chips. */
  isPaneShown: boolean;
  /** What sits ahead of the title: the toggle that puts the inbox away. */
  leading?: ReactNode;
  /** Brings the side panel up for something just opened into it. */
  onOpenBeside: (group: string) => void;
  tabId: string;
  /** What sits at the head's right: the pane button. */
  trailing?: ReactNode;
}) {
  const shell = useShell();
  const appWindow = useWindow();
  const appTabs = useAtomValue(appTabsAtom).tabs;
  const router = useRouter();
  const windowTabs = useWindowTabs();
  const filesHref = useAtomValue(filesHrefAtom);
  const drafts = useAtomValue(draftsAtom);
  const store = useStore();
  const boxes = useAtomValue(newChatBoxesAtom);
  const bindBox = useSetAtom(bindNewChatBoxAtom);
  const makeDraft = useSetAtom(makeNewChatDraftAtom);
  const pickProject = useSetAtom(pickNewChatProjectAtom);
  const updateDraft = useSetAtom(updateDraftAtom);
  const removeDraft = useSetAtom(removeDraftAtom);
  const snapshots = useAtomValue(draftSnapshotsAtom);
  const setSnapshots = useSetAtom(draftSnapshotsAtom);
  const createDraft = useSetAtom(createDraftAtom);
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
  // Only as the address changes; see above.
  useLayoutEffect(() => {
    followAddress();
  }, [draftId, tabId]);
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

  const group = draft ? draftGroupOf(draft.id) : undefined;
  const tabs =
    group === undefined
      ? []
      : windowTabs.allTabs.filter((tab) => tab.group === group);
  const up = isPaneShown ? windowTabs.selectedTabIn(group) : undefined;
  // What the side panel shows: the attached file or folder there has its
  // chip raised, and a second press puts the panel away.
  const shownPath = up ? includedItemsOf(up, null, [])?.[0]?.path : undefined;
  const chips = useNewChatChips(draft, {
    band: tabs.filter((tab) => !isHomeTab(tab)),
    onSelect: (id) => {
      if (group === undefined) {
        return;
      }
      // A second press of the chip the side panel shows puts the panel away.
      if (id === up?.id) {
        shell.setPaneOpen(group, false);
        return;
      }
      windowTabs.select(id);
      onOpenBeside(group);
    },
    open: (target) =>
      group === undefined
        ? undefined
        : openInBand({
            appTabs,
            browser: appWindow.browser,
            group,
            target,
            windowTabs,
          }),
    selectedId: up?.id,
  });

  // Emptied of everything it had, the draft goes, and the screen is a new
  // chat again.
  const isEmptied =
    draft !== undefined &&
    draft.sendingTo === undefined &&
    isLeftEmpty(draft, { hasTabs: tabs.length > 0 });
  useEffect(() => {
    if (!isEmptied || !draft) {
      return;
    }
    void removeDraft(draft.id);
    bindBox({ draftId: null, tabId });
    router.history.replace(newChatHref());
  }, [bindBox, draft, isEmptied, removeDraft, router, tabId]);

  const staging = useDraftStaging({
    // A paste is on disk the moment it arrives, so it makes the draft.
    draftFor: (make) => draft?.id ?? (make ? makeDraft({ tabId }) : undefined),
    onChange: (id, update) => {
      updateDraft({ id, update });
    },
  });
  useFolderItems({ draft, input: inputRef, staging });

  const projects = shell.projects;
  const liveProjects = projects.filter((entry) => !entry.retired);
  const projectId = draft?.projectId ?? boxes[tabId]?.projectId;
  const project = projects.find((entry) => entry.id === projectId);
  // Beside the list standing in the project it is filed under, the new chat
  // is that project's room, and says so.
  const listProjects = useAtomValue(chatFiltersAtom).projects;
  const roomOf =
    project && listProjects.length === 1 && listProjects[0] === project.id
      ? project
      : undefined;

  // The plus opens the web, the computer and Apps beside the new chat, in
  // the side panel, the way a chat's plus opens them beside the chat.
  const openBeside = (href: string) => {
    const opened = ensureGroup();
    windowTabs.openOrFocusScreen(href, {
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
      <div className="group/head flex h-12 w-full min-w-0 shrink-0 items-center gap-x-2 bg-background pr-3 pl-3">
        <div className="flex h-8 min-w-0 flex-1 items-center gap-x-1">
          {leading}
          <h2 className="min-w-0 truncate text-sm font-medium">New chat</h2>
          <ProjectSlot
            onClear={() => {
              if (draft) {
                updateDraft({
                  id: draft.id,
                  update: (current) => {
                    const { projectId: _dropped, ...rest } = current;
                    return { ...rest, projectSource: "chosen" };
                  },
                });
              } else {
                pickProject({ projectId: undefined, tabId });
              }
            }}
            onNew={(name) => {
              shell.onNewDraftProject(draft?.id ?? makeDraft({ tabId }), name);
            }}
            onPick={(picked) => {
              if (draft) {
                updateDraft({
                  id: draft.id,
                  update: (current) => ({
                    ...current,
                    projectId: picked.id,
                    projectSource: "chosen",
                  }),
                });
              } else {
                pickProject({ projectId: picked.id, tabId });
              }
            }}
            project={project}
            projects={liveProjects}
            suggested={draft?.projectSource === "suggested"}
          />
          <PopOutButton
            isOut={false}
            onToggle={() => {
              if (draft) {
                shell.popOutDraft(draft.id);
                return;
              }
              // A new chat with nothing in it yet pops out as a draft of
              // its own, made outside this screen's box, which would throw
              // an empty draft away.
              const now = Date.now();
              const picked = boxes[tabId]?.projectId;
              const id = ulid();
              createDraft({
                createdAt: now,
                id,
                ...(picked === undefined
                  ? {}
                  : { projectId: picked, projectSource: "chosen" }),
                updatedAt: now,
                words: "",
              });
              shell.popOutDraft(id);
            }}
          />
        </div>
        <div className="flex h-8 shrink-0 items-center gap-x-1">{trailing}</div>
      </div>
      <div className="grid min-h-0 flex-1 place-items-center overflow-hidden px-6">
        {roomOf && <ProjectRoom key={roomOf.id} project={roomOf} />}
      </div>
      <div className="isolate mx-auto w-full max-w-3xl shrink-0 px-3 pb-3">
        <PromptInput
          attachmentsLead={
            draft ? <MarkedPills draftId={draft.id} /> : undefined
          }
          autoFocus
          draftKey={key}
          isLoading={false}
          keyboardHome
          lead={chips}
          modelURI={shell.defaultModelURI}
          onFolders={(paths) => {
            for (const path of paths) {
              openBeside(folderHref(path));
            }
          }}
          onItemRemoved={staging.removeItem}
          onItemsChange={staging.keepItems}
          onShowItem={(item) => {
            if (item.path === shownPath && group !== undefined) {
              shell.setPaneOpen(group, false);
            } else {
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
            shell.startChat(id, send);
          }}
          placeholder="What do you need?"
          places={places}
          ref={inputRef}
        />
      </div>
      {draft && <ProjectSuggestion draft={draft} />}
    </FileDropRegion>
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
        New chats here go into {project.name}.
      </p>
    </div>
  );
}

/** What was marked in files and moved to the draft, as pills that go with the words. */
function MarkedPills({ draftId }: { draftId: string }) {
  const marked = useComposerAsks({ draftId, kind: "draft" });
  return marked.length > 0 ? <AskPills asks={marked} /> : null;
}

/** What a new chat with no draft yet carries: nothing. */
const NO_DRAFT: Draft = { createdAt: 0, id: "", updatedAt: 0, words: "" };

/**
 * What the draft carries besides its words, as its chips, as a docked
 * draft's window has them: every tab of its band, whether or not the side
 * panel is showing them too, each bringing the panel up on its tab when
 * pressed, the one the panel shows raised; then another chat it names. None
 * at all for a new chat with no draft yet, or with nothing to name, so the
 * row closes when its last chip goes.
 */
function useNewChatChips(
  draft: Draft | undefined,
  {
    band,
    onSelect,
    open,
    selectedId,
  }: {
    band: WindowTab[];
    onSelect: (tabId: string) => void;
    open: (target: BandTarget) => string | undefined;
    selectedId: string | undefined;
  },
): ReactNode {
  const windowTabs = useWindowTabs();
  const updateDraft = useSetAtom(updateDraftAtom);
  const surfaces = useAtomValue(tabSurfaceAtom);
  const { items, leaveOut } = useDraftChips({
    allTabs: windowTabs.allTabs,
    band,
    // A tab of the person's own goes back where it came from, if it still can.
    closeTab: (id) => {
      if (!putBackTakenTab({ tabId: id, windowTabs })) {
        windowTabs.close(id);
      }
    },
    draft: draft ?? NO_DRAFT,
    finderOf: (id) => surfaces[id]?.finder ?? null,
    inView: undefined,
    onChange: (update) => {
      if (draft) {
        updateDraft({ id: draft.id, update });
      }
    },
    open,
  });
  return draft && items.length > 0 ? (
    <ContextChips
      band={{ group: draftGroupOf(draft.id), onSelect, selectedId }}
      items={items}
      onLeaveOut={leaveOut}
    />
  ) : undefined;
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
