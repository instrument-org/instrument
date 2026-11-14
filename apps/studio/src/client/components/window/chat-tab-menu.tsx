import { type MenuComponents } from "@/client/components/ui/menu-components";
import { updateDraftAtom } from "@/client/drafts/store";
import { rpcClient } from "@/client/rpc/client";
import { folderHref } from "@/shared/computer-href";
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
import { useWindowTabs } from "./window-tabs";

/** A chat from the window's list, by its id, while the list has it. */
function useListedChat(id: ChatId): Chat | undefined {
  const { data } = useQuery({
    ...chatListOptions(),
    select: (list) => list.find((chat) => chat.id === id),
  });
  return data;
}

/**
 * A chat tab's own items, after the tab's in its menu: the chat's menu as
 * its head had it (`ChatMenuItems`), with Show Chat Folder opening the
 * folder right after the tab, renaming in the tab, and archiving closing
 * the tab.
 */
export function ChatTabItems({
  chatId,
  components,
  group,
  onArchived,
  onDelete,
  onRename,
  tabId,
}: {
  chatId: ChatId;
  components: MenuComponents;
  group: string | undefined;
  onArchived: () => void;
  onDelete: (chat: Chat) => void;
  onRename: () => void;
  tabId: string;
}) {
  const shell = useShell();
  const windowTabs = useWindowTabs();
  const chat = useListedChat(chatId);
  const { data: folder = null } = useQuery(
    rpcClient.workspace.chats.live.folderWithFiles.experimental_liveOptions({
      input: { id: chatId },
    }),
  );
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
      {...(folder === null
        ? {}
        : {
            onShowFolder: () => {
              windowTabs.openOrFocusScreen(folderHref(folder), {
                after: tabId,
                ...(group === undefined ? {} : { group }),
                select: true,
              });
            },
          })}
      projectMenu={{
        onNew: (name) => {
          shell.onNewProject(chat.id, name);
        },
        // Picking the project it is under takes it off.
        onPick: (id) => {
          shell.setChatProject(chat.id, chat.project === id ? null : id);
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
        // Picking the project it is under takes it off.
        onPick: (id) => {
          updateDraft({
            id: draft.id,
            update: (current) => {
              if (current.projectId !== id) {
                return { ...current, projectId: id, projectSource: "chosen" };
              }
              const { projectId: _dropped, ...unfiled } = current;
              return { ...unfiled, projectSource: "chosen" };
            },
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
