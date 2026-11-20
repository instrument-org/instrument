import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/client/components/ui/popover";
import { cn } from "@/client/lib/utils";
import { type ChatId } from "@instrument-org/workspace/client";
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight";
import { CaretUpIcon } from "@phosphor-icons/react/CaretUp";
import { useQuery } from "@tanstack/react-query";
import { atom, useAtom, useAtomValue } from "jotai";
import { useEffect, useEffectEvent, useState } from "react";

import {
  ACTIVE_CHATS_SHOWN,
  type ActiveChatsKept,
  activeChats,
  chatsInView,
} from "./active-chats";
import { useAppsBySlug } from "./apps-by-slug";
import { useChatActionsFor } from "./chat-actions";
import { chatListOptions } from "./chat-list-query";
import { chatDotOf, ChatMarkIcon } from "./chat-mark";
import { ChatRow } from "./chat-row";
import { type Chat, type Project } from "./chats";
import { useChatsPlace } from "./chats-place";
import { DeleteChatDialog } from "./delete-chat-dialog";
import { windowTabGroupsAtom } from "./open-groups";
import { ScreenMark } from "./pane-tabs";
import { useNow } from "./use-now";
import { useSetChatProject } from "./use-set-chat-project";
import { chatHref } from "./window-href";
import { windowTabsAtom } from "./window-tabs";

/**
 * The Chats heading over the sidebar's foot, which makes Chats the window's
 * place (`useChatsPlace`) and reads as on while it is, and under it the
 * chats that came to want a look while no sidebar row showed them
 * (`activeChats`): a reply not yet seen, or a question waiting. Up to three
 * rows, drawn as the Chats page draws them at one line with no controls,
 * each chat's mark wearing its dot, then a row that opens the whole list
 * above it. A row opens its chat in the place, picked in the list.
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
  const place = useChatsPlace();
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
        place.enter(chat.id);
      }}
      projects={projects}
    />
  );
  const rest = chats.length - ACTIVE_CHATS_SHOWN;
  return (
    <section aria-label="Chats" className="flex shrink-0 flex-col pt-1.5 pl-2">
      {/* On, it says so in its ink alone, with no fill behind it. */}
      <button
        aria-current={place.isUp ? "page" : undefined}
        className={cn(
          "group/heading flex h-7 w-fit shrink-0 items-center gap-1 rounded-md px-2.5 text-[12px] hover:bg-foreground/[0.04] hover:text-foreground",
          place.isUp
            ? "font-semibold text-foreground"
            : "font-medium text-muted-foreground",
        )}
        onClick={() => {
          place.enter();
        }}
        type="button"
      >
        Chats
        <CaretRightIcon
          className={cn(
            "size-3 group-hover/heading:text-foreground",
            place.isUp ? "text-foreground/60" : "text-muted-foreground/70",
          )}
        />
      </button>
      <div className="flex flex-col">
        {chats.slice(0, ACTIVE_CHATS_SHOWN).map(row)}
      </div>
      {rest > 0 && (
        <Popover onOpenChange={setMoreOpen} open={isMoreOpen}>
          <PopoverTrigger asChild>
            <button
              className="flex h-8 w-full shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-medium text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
              type="button"
            >
              <CaretUpIcon className="size-3" />
              {rest} more
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="flex max-h-[min(480px,calc(var(--radix-popover-content-available-height)/var(--content-zoom)))] w-80 flex-col overflow-y-auto p-1"
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

/** One chat of the list, the Chats page's own row at one line, with no controls, led by the chat's mark. */
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
 * What the list last kept (`ActiveChatsKept`), for the window rather than for
 * the list, so a sidebar folded away and opened again finds its rows where
 * they were.
 */
const activeKeptAtom = atom<ActiveChatsKept>({ list: [] });

/**
 * The list's chats, kept in the order they joined it from one render to the
 * next. Nothing changes while the chats or the window's groups are still on
 * their way, so a list loading again never shuffles it.
 */
function useActiveChats(): Chat[] {
  const { data } = useQuery(chatListOptions());
  const state = useAtomValue(windowTabsAtom);
  const listed = useAtomValue(windowTabGroupsAtom);
  const [kept, setKept] = useAtom(activeKeptAtom);
  const next =
    data === undefined || listed === null
      ? undefined
      : activeChats(data, chatsInView(state, listed), kept);
  const key = next && keyOf(next.kept);
  const keep = useEffectEvent(() => {
    if (next !== undefined && key !== keyOf(kept)) {
      setKept(next.kept);
    }
  });
  useEffect(() => {
    keep();
  }, [key]);
  return next?.chats ?? [];
}

function keyOf(kept: ActiveChatsKept): string {
  return `${kept.list.join(" ")}|${kept.wanting?.join(" ") ?? ""}`;
}

/** The list's marks name no chat: a chat's mark is the same whatever its title. */
const NO_TITLES = new Map<ChatId, string>();
