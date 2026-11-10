import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import {
  chatChangesByChat,
  chatChangesHeading,
  type ChatId,
  type SessionMessageDataPart,
} from "@instrument-org/workspace/client";
import { BroomIcon } from "@phosphor-icons/react/Broom";
import { ChatCircleIcon } from "@phosphor-icons/react/ChatCircle";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useContext, useState } from "react";

import { ChangeCard, SHOWN_ROWS, useChangeCardUndo } from "./change-card";
import { type ChangesCard } from "./project-changes-card";
import { type Chat, type Project } from "./window/chats";
import { chatListOptions } from "./window/chat-list-query";
import { WindowContext } from "./window/context";
import { projectColor } from "./window/project-colors";
import { projectTint } from "./window/project-tint";
import { chatHref } from "./window/window-href";

type ChatChange = SessionMessageDataPart.ChatChange;

/**
 * What a turn did to the person's chats, as a card under the reply: a
 * heading drawn from the changes ("Archived 2 chats", "Organized 5 chats"),
 * then each chat it touched with a line per change, which opens that chat.
 * Undo puts back whatever still stands as the turn left it, and the card
 * then shows every change struck through.
 */
export function ChatChangesNote({
  card,
  changes,
  undone: undoneBefore = false,
}: {
  /** Where the card is, for its Undo to mark it undone on every device. */
  card?: ChangesCard;
  changes: ChatChange[];
  /** Undone already, by this device or another. */
  undone?: boolean;
}) {
  const appWindow = useContext(WindowContext);
  const { data: chats } = useQuery(chatListOptions());
  const { data: projects = [] } = useQuery(
    rpcClient.workspace.projects.list.queryOptions(),
  );
  const [expanded, setExpanded] = useState(false);
  const { undo, undone, undoing } = useChangeCardUndo({
    call: () =>
      rpcClient.workspace.chats.undoChanges.call({
        ...(card && { card }),
        changes,
      }),
    said: {
      all: "Your chats are back the way they were.",
      some: "Your chats are back the way they were, except the ones you changed since.",
    },
    undoneBefore,
  });

  const rows = new Map(chats?.map((chat) => [chat.id, chat]));
  // A change the person has since changed themselves is theirs, and stays.
  const standing = changes.filter((change) => {
    const row = rows.get(change.chat);
    return row !== undefined && stillStands(change, row);
  });

  const byChat = chatChangesByChat(changes);
  const shown = expanded ? byChat : byChat.slice(0, SHOWN_ROWS);

  return (
    <ChangeCard
      heading={chatChangesHeading(changes)}
      hidden={byChat.length - shown.length}
      icon={BroomIcon}
      onShowMore={() => {
        setExpanded(true);
      }}
      slot="chat-changes"
      {...(standing.length > 0 && {
        undo: {
          busy: undoing,
          onUndo: () => {
            void undo();
          },
        },
      })}
      undone={undone}
    >
      {shown.map(({ changes: chatChanges, chat }) => (
        <ChatRow
          changes={chatChanges}
          key={chat}
          {...(appWindow && {
            onOpen: () => {
              appWindow.openScreen(chatHref(chat));
            },
          })}
          projects={projects}
          row={rows.get(chat)}
          title={titleOf(chat, chatChanges, rows.get(chat))}
          undone={undone}
        />
      ))}
    </ChangeCard>
  );
}

/** Whether a chat still has what the change set, as the list has it now. */
function stillStands(change: ChatChange, row: Chat) {
  switch (change.field) {
    case "title": {
      return row.title === change.after;
    }
    case "archived": {
      return row.archived === change.after;
    }
    case "starred": {
      return row.starred === change.after;
    }
    case "project": {
      return (row.project ?? null) === change.after;
    }
  }
}

/** A chat's title as the list has it, else the last one the turn gave it. */
function titleOf(chat: ChatId, changes: ChatChange[], row: Chat | undefined) {
  if (row?.title) {
    return row.title;
  }
  const renamed = changes.findLast((change) => change.field === "title");
  return renamed?.after ?? chat;
}

/** One chat the turn touched: its title, then a line for each change. */
function ChatRow({
  changes,
  onOpen,
  projects,
  row,
  title,
  undone,
}: {
  changes: ChatChange[];
  onOpen?: () => void;
  projects: readonly Project[];
  row: Chat | undefined;
  title: string;
  undone: boolean;
}) {
  // An archived chat reads as put away, as it does in the list.
  const away = !undone && row?.archived === true;
  const titleClassName = cn(
    "min-w-0 truncate text-sm leading-5",
    undone && "line-through",
    away || undone ? "text-muted-foreground" : "text-foreground",
  );
  return (
    <li className="py-3">
      <span className="flex min-w-0 items-center gap-2">
        <span className="flex h-5 w-4 shrink-0 items-center justify-center">
          <ChatCircleIcon
            className={cn(
              "size-3.75",
              away || undone
                ? "text-muted-foreground/50"
                : "text-muted-foreground/80",
            )}
          />
        </span>
        {onOpen ? (
          <button
            className={cn(titleClassName, "text-left hover:underline")}
            onClick={onOpen}
            type="button"
          >
            {title}
          </button>
        ) : (
          <span className={titleClassName}>{title}</span>
        )}
      </span>
      <span className="mt-1 flex flex-col gap-0.5 pl-6">
        {changes.map((change) => (
          <span
            className={cn(
              "min-w-0 truncate text-xs leading-4",
              undone && "line-through",
              away || undone
                ? "text-muted-foreground/80"
                : "text-muted-foreground",
            )}
            key={change.field}
          >
            {changeWords(change, projects, undone)}
          </span>
        ))}
      </span>
    </li>
  );
}

/** What one change did to a chat: "Moved to Travel", "Renamed from “Trip”". */
function changeWords(
  change: ChatChange,
  projects: readonly Project[],
  undone: boolean,
): ReactNode {
  switch (change.field) {
    case "title": {
      return (
        <>
          Renamed from{" "}
          <span className="text-muted-foreground/80">“{change.before}”</span>
        </>
      );
    }
    case "archived": {
      return change.after ? "Archived" : "Unarchived";
    }
    case "starred": {
      return change.after ? "Starred" : "Unstarred";
    }
    case "project": {
      return change.after === null ? (
        <>
          Removed from{" "}
          <ProjectName id={change.before} projects={projects} undone={undone} />
        </>
      ) : (
        <>
          Moved to{" "}
          <ProjectName id={change.after} projects={projects} undone={undone} />
        </>
      );
    }
  }
}

/** A project's name in its own ink, or "a project" for one that is gone. */
function ProjectName({
  id,
  projects,
  undone,
}: {
  id: null | string;
  projects: readonly Project[];
  undone: boolean;
}) {
  const project = projects.find((each) => each.id === id);
  if (!project) {
    return "a project";
  }
  return (
    <span
      className={cn(
        "font-medium",
        !undone && "text-(--project-tint-ink) project-tint",
      )}
      style={undone ? undefined : projectTint(projectColor(project))}
    >
      {project.name}
    </span>
  );
}
