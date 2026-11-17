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
import { useLocation, useRouter } from "@tanstack/react-router";
import { atom, useAtomValue, useSetAtom } from "jotai";
import {
  createContext,
  type ReactNode,
  use,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { ChatPane } from "./chat-pane";
import { CHAT_WIDTH_MIN, isListOver, LIST_WIDTH_MIN } from "./chat-list-width";
import { useGroupTab } from "./group-tab";
import { useShell } from "./shell-context";
import { CHATS_INDEX_HREF, chatHref, newChatHref } from "./window-href";

/** The tabs showing the chat list beside their chat, by id: none until the person opens it, or opens a chat from the Chats page. */
const listOpenTabsAtom = atom<ReadonlySet<string>>(new Set<string>());

/** The tabs too narrow to share with the list that show it over their chat, by id: put away again once a chat is picked, a press lands outside it, or the tab widens. */
const listOverTabsAtom = atom<ReadonlySet<string>>(new Set<string>());

/** The Chats page's visits that have opened the list, by the tab's history entry, so the page drawn again (its group come back up, its tab moved) leaves the list as the person left it. */
const listOpenedVisits = new Set<string>();

/** Whether one tab shows the chat list, beside its chat or over it, and setting it. */
function useChatListOpen(
  tabId: string | undefined,
  tabsAtom: typeof listOpenTabsAtom = listOpenTabsAtom,
) {
  const open = useAtomValue(tabsAtom);
  const setOpen = useSetAtom(tabsAtom);
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

/** The list's widest beside a chat: a list to pick from, so the room past this goes to the chat. */
const LIST_WIDTH_MAX = 440;
/** Dragged narrower than this, the list slides shut. */
const LIST_COLLAPSE = 240;

/** The list's open state where the toggle and the list read it: beside the chat, or over it in a narrow tab. */
const ChatListOpenContext = createContext<{
  isOpen: boolean;
  isOverlay: boolean;
  setOpen: (isOpen: boolean) => void;
} | null>(null);

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
  const list = use(ChatListOpenContext);
  const go = (href: string, replace = false) => {
    // Beside the chat it stays; over the chat it makes way for the one picked.
    list?.setOpen(!list.isOverlay);
    if (replace) {
      router.history.replace(href);
    } else {
      router.history.push(href);
    }
  };
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
        // The tab already writing the draft comes up, wherever it is; with
        // none, this tab goes to it.
        onOpenDraft={(id) => {
          shell.showDraft(id, () => {
            go(newChatHref(id));
          });
        }}
        openChatId={openChatId}
      />
    </div>
  );
}

/**
 * A chat's or a new chat's tab with the chat list down its left while the
 * person has it open, and the toggle ahead of the chat's title that opens
 * and closes it (`ChatListToggle`). Closed until it is opened in this tab,
 * or open from the start where `opensList` says so: the Chats page.
 */
export function WithChatList({
  children,
  openChatId,
  opensList = false,
}: {
  children: ReactNode;
  openChatId: ChatId | undefined;
  opensList?: boolean;
}) {
  const groupTab = useGroupTab();
  const tabId = groupTab?.id;
  const [isBeside, setBeside] = useChatListOpen(tabId);
  const [isOver, setOver] = useChatListOpen(tabId, listOverTabsAtom);
  const listWidth = useAtomValue(listWidthAtom);
  // The entry in the tab's history the page stands at, which the page drawn
  // again keeps and a visit of its own does not.
  const visit = useLocation({ select: (location) => location.state.__TSR_key });
  const ref = useRef<HTMLDivElement>(null);
  // Only as the page arrives: the toggle closes it from then on, however
  // often the page is drawn again in the same visit. Read as it is drawn,
  // not as the address moves on: the page still stands a moment as its
  // first words take the tab to their draft's address.
  const arrive = useEffectEvent(() => {
    if (!opensList || tabId === undefined || visit === undefined) {
      return;
    }
    const key = `${tabId} ${visit}`;
    if (listOpenedVisits.has(key)) {
      return;
    }
    listOpenedVisits.add(key);
    setBeside(true);
    if (isListOver(ref.current?.offsetWidth ?? 0, listWidth)) {
      setOver(true);
    }
  });
  useLayoutEffect(() => {
    arrive();
  }, [opensList, tabId]);
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
  const isOverlay = isListOver(width, listWidth);
  // Widened past it, the list over the chat is put away, so narrowing again
  // does not bring it back over the chat.
  useLayoutEffect(() => {
    if (width > 0 && !isOverlay) {
      setOver(false);
    }
  });
  const isOpen = isOverlay ? isOver : isBeside;
  const setOpen = isOverlay ? setOver : setBeside;
  return (
    <div className="absolute inset-0 flex min-w-0" ref={ref}>
      <ChatListOpenContext value={{ isOpen, isOverlay, setOpen }}>
        <StudioSidebarRail
          bounds={listBounds(width)}
          isOpen={isOpen}
          isOverlay={isOverlay}
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
      </ChatListOpenContext>
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
  const list = use(ChatListOpenContext);
  const isOpen = list?.isOpen ?? false;
  const label = isOpen ? "Hide chats" : "Show chats";
  return (
    <ToolbarTooltip label={label}>
      <Button
        aria-label={label}
        aria-pressed={isOpen}
        className={cn("size-7 shrink-0 text-muted-foreground/70", className)}
        onClick={() => {
          list?.setOpen(!isOpen);
        }}
        size="icon"
        variant="ghost-toolbar"
      >
        <SidebarSimpleIcon className="size-4" />
      </Button>
    </ToolbarTooltip>
  );
}
