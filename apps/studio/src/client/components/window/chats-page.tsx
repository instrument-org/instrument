import {
  type RailBounds,
  StudioSidebarRail,
} from "@/client/components/studio-sidebar-rail";
import { ToolbarTooltip } from "@/client/components/toolbar-tooltip";
import { Button } from "@/client/components/ui/button";
import { keptAtom } from "@/client/lib/kept-state";
import { cn } from "@/client/lib/utils";
import { type ChatId } from "@instrument-org/workspace/client";
import { SidebarSimpleIcon } from "@phosphor-icons/react/SidebarSimple";
import { useRouter } from "@tanstack/react-router";
import { atom, useAtomValue, useSetAtom } from "jotai";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";

import { ChatPane } from "./chat-pane";
import { useGroupTab } from "./group-tab";
import { useShell } from "./shell-context";
import { CHATS_INDEX_HREF, chatHref, newChatHref } from "./window-href";

/** The tabs showing the chat list beside their chat, by id: none until the person opens it, or opens a chat from the Chats page. */
const listOpenTabsAtom = atom<ReadonlySet<string>>(new Set<string>());

/** Whether one tab shows the chat list beside its chat, and setting it. */
export function useChatListOpen(tabId: string | undefined) {
  const open = useAtomValue(listOpenTabsAtom);
  const setOpen = useSetAtom(listOpenTabsAtom);
  return [
    tabId !== undefined && open.has(tabId),
    (isOpen: boolean) => {
      if (tabId === undefined) {
        return;
      }
      setOpen((current) => {
        if (current.has(tabId) === isOpen) {
          return current;
        }
        const next = new Set(current);
        if (isOpen) {
          next.add(tabId);
        } else {
          next.delete(tabId);
        }
        return next;
      });
    },
  ] as const;
}

/** The list's narrowest beside a chat, as the inbox was. */
const LIST_WIDTH_MIN = 320;
/** The list's widest beside a chat: a list to pick from, so the room past this goes to the chat. */
const LIST_WIDTH_MAX = 440;
/** Dragged narrower than this, the list slides shut. */
const LIST_COLLAPSE = 240;
/** The least the chat keeps beside the list while the list is dragged wider. */
const CHAT_WIDTH_MIN = 360;

const storedListWidthAtom = keptAtom<number>(
  "view",
  "chat-list-width.v1",
  LIST_WIDTH_MIN,
);

/** The list's width beside a chat in CSS px, dragged by its right edge, the same in every tab. */
const listWidthAtom = atom(
  (get) => Math.min(get(storedListWidthAtom), LIST_WIDTH_MAX),
  (_get, set, width: number) => {
    set(storedListWidthAtom, width);
  },
);

/**
 * The chat list in this tab: the inbox, its projects, search, drafts and
 * places, as the Chat screen listed them. A chat or draft picked from it
 * opens in this tab, with the list beside it, and Back comes back.
 */
function TabChatList({ openChatId }: { openChatId: ChatId | undefined }) {
  const shell = useShell();
  const router = useRouter();
  const groupTab = useGroupTab();
  const [, setListOpen] = useChatListOpen(groupTab?.id);
  const go = (href: string, replace = false) => {
    setListOpen(true);
    if (replace) {
      router.history.replace(href);
    } else {
      router.history.push(href);
    }
  };
  const outIds = new Set(
    shell.compose.entries.flatMap((entry) =>
      entry.kind === "chat" ? [entry.chatId] : [],
    ),
  );
  return (
    // The search the chord for searching chats puts the caret in.
    <div className="flex min-h-0 w-full flex-1 flex-col" data-chats-search="">
      <ChatPane
        arrivedId={shell.arrivedId}
        drafts={shell.drafts}
        // An archived chat is put away, so the list takes the tab back.
        onArchiveOpen={() => {
          go(CHATS_INDEX_HREF);
        }}
        onDeleted={(id) => {
          if (id === openChatId) {
            go(CHATS_INDEX_HREF, true);
          }
        }}
        onDeleteDraft={shell.discardDraft}
        onOpenChat={(chat) => {
          if (chat.id !== openChatId) {
            go(chatHref(chat.id));
          }
        }}
        onOpenDraft={(id) => {
          go(newChatHref(id));
        }}
        onPopOut={(chat) => {
          shell.compose.float(chat.id);
          if (chat.id === openChatId) {
            go(CHATS_INDEX_HREF);
          }
        }}
        openChatId={openChatId}
        outIds={outIds}
      />
    </div>
  );
}

/**
 * The Chats page: the chat list across the whole tab. A chat picked from it
 * opens to the list's right in this same tab.
 */
export function ChatsPage() {
  return (
    <main className="flex h-full min-h-0 flex-col bg-background">
      <TabChatList openChatId={undefined} />
    </main>
  );
}

/**
 * A chat's or a new chat's tab with the chat list down its left while the
 * person has it open, and the toggle ahead of the chat's title that opens
 * and closes it (`ChatListToggle`). Closed until it is opened in this tab.
 */
export function WithChatList({
  children,
  openChatId,
}: {
  children: ReactNode;
  openChatId: ChatId | undefined;
}) {
  const groupTab = useGroupTab();
  const [isOpen, setOpen] = useChatListOpen(groupTab?.id);
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    const observer = new ResizeObserver(() => {
      setWidth(element.offsetWidth);
    });
    observer.observe(element);
    setWidth(element.offsetWidth);
    return () => {
      observer.disconnect();
    };
  }, []);
  return (
    <div className="absolute inset-0 flex min-w-0" ref={ref}>
      <StudioSidebarRail
        bounds={listBounds(width)}
        isOpen={isOpen}
        label="Resize the chat list"
        onCollapse={() => {
          setOpen(false);
        }}
        panelClassName="border-r-0 bg-background after:pointer-events-none after:absolute after:inset-y-0 after:right-0 after:z-10 after:w-px after:bg-border/70"
        widthAtom={listWidthAtom}
      >
        <div className="flex min-h-0 w-full flex-1 flex-col [&_.prose]:text-[13px] [&_.prose]:leading-5 [&_.text-sm]:text-[13px]">
          {isOpen && <TabChatList openChatId={openChatId} />}
        </div>
      </StudioSidebarRail>
      <div className="relative min-w-0 flex-1">{children}</div>
    </div>
  );
}

function listBounds(width: number): RailBounds {
  return {
    collapse: LIST_COLLAPSE,
    initial: LIST_WIDTH_MIN,
    max: Math.min(
      LIST_WIDTH_MAX,
      Math.max(LIST_WIDTH_MIN, width - CHAT_WIDTH_MIN),
    ),
    min: LIST_WIDTH_MIN,
  };
}

/** The control ahead of a chat's title that shows the chat list beside it in this tab, and puts it away. */
export function ChatListToggle({ className }: { className?: string }) {
  const groupTab = useGroupTab();
  const [isOpen, setOpen] = useChatListOpen(groupTab?.id);
  const label = isOpen ? "Hide chats" : "Show chats";
  return (
    <ToolbarTooltip label={label}>
      <Button
        aria-label={label}
        aria-pressed={isOpen}
        className={cn("size-7 shrink-0 text-muted-foreground/70", className)}
        onClick={() => {
          setOpen(!isOpen);
        }}
        size="icon"
        variant="ghost-toolbar"
      >
        <SidebarSimpleIcon className="size-4" />
      </Button>
    </ToolbarTooltip>
  );
}
