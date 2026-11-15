import { openBuiltInPage } from "@/client/atoms/page-requests";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/client/components/ui/popover";
import { type ChatId } from "@instrument-org/workspace/client";
import { CaretUpIcon } from "@phosphor-icons/react/CaretUp";
import { useQuery } from "@tanstack/react-query";
import { atom, useAtom, useAtomValue, useStore } from "jotai";
import { useEffect, useEffectEvent, useState } from "react";

import { activeChats } from "./active-chats";
import { useAppsBySlug } from "./apps-by-slug";
import { useChatActionsFor } from "./chat-actions";
import { chatListOptions } from "./chat-list-query";
import { ChatRow } from "./chat-row";
import { type Chat, type Project } from "./chats";
import { DeleteChatDialog } from "./delete-chat-dialog";
import { useTabGroupActions } from "./tab-groups";
import { selectedTabIn } from "./tab-model";
import { useNow } from "./use-now";
import { useSetChatProject } from "./use-set-chat-project";
import { CHATS_INDEX_HREF, chatHref } from "./window-href";
import { useWindowTabs, windowTabsAtom } from "./window-tabs";

/** How many chats the list shows before the rest wait behind its More row. */
const SHOWN = 3;

/**
 * The chats that want a look with no tab in this window (`activeChats`),
 * over the sidebar's foot: a question waiting, a reply not yet seen, or work
 * still going. Up to three rows, drawn as the Chats page draws them, then a
 * row that opens the whole list above it. Takes no room while none do.
 */
export function ActiveChatsList({
  onNewProject,
  projects,
}: {
  /** Opens the new-project dialog for a chat, with the name typed in the picker when anything was. */
  onNewProject: (chat: ChatId, name?: string) => void;
  projects: Project[];
}) {
  const chats = useActiveChats();
  const [isMoreOpen, setMoreOpen] = useState(false);
  const [deleting, setDeleting] = useState<Chat>();
  const openTab = useOpenChatTab();
  if (chats.length === 0) {
    return null;
  }
  const row = (chat: Chat) => (
    <ActiveChatRow
      chat={chat}
      key={chat.id}
      onDelete={() => {
        setDeleting(chat);
      }}
      onNewProject={(name) => {
        onNewProject(chat.id, name);
      }}
      onOpen={() => {
        setMoreOpen(false);
        openTab(chat.id);
      }}
      projects={projects}
    />
  );
  const rest = chats.length - SHOWN;
  return (
    <section aria-label="Chats" className="flex shrink-0 flex-col px-2 pt-1">
      <button
        className="flex h-7 w-fit shrink-0 items-center rounded-md px-2.5 text-[12px] font-medium text-muted-foreground hover:text-foreground"
        onClick={() => {
          openBuiltInPage(CHATS_INDEX_HREF);
        }}
        type="button"
      >
        Chats
      </button>
      {/* The rows draw their own hairlines, and the foot's line closes the last. */}
      <div className="flex flex-col *:last:border-b-0">
        {chats.slice(0, SHOWN).map(row)}
      </div>
      {rest > 0 && (
        <Popover onOpenChange={setMoreOpen} open={isMoreOpen}>
          <PopoverTrigger asChild>
            <button
              className="mb-1 flex h-8 w-full shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-medium text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
              type="button"
            >
              <CaretUpIcon className="size-3" />
              {rest} more
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="flex max-h-[min(480px,calc(var(--radix-popover-content-available-height)/var(--content-zoom)))] w-80 flex-col overflow-y-auto p-0"
            side="top"
          >
            {chats.map(row)}
          </PopoverContent>
        </Popover>
      )}
      {deleting && (
        <DeleteChatDialog
          chat={deleting}
          onDeleted={() => {
            setDeleting(undefined);
          }}
          onOpenChange={(open) => {
            if (!open) {
              setDeleting(undefined);
            }
          }}
          open
        />
      )}
    </section>
  );
}

/** One chat of the list, the Chats page's own row at two lines. */
function ActiveChatRow({
  chat,
  onDelete,
  onNewProject,
  onOpen,
  projects,
}: {
  chat: Chat;
  onDelete: () => void;
  onNewProject: (name?: string) => void;
  onOpen: () => void;
  projects: Project[];
}) {
  const appsBySlug = useAppsBySlug();
  const actionsFor = useChatActionsFor();
  const setChatProject = useSetChatProject();
  const now = useNow();
  return (
    <ChatRow
      actions={actionsFor(chat)}
      appsBySlug={appsBySlug}
      chat={chat}
      density="two"
      isOpen={false}
      now={now}
      onDelete={onDelete}
      onNewProject={onNewProject}
      onOpen={onOpen}
      onSetProject={(next) => {
        setChatProject(chat.id, next);
      }}
      projects={projects}
    />
  );
}

/**
 * The order the list last stood in, kept for the window rather than for the
 * list, so a sidebar folded away and opened again finds its rows where they
 * were.
 */
const activeOrderAtom = atom<readonly ChatId[]>([]);

/**
 * The list's chats, kept in the order they joined it from one render to the
 * next. Nothing changes while the chats are still on their way, so a list
 * loading again never shuffles it.
 */
function useActiveChats(): Chat[] {
  const { data } = useQuery(chatListOptions());
  const state = useAtomValue(windowTabsAtom);
  const [order, setOrder] = useAtom(activeOrderAtom);
  const shown =
    data === undefined ? undefined : activeChats(data, state, order);
  const key = shown?.map((chat) => chat.id).join(" ");
  const keep = useEffectEvent(() => {
    if (shown !== undefined && key !== order.join(" ")) {
      setOrder(shown.map((chat) => chat.id));
    }
  });
  useEffect(() => {
    keep();
  }, [key]);
  return shown ?? [];
}

/**
 * Opens a chat as a new tab in the group up, right after the tab up on the
 * side with the keyboard, up there itself; in a new group only when no group
 * is up.
 */
function useOpenChatTab() {
  const store = useStore();
  const windowTabs = useWindowTabs();
  const groups = useTabGroupActions();
  return (chat: ChatId) => {
    const group = groups.groupUp();
    if (group === undefined) {
      groups.openChat(chat);
      return;
    }
    const up = selectedTabIn(store.get(windowTabsAtom), group)?.id;
    windowTabs.openScreen(chatHref(chat), {
      ...(up === undefined ? {} : { after: up }),
      group,
      select: true,
    });
  };
}
