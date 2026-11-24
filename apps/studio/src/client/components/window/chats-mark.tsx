import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/client/components/ui/popover";
import { rpcClient } from "@/client/rpc/client";
import { type ChatId } from "@instrument-org/workspace/client";
import { CaretDownIcon } from "@phosphor-icons/react/CaretDown";
import { ChatsCircleIcon } from "@phosphor-icons/react/ChatsCircle";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { useAppsBySlug } from "./apps-by-slug";
import { type OpenAddress, bookmarkClicks } from "./bookmark-menu";
import { useChatActionsFor } from "./chat-actions";
import { chatListOptions } from "./chat-list-query";
import { chatDotOf, ChatMarkIcon } from "./chat-mark";
import { ChatRow } from "./chat-row";
import { byLastUserMessage, type Chat } from "./chats";
import { useShowChatGroup } from "./chat-group";
import { DeleteChatDialog } from "./delete-chat-dialog";
import { ScreenMark } from "./pane-tabs";
import { useShell } from "./shell-context";
import { useNow } from "./use-now";
import { useSetChatProject } from "./use-set-chat-project";
import { CHATS_INDEX_HREF, chatHref } from "./window-href";

/** How many chats the menu lists, newest first. */
const RECENT_CHATS_SHOWN = 12;

/**
 * Chats at the bookmarks bar's start, ahead of Files: a press opens the
 * Chats page, as a bookmark opens (`bookmarkClicks`), and the caret beside
 * it lists the chats talked to last, newest first, each in the chat list's
 * one-line row. A pick brings up the tab group that chat is in, open or
 * closed (`useShowChatGroup`), and a chat in neither opens in this tab.
 */
export function ChatsMark({ open }: { open: OpenAddress }) {
  const [isOpen, setOpen] = useState(false);
  const [deleting, setDeleting] = useState<Chat>();
  const { data } = useQuery(chatListOptions());
  const showChatGroup = useShowChatGroup();
  const recent = byLastUserMessage(
    (data ?? []).filter((chat) => !chat.archived),
  ).slice(0, RECENT_CHATS_SHOWN);
  return (
    <div className="flex h-6 shrink-0 items-center rounded-md text-xs text-foreground/80 has-data-[state=open]:bg-foreground/8 has-[button:hover]:bg-foreground/5">
      <button
        className="flex h-6 cursor-default items-center gap-1.5 rounded-l-md pr-1 pl-1.5 hover:bg-foreground/8 hover:text-foreground"
        {...bookmarkClicks(CHATS_INDEX_HREF, open)}
        type="button"
      >
        <ChatsCircleIcon className="size-3.5 shrink-0 text-foreground/70" />
        Chats
      </button>
      <Popover onOpenChange={setOpen} open={isOpen}>
        <PopoverTrigger
          aria-label="Open a recent chat"
          className="grid h-6 w-4.5 cursor-default place-items-center rounded-r-md text-foreground/60 hover:bg-foreground/8 hover:text-foreground data-[state=open]:text-foreground"
        >
          <CaretDownIcon className="size-2.5" weight="bold" />
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="flex w-80 flex-col overflow-y-auto p-1"
          maxHeight="480px"
        >
          {recent.length === 0 ? (
            <p className="px-2.5 py-2 text-[13px] text-muted-foreground">
              Chats you start show up here.
            </p>
          ) : (
            recent.map((chat) => (
              <RecentChatRow
                chat={chat}
                key={chat.id}
                onDelete={() => {
                  setDeleting(chat);
                }}
                onOpen={() => {
                  setOpen(false);
                  if (!showChatGroup(chat.id)) {
                    open(chatHref(chat.id));
                  }
                }}
              />
            ))
          )}
        </PopoverContent>
      </Popover>
      {deleting && (
        <DeleteChatDialog
          chat={deleting}
          onDeleted={() => {
            setDeleting(undefined);
          }}
          onOpenChange={(isShown) => {
            if (!isShown) {
              setDeleting(undefined);
            }
          }}
          open
        />
      )}
    </div>
  );
}

/** One chat of the menu: the chat list's row at one line, with no controls, led by the chat's mark. */
function RecentChatRow({
  chat,
  onDelete,
  onOpen,
}: {
  chat: Chat;
  onDelete: () => void;
  onOpen: () => void;
}) {
  const shell = useShell();
  const appsBySlug = useAppsBySlug();
  const actionsFor = useChatActionsFor();
  const setChatProject = useSetChatProject();
  const now = useNow();
  const projects =
    useQuery(rpcClient.workspace.projects.list.queryOptions()).data ?? [];
  return (
    <ChatRow
      actions={actionsFor(chat)}
      appsBySlug={appsBySlug}
      chat={chat}
      density="one"
      isOpen={false}
      isPlain
      mark={
        <ChatMarkIcon
          dot={chatDotOf(chat)}
          icon={
            <span className="grid size-3.5 shrink-0 place-items-center [&_svg]:size-3.5">
              <ScreenMark
                appsBySlug={appsBySlug}
                chatId={undefined}
                chatTitles={NO_TITLES}
                href={chatHref(chat.id)}
              />
            </span>
          }
        />
      }
      now={now}
      onDelete={onDelete}
      onNewProject={(name) => {
        shell.onNewProject(chat.id, name);
      }}
      onOpen={onOpen}
      onSetProject={(next) => {
        setChatProject(chat.id, next);
      }}
      projects={projects}
    />
  );
}

/** The menu's marks name no chat: a chat's mark is the same whatever its title. */
const NO_TITLES = new Map<ChatId, string>();
