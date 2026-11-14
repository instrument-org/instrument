import { type Draft } from "@/shared/drafts";
import { openProjectDetails } from "@/client/atoms/project-details-modal";
import { chatFiltersAtom } from "@/client/atoms/window";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { type ChatId } from "@instrument-org/workspace/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAtom, useAtomValue } from "jotai";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { spokenMessage, toast } from "@/client/lib/toast";

import { useAppsBySlug } from "./apps-by-slug";
import { ChatList } from "./chat-list";
import { chatListOptions } from "./chat-list-query";
import { groupByDayAtom, rowDensityAtom } from "./chat-list-view";
import {
  byLastUserMessage,
  type Chat,
  type ChatFilters,
  draftTitle,
  hasWords,
  matchesFilters,
  outsideFilters,
  type Project,
} from "./chats";
import { FilterHead } from "./filter-head";
import { DeleteChatDialog } from "./delete-chat-dialog";
import { ProjectDialog } from "./project-dialog";
import { ProjectBanner } from "./project-banner";
import { projectColor } from "./project-colors";
import { projectTint } from "./project-tint";
import { ProjectsSection } from "./projects-section";
import { useChatSearchFallback } from "./use-chat-search-fallback";
import { useProjectShift } from "./use-project-shift";
import { useSetChatProject } from "./use-set-chat-project";
import { useShell } from "./shell-context";
import { backfillCandidates } from "./use-project-backfill";

/**
 * The chat pane: the inbox under the search and the tabs of the places a
 * chat can be. Nothing is composed here: New in the rail opens a new chat,
 * and the chat it starts lands at the top of the list; a draft saved and left
 * is a row of the Drafts place, which lists the drafts where the chats
 * otherwise go. In the inbox the projects stand above the chats, and
 * stepping into one makes the list that project, under its own head, in its
 * tint.
 */
