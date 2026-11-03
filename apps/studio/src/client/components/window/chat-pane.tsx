import { type Draft } from "@/shared/drafts";
import { openProjectDetails } from "@/client/atoms/project-details-modal";
import { chatFiltersAtom } from "@/client/atoms/window";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { type ChatId } from "@instrument-org/workspace/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAtom } from "jotai";
import { useEffect, useState } from "react";
import { spokenMessage, toast } from "@/client/lib/toast";

import { useAppsBySlug } from "./apps-by-slug";
import { ChatList } from "./chat-list";
import { chatListOptions } from "./chat-list-query";
import {
  byLastUserMessage,
  type Chat,
  type ChatFilters,
  draftTitle,
  hasWords,
  matchesFilters,
  outsideFilters,
  type Project,
  widenToSearch,
} from "./chats";
import { FilterHead } from "./filter-head";
import { DeleteChatDialog } from "./delete-chat-dialog";
import { ProjectDialog } from "./project-dialog";
import { ProjectBanner } from "./project-banner";
import { projectColor } from "./project-colors";
import { projectTint } from "./project-tint";
import { useChatSearchFallback } from "./use-chat-search-fallback";
import { useSetChatProject } from "./use-set-chat-project";
import { backfillCandidates } from "./use-project-backfill";

/**
 * The chat pane: the inbox under the line that says where it stands and
 * searches it. Nothing is composed here: New in the rail opens
 * a draft, and the chat it starts lands at the top of the list; until it
 * is started it is a row of the Drafts place, which lists the drafts where
 * the chats otherwise go. With one project chosen in the head, the project's
 * banner stands above the rows.
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
  // A change of filter is a change of subject, and the newest of the new
  // subject is what matters, so the list is taken back to its top with it.
  // Read off the filters rather than counted here, because the pane is not
  // the only thing that changes them: the command menu stands it in a project.
  const scrollSignal = JSON.stringify(filters);
  const projectNames = new Map(
    projects.map((project) => [project.id, project.name]),
  );
  const matched = chats.filter((chat) =>
    matchesFilters(chat, filters, projectNames),
  );
  const outside = outsideFilters(chats, filters, projectNames);
  // Words that turn up in no chat anywhere are handed to the decision
  // model, which reads the chats the other filters keep for the one the
  // search means; its finds stand in the list's place, under a line saying
  // where they came from.
  const aiSearch = useChatSearchFallback({
    active:
      filters.place !== "drafts" &&
      filters.search.trim() !== "" &&
      matched.length === 0 &&
      outside === 0,
    candidates: chats.filter((chat) =>
      matchesFilters(chat, { ...filters, search: "" }, projectNames),
    ),
    search: filters.search,
  });
  const isAISearch = aiSearch.isLooking || aiSearch.chats.length > 0;
  const shown = matched.length > 0 ? matched : aiSearch.chats;
  const listed = byLastUserMessage(shown).map((chat) => chat.id);
  // Keyed by value: the list is rebuilt on every read of the chats, and
  // the callback is written fresh each render; the ids are what matter.
  const listedKey = listed.join("\n");
  useEffect(() => {
    onListed?.(listed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      className="relative isolate flex h-full min-h-0 min-w-0 flex-col pr-px"
      data-project={chosenProject ? "" : undefined}
      data-find-surface
    >
      {/* The head, and while the list is one project, the project's own line
          under it, with the project's tint washing down from the card's edge
          and fading out past the head, behind the first rows. */}
      <div
        className={cn("shrink-0", chosenProject && "project-tint")}
        style={
          chosenProject ? projectTint(projectColor(chosenProject)) : undefined
        }
      >
        {/* Sized against the whole column, so a taller window washes
            further down it. */}
        {chosenProject && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[calc(20%+14rem)] bg-linear-to-b from-(--project-tint-surface)/50 to-transparent dark:from-(--project-tint-surface)/25"
          />
        )}
        <FilterHead
          chats={chats}
          drafts={drafts.length}
          filters={filters}
          onFiltersChange={setFilters}
          onNewProject={() => {
            setNewProject({});
          }}
          onProjectDetails={(project) => {
            openProjectDetails(project.id);
          }}
          projects={projects}
        />
        {chosenProject && (
          <ProjectBanner
            onDetails={(project) => {
              openProjectDetails(project.id);
            }}
            project={chosenProject}
          />
        )}
      </div>
      {isAISearch && (
        <p className="shrink-0 px-4 pt-2 pb-1 text-xs font-medium text-muted-foreground">
          AI results
        </p>
      )}
      <ChatList
        appsBySlug={appsBySlug}
        arrivedId={arrivedId}
        chats={shown}
        drafts={shownDrafts}
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
          setFilters(widenToSearch(filters));
        }}
        openId={openChatId}
        outIds={outIds}
        outside={outside}
        scrollSignal={scrollSignal}
        // The decision model's finds are not matches of the words, so
        // nothing on them is marked.
        search={isAISearch ? "" : filters.search}
        projects={projects}
      />
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
              // Read at the moment it lands rather than from the render
              // that opened the dialog: the search may have moved since.
              setFilters((current) => ({
                ...current,
                apps: [],
                projects: [created.id],
              }));
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
  if (filters.place === "unread") {
    return "You're all caught up";
  }
  if (filters.place === "starred") {
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
