import { PageFavicon } from "@/client/components/favicon";
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/client/components/ui/dropdown-menu";
import { useRecentPages } from "@/client/hooks/use-browser-history";
import { formatAcceleratorText } from "@/client/lib/format-accelerator";
import { WINDOW_SHORTCUTS } from "@/shared/window-shortcuts";
import { type ChatId } from "@instrument-org/workspace/client";
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react/ClockCounterClockwise";
import { useQuery } from "@tanstack/react-query";

import { chatListOptions } from "./chat-list-query";
import { useClosedAppTabs } from "./closed-app-tabs";
import { useTaskTitles } from "./task-titles";
import { shownAddress } from "./visited-page-rows";

/** How many of each list the menu shows, as a browser's History menu does. */
const SHOWN = 8;

/**
 * A page menu's History: the window's tabs closed lately, each brought back
 * where it stood, and the pages visited lately, each opened in this tab.
 * Read only while the submenu is open.
 */
export function BrowserHistoryMenu({
  hasClosedTabs,
  onOpen,
}: {
  /** Whether to list the window's closed tabs, which a task's own browser has none of. */
  hasClosedTabs: boolean;
  onOpen: (url: string) => void;
}) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <ClockCounterClockwiseIcon className="size-4" />
        History
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-72">
        <HistoryRows hasClosedTabs={hasClosedTabs} onOpen={onOpen} />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function HistoryRows({
  hasClosedTabs,
  onOpen,
}: {
  hasClosedTabs: boolean;
  onOpen: (url: string) => void;
}) {
  const visited = useRecentPages().slice(0, SHOWN);
  return (
    <>
      {hasClosedTabs && <ClosedTabRows />}
      <DropdownMenuLabel className="text-xs text-muted-foreground">
        Recent pages
      </DropdownMenuLabel>
      {visited.length === 0 ? (
        <DropdownMenuItem disabled>No pages yet</DropdownMenuItem>
      ) : (
        visited.map((page) => (
          <DropdownMenuItem
            key={page.url}
            onSelect={() => {
              onOpen(page.url);
            }}
          >
            <PageFavicon
              favicon={page.favicon}
              hasTooltip={false}
              url={page.url}
            />
            <span className="truncate">
              {page.title || shownAddress(page.url)}
            </span>
          </DropdownMenuItem>
        ))
      )}
    </>
  );
}

/** The window's tabs closed lately, named and drawn as the tab strip's own list has them. */
function ClosedTabRows() {
  const childTitles = useTaskTitles();
  const chats = useQuery(chatListOptions());
  const chatTitles = new Map<ChatId, string>(
    chats.data?.map((chat) => [chat.id, chat.title]) ?? [],
  );
  const { closed, firstIsReopenedByKey, reopen } = useClosedAppTabs({
    chatTitles,
    childTitles,
  });
  if (closed.length === 0) {
    return null;
  }
  return (
    <>
      <DropdownMenuLabel className="text-xs text-muted-foreground">
        Recently closed
      </DropdownMenuLabel>
      {closed.slice(0, SHOWN).map((tab, entry) => (
        <DropdownMenuItem
          // Entries are taken out as they are reopened, so a place in the
          // list is only ever one tab while the menu is open.
          // eslint-disable-next-line react/no-array-index-key
          key={entry}
          onSelect={() => {
            reopen(entry);
          }}
        >
          <span className="flex size-4 shrink-0 items-center justify-center">
            {tab.icon}
          </span>
          <span className="truncate">{tab.title}</span>
          {entry === 0 && firstIsReopenedByKey ? (
            <DropdownMenuShortcut className="pl-4">
              {formatAcceleratorText(WINDOW_SHORTCUTS.reopenTab.accelerator)}
            </DropdownMenuShortcut>
          ) : null}
        </DropdownMenuItem>
      ))}
      <DropdownMenuSeparator />
    </>
  );
}