export function ChatPane({
  arrivedId,
  drafts,
  onArchiveOpen,
  onDeleted,
  onDeleteDraft,
  onListed,
  onOpenChat,
  onOpenDraft,
  onPopOut,
  openChatId,
  outIds,
}: {
  /** The chat that just started from a draft, whose row arrives with a motion of its own. */
  arrivedId?: string;
  /** Every draft not yet started, for the Drafts place and its count. */
  drafts: Draft[];
  /** Told when the open chat is archived from its row, so the window can put the chat away with it. */
  onArchiveOpen?: () => void;
  /** Told once a chat deleted from its row is in the trash, so the window can drop its tabs and put it away if it was open. */
  onDeleted: (id: ChatId) => void;
  /** Deletes a draft outright; the caller says so and offers it back. */
  onDeleteDraft: (id: string) => void;
  /** Told the chats the list shows, in its order, whenever that changes: what a chord steps through. */
  onListed?: (ids: ChatId[]) => void;
  onOpenChat: (chat: Chat) => void;
  /** Opens a draft to go on writing it. */
  onOpenDraft: (id: string) => void;
  /** Floats a chat in a window of its own over the row, from its row. */
  onPopOut?: (chat: Chat) => void;
  /** The chat open beside the list, if one is. */
  openChatId: string | undefined;
  /** The chats already up in a window of their own. */
  outIds?: ReadonlySet<string>;
}) {
  const appsBySlug = useAppsBySlug();
  const shell = useShell();
  const chatsQuery = useQuery(chatListOptions());
  const projectsQuery = useQuery(
    rpcClient.workspace.projects.list.queryOptions(),
  );
  const chats: Chat[] = chatsQuery.data ?? [];
  const projects: Project[] = projectsQuery.data ?? [];
  const afterProjectChange = {
    onError: (error: Error) => {
      // A name a project can't take comes back in words written for people.
      toast.error("Couldn't change the project", {
        cause: error,
        description: spokenMessage(error, ["BAD_REQUEST"]),
      });
    },
    onSuccess: () => void projectsQuery.refetch(),
  };
  const createProject = useMutation(
    rpcClient.workspace.projects.create.mutationOptions(afterProjectChange),
  );
  const setChatProject = useSetChatProject();

  const [filters, setFilters] = useAtom(chatFiltersAtom);
  const density = useAtomValue(rowDensityAtom);
  const groupByDay = useAtomValue(groupByDayAtom);
  // A change of filter is a change of subject, and the newest of the new
  // subject is what matters, so the list is taken back to its top with it.
  // Read off the filters rather than counted here, because the pane is not
  // the only thing that changes them: the command menu stands it in a project.
  const scrollSignal = JSON.stringify(filters);
  const projectNames = new Map(
    projects.map((project) => [project.id, project.name]),
  );
  const viewKey = JSON.stringify({ ...filters, search: "" });
  // A chat the Unread view listed stays in it once read, opening it above
  // all, until the view changes: a row leaving under the pointer reads as
  // the chat going missing.
  const [listedUnread, setListedUnread] = useState<{
    ids: ReadonlySet<string>;
    view: string;
  }>();
  const isUnreadView = filters.tags.includes("unread");
  const keptUnread =
    isUnreadView && listedUnread?.view === viewKey ? listedUnread.ids : NO_IDS;
  const withoutUnread = {
    ...filters,
    tags: filters.tags.filter((tag) => tag !== "unread"),
  };
  const matched = chats.filter(
    (chat) =>
      matchesFilters(chat, filters, projectNames) ||
      (keptUnread.has(chat.id) &&
        matchesFilters(chat, withoutUnread, projectNames)),
  );
  if (!isUnreadView) {
    if (listedUnread !== undefined) {
      setListedUnread(undefined);
    }
  } else if (
    listedUnread?.view !== viewKey ||
    matched.some((chat) => !keptUnread.has(chat.id))
  ) {
    setListedUnread({
      ids: new Set([...keptUnread, ...matched.map((chat) => chat.id)]),
      view: viewKey,
    });
  }
  const outside = outsideFilters(chats, filters, projectNames);
  // The matches outside the filter, once asked for, are shown under the
  // list's own for as long as the same view is searched; the view itself
  // stays where it is. Kept by the view they were asked for in, so another
  // view or a cleared search folds them away.
  const [widenedIn, setWidenedIn] = useState<string>();
  const isSearching = filters.search.trim() !== "";
  const isNarrowed = isSearching || filters.tags.length > 0;
  if (widenedIn !== undefined && (!isSearching || widenedIn !== viewKey)) {
    setWidenedIn(undefined);
  }
  const shownOutside = widenedIn === viewKey ? outside : [];
  // Words that turn up in no chat anywhere are handed to the decision
  // model, which reads the chats the other filters keep for the one the
  // search means; its finds stand in the list's place, under a line saying
  // where they came from.
  const aiSearch = useChatSearchFallback({
    active:
      filters.place !== "drafts" &&
      filters.search.trim() !== "" &&
      matched.length === 0 &&
      outside.length === 0,
    candidates: chats.filter((chat) =>
      matchesFilters(chat, { ...filters, search: "" }, projectNames),
    ),
    search: filters.search,
  });
  const isAISearch = aiSearch.isLooking || aiSearch.chats.length > 0;
  const shown = matched.length > 0 ? matched : aiSearch.chats;
  const listed = [
    ...byLastUserMessage(shown),
    ...byLastUserMessage(shownOutside),
  ].map((chat) => chat.id);
  // Keyed by value: the list is rebuilt on every read of the chats, and
  // the callback is written fresh each render; the ids are what matter.
  const listedKey = listed.join("\n");
  const reportListed = useEffectEvent(() => {
    onListed?.(listed);
  });
  useEffect(() => {
    reportListed();
  }, [listedKey]);
  // Standing in Drafts, the list holds the drafts, narrowed by the same
  // search: by their words and the name of the project each is filed under.
  const shownDrafts =
    filters.place === "drafts"
      ? drafts.filter((draft) =>
          hasWords(filters.search, [
            draftTitle(draft.words),
            draft.words,
            projectNames.get(draft.projectId ?? "") ?? "",
          ]),
        )
      : undefined;
  // One project chosen is the place the pane is standing in: the banner names
  // it.
  const chosenProject =
    filters.projects.length === 1
      ? projects.find((project) => project.id === filters.projects[0])
      : undefined;
  // The head and the rows slide in together as the list steps into a
  // project or back out of one.
  const shiftRef = useRef<HTMLDivElement>(null);
  useProjectShift(shiftRef, chosenProject?.id);
  // The wash keeps the last project's color while it fades out, since the
  // column's own tint goes the moment the list leaves.
  const [lastProject, setLastProject] = useState<Project>();
  if (chosenProject && chosenProject !== lastProject) {
    setLastProject(chosenProject);
  }
  const washProject = chosenProject ?? lastProject;

  // Whether the new-project dialog is up, and for which chat when a row
  // opened it: a project made from a row is filed on that chat as it lands,
  // since that is what asking for one there means; one made from the head's
  // picker is the project the list then stands in, since that is what picking
  // it means.
  const [newProject, setNewProject] = useState<{
    forChat?: Chat;
    name?: string;
  }>();
  // The chat whose row asked to delete it, by id, so a re-read of the list
  // does not close the dialog under the user.
  const [deletingId, setDeletingId] = useState<string>();
  const deletingChat = chats.find((chat) => chat.id === deletingId);

  return (
    // Its own stacking context, so the project's wash can sit under the rows
    // without going under the card. The rows stop a pixel short of the
    // column's edge, where its line is drawn over them, so two see-through
    // hairlines never cross; the wash, placed against the padding box,
    // still reaches under the line.
    <div
      className={cn(
        "relative isolate flex h-full min-h-0 min-w-0 flex-col pr-px",
        chosenProject && "project-tint",
      )}
      data-project={chosenProject ? "" : undefined}
      style={
        chosenProject ? projectTint(projectColor(chosenProject)) : undefined
      }
    >
      {/* While the list is one project, its tint washes down from the
          card's edge and fades out past the head, behind the first rows;
          sized against the whole column, so a taller window washes further
          down it. */}
      {washProject && (
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-x-0 top-0 -z-10 h-[calc(20%+14rem)] bg-linear-to-b from-(--project-tint-surface)/50 to-transparent transition-opacity duration-300 ease-out project-tint motion-reduce:transition-none dark:from-(--project-tint-surface)/25 starting:opacity-0",
            !chosenProject && "opacity-0",
          )}
          style={projectTint(projectColor(washProject))}
        />
      )}
      <div className="flex min-h-0 flex-1 flex-col" ref={shiftRef}>
        <FilterHead
          chats={chats}
          filters={filters}
          onFiltersChange={setFilters}
          onLeaveProject={shell.leaveProject}
          project={chosenProject}
        />
        {isAISearch && (
          <p className="shrink-0 px-4 pt-2 pb-1 text-xs font-medium text-muted-foreground">
            AI results
          </p>
        )}
        <ChatList
          appsBySlug={appsBySlug}
          arrivedId={arrivedId}
          chats={shown}
          density={density}
          drafts={shownDrafts}
          groupByDay={groupByDay && shownDrafts === undefined}
          head={
            chosenProject
              ? {
                  node: (
                    <ProjectBanner
                      onDetails={(project) => {
                        openProjectDetails(project.id);
                      }}
                      onOpenInFiles={shell.openProjectInFiles}
                      project={chosenProject}
                    />
                  ),
                }
              : filters.place === undefined &&
                  filters.apps.length === 0 &&
                  !isNarrowed &&
                  projects.some((project) => !project.retired)
                ? {
                    heading: "Chats",
                    node: (
                      <ProjectsSection
                        chats={chats}
                        onChoose={(project) => {
                          shell.openProject(project.id);
                        }}
                        onDetails={(project) => {
                          openProjectDetails(project.id);
                        }}
                        onNew={() => {
                          setNewProject({});
                        }}
                        projects={projects}
                      />
                    ),
                  }
                : undefined
          }
          isProjectShown={chosenProject === undefined}
          emptyLine={
            aiSearch.isLooking
              ? "Looking through your chats…"
              : emptyLineFor(filters, chats.length, chosenProject)
          }
          // The drafts are kept on this computer, so they are never on
          // their way.
          isLoading={shownDrafts === undefined && chatsQuery.data === undefined}
          onArchiveOpen={onArchiveOpen}
          onDelete={(chat) => {
            setDeletingId(chat.id);
          }}
          onDeleteDraft={onDeleteDraft}
          onNewProject={(chat, name) => {
            setNewProject({ forChat: chat, ...(name ? { name } : {}) });
          }}
          onOpen={onOpenChat}
          onOpenDraft={onOpenDraft}
          onPopOut={onPopOut}
          onSetProject={(chat, next) => {
            setChatProject(chat.id, next);
          }}
          onWiden={() => {
            setWidenedIn(viewKey);
          }}
          openId={openChatId}
          outIds={outIds}
          outside={outside.length}
          outsideChats={shownOutside}
          scrollSignal={scrollSignal}
          // The decision model's finds are not matches of the words, so
          // nothing on them is marked.
          search={isAISearch ? "" : filters.search}
          projects={projects}
        />
      </div>
      {deletingChat && (
        <DeleteChatDialog
          chat={deletingChat}
          onDeleted={() => {
            onDeleted(deletingChat.id);
          }}
          onOpenChange={(open) => {
            if (!open) {
              setDeletingId(undefined);
            }
          }}
          open
        />
      )}
      <ProjectDialog
        candidates={backfillCandidates(
          chats.filter((chat) => chat.id !== newProject?.forChat?.id),
        )}
        mode="create"
        {...(newProject?.name ? { name: newProject.name } : {})}
        onCreate={(project, alsoFile) => {
          const forChat = newProject?.forChat;
          createProject.mutate(project, {
            onSuccess: (created) => {
              // Chats offered were filed under nothing, so the new project
              // is all they carry.
              for (const id of alsoFile) {
                setChatProject(id, created.id);
              }
              if (forChat) {
                setChatProject(forChat.id, created.id);
                return;
              }
              shell.openProject(created.id);
            },
          });
        }}
        onOpenChange={(open) => {
          if (!open) {
            setNewProject(undefined);
          }
        }}
        open={newProject !== undefined}
        // A retired project's name brings it back, so only the ones in use
        // are names a new project cannot take.
        otherNames={projects.flatMap((project) =>
          project.retired ? [] : [project.name],
        )}
        taken={projects.flatMap((project) =>
          project.emoji ? [project.emoji] : [],
        )}
      />
    </div>
  );
}

const NO_IDS: ReadonlySet<string> = new Set();

/** What the list says when it has nothing to show, by where the column stands. */
function emptyLineFor(
  filters: ChatFilters,
  total: number,
  project: Project | undefined,
): string {
  const search = filters.search.trim();
  if (search !== "") {
    return `No chats match “${search}”`;
  }
  if (filters.place === "drafts") {
    return "You don't have any drafts right now";
  }
  if (filters.tags.includes("unread")) {
    return "You're all caught up";
  }
  if (filters.tags.includes("starred")) {
    return "Chats you star will show up here";
  }
  if (filters.place === "archived") {
    return "Chats you archive will show up here";
  }
  if (project) {
    return `Chats you file under ${project.name} will show up here`;
  }
  return total === 0 ? "Press New to start a chat" : "There's nothing here yet";
}
