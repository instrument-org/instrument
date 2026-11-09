import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/client/components/ui/popover";
import { toast } from "@/client/lib/toast";
import { rpcClient } from "@/client/rpc/client";
import {
  type ChatChangeGroup,
  chatChangeGroups,
  chatChangeGroupWords,
  type ChatId,
  type SessionMessageDataPart,
} from "@instrument-org/workspace/client";
import { ChatsIcon } from "@phosphor-icons/react/Chats";
import { useQuery } from "@tanstack/react-query";
import { Fragment, useContext, useState } from "react";

import { chatListOptions } from "./window/chat-list-query";
import { WindowContext } from "./window/context";
import { chatHref } from "./window/window-href";

type ChatChange = SessionMessageDataPart.ChatChange;

const LINK_CLASS_NAME =
  "font-medium text-foreground underline-offset-2 hover:underline";

/**
 * What a turn did to the person's chats, on one line in the voice of the
 * other notes under a reply: "Renamed 12 chats · Archived 4 · Filed 9 under
 * Travel". Each group opens the chats it names, a single chat opens itself,
 * and Undo puts back whatever still stands as the turn left it.
 */
export function ChatChangesNote({ changes }: { changes: ChatChange[] }) {
  const appWindow = useContext(WindowContext);
  const { data: chats } = useQuery(chatListOptions());
  const { data: projects = [] } = useQuery(
    rpcClient.workspace.projects.list.queryOptions(),
  );
  const [undoing, setUndoing] = useState(false);
  const [undone, setUndone] = useState(false);

  const rows = new Map(chats?.map((chat) => [chat.id, chat]));
  // A change the person has since changed themselves is theirs, and stays.
  const standing = changes.filter((change) => {
    const row = rows.get(change.chat);
    if (!row) {
      return false;
    }
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
  });

  const undo = () => {
    setUndoing(true);
    return rpcClient.workspace.chats.undoChanges
      .call({ changes })
      .then(({ skipped, undone: count }) => {
        if (count === 0) {
          toast.info("There was nothing left to undo.");
          return;
        }
        setUndone(true);
        toast.success(
          skipped === 0
            ? "Your chats are back the way they were."
            : "Your chats are back the way they were, except the ones you changed since.",
        );
      })
      .catch((error: unknown) => {
        toast.error("Couldn't undo that", { cause: error });
      })
      .finally(() => {
        setUndoing(false);
      });
  };

  const titleOf = (change: ChatChange) =>
    rows.get(change.chat)?.title ??
    (change.field === "title" ? change.after : change.chat);

  return (
    <p className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
      <ChatsIcon className="size-3.5 shrink-0" />
      {chatChangeGroups(changes).map((group, index) => (
        <Fragment key={group.key}>
          {index > 0 && <span aria-hidden>·</span>}
          <GroupWords
            group={group}
            {...(appWindow && {
              onOpen: (chat: ChatId) => {
                appWindow.openScreen(chatHref(chat));
              },
            })}
            titleOf={titleOf}
            words={chatChangeGroupWords(group, {
              first: index === 0,
              ...projectNameOf(group, projects),
            })}
          />
        </Fragment>
      ))}
      {undone ? (
        <span className="ml-1">Undone</span>
      ) : (
        standing.length > 0 && (
          <button
            className={`ml-1 ${LINK_CLASS_NAME} disabled:opacity-50`}
            disabled={undoing}
            onClick={() => {
              void undo();
            }}
            type="button"
          >
            Undo
          </button>
        )
      )}
    </p>
  );
}

function projectNameOf(
  group: ChatChangeGroup,
  projects: readonly { id: string; name: string }[],
) {
  const name = projects.find((project) => project.id === group.project)?.name;
  return name === undefined ? {} : { projectName: name };
}

/**
 * One group's words. With somewhere to open a chat, the words of a single
 * chat open it, and the words of several open the list of them.
 */
function GroupWords({
  group,
  onOpen,
  titleOf,
  words,
}: {
  group: ChatChangeGroup;
  onOpen?: (chat: ChatId) => void;
  titleOf: (change: ChatChange) => string;
  words: string;
}) {
  const [first] = group.changes;
  if (!onOpen || !first) {
    return <span>{words}</span>;
  }
  if (group.changes.length === 1) {
    return (
      <button
        className={LINK_CLASS_NAME}
        onClick={() => {
          onOpen(first.chat);
        }}
        type="button"
      >
        {words}
      </button>
    );
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className={LINK_CLASS_NAME} type="button">
          {words}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="flex max-h-72 w-72 flex-col overflow-y-auto p-1"
      >
        {group.changes.map((change) => (
          <button
            className="truncate rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
            key={change.chat}
            onClick={() => {
              onOpen(change.chat);
            }}
            type="button"
          >
            {titleOf(change)}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
