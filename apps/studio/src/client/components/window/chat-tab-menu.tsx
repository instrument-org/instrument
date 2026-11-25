import { type MenuComponents } from "@/client/components/ui/menu-components";
import { updateDraftAtom } from "@/client/drafts/store";
import { type Draft } from "@/shared/drafts";
import { type ChatId } from "@instrument-org/workspace/client";
import { useQuery } from "@tanstack/react-query";
import { useSetAtom } from "jotai";
import { useEffect, useRef } from "react";

import { ChatMenuItems, ProjectMenuItems } from "./chat-header";
import { chatListOptions } from "./chat-list-query";
import { ChatTitleField } from "./chat-title";
import { type Chat } from "./chats";
import { useShell } from "./shell-context";
import { useChatRename } from "./use-chat-rename";

/** A chat from the window's list, by its id, while the list has it. */
export function useListedChat(id: ChatId): Chat | undefined {
  const { data } = useQuery({
    ...chatListOptions(),
    select: (list) => list.find((chat) => chat.id === id),
  });
  return data;
}

/**
 * A chat tab's own items, after the tab's in its menu: the chat's menu as
 * its head had it (`ChatMenuItems`), with renaming in the tab and archiving
 * closing the tab.
 */
export function ChatTabItems({
  chatId,
  components,
  onArchived,
  onDelete,
  onRename,
}: {
  chatId: ChatId;
  components: MenuComponents;
  onArchived: () => void;
  onDelete: (chat: Chat) => void;
  onRename: () => void;
}) {
  const shell = useShell();
  const chat = useListedChat(chatId);
  if (!chat) {
    return null;
  }
  return (
    <ChatMenuItems
      chat={chat}
      components={components}
      onArchived={onArchived}
      onDelete={() => {
        onDelete(chat);
      }}
      onRename={onRename}
      projectMenu={{
        onNew: (name) => {
          shell.onNewProject(chat.id, name);
        },
        onPick: (id) => {
          shell.setChatProject(chat.id, id);
        },
        projects: shell.projects,
      }}
    />
  );
}

/**
 * A new chat tab's own items, after the tab's in its menu, once it has a
 * draft: Project, which files the draft, and so the chat it starts.
 */
export function DraftTabItems({
  components,
  draft,
}: {
  components: MenuComponents;
  draft: Draft;
}) {
  const shell = useShell();
  const updateDraft = useSetAtom(updateDraftAtom);
  return (
    <ProjectMenuItems
      chosen={draft.projectId}
      components={components}
      projectMenu={{
        onNew: (name) => {
          shell.onNewDraftProject(draft.id, name);
        },
        onPick: (id) => {
          updateDraft({
            id: draft.id,
            update: ({ projectId: _was, ...current }) => ({
              ...current,
              ...(id === null ? {} : { projectId: id }),
              projectSource: "chosen",
            }),
          });
        },
        projects: shell.projects,
      }}
    />
  );
}

/**
 * A chat's title as a field in its tab, open from the moment it is drawn
 * until the name is saved or left, when `onDone` takes it away.
 */
export function ChatTabRenameField({
  chatId,
  onDone,
}: {
  chatId: ChatId;
  onDone: () => void;
}) {
  const rename = useChatRename(useListedChat(chatId));
  const hasStarted = useRef(false);
  useEffect(() => {
    if (!hasStarted.current) {
      hasStarted.current = true;
      rename.start();
    } else if (!rename.isEditing) {
      onDone();
    }
  });
  if (!rename.isEditing) {
    return null;
  }
  return (
    <ChatTitleField
      className="text-sm font-medium"
      grow
      rename={rename}
      width={undefined}
    />
  );
}
