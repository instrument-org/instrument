import { type TabId } from "@/shared/tabs";
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuShortcut,
} from "@/client/components/ui/context-menu";
import { formatAcceleratorText } from "@/client/lib/format-accelerator";
import { focusHomeIn } from "@/client/lib/keyboard-home";
import { keyboardSide } from "@/client/lib/keyboard-place";
import { WINDOW_SHORTCUTS } from "@/shared/window-shortcuts";
import { type ChatId } from "@instrument-org/workspace/client";
import { useRef } from "react";

import { useAppsBySlug } from "./apps-by-slug";
import { TabMark } from "./row-half";
import { useTabTitle } from "./tab-title";
import { useRecentlyClosed } from "./window-space-menu";

/**
 * The tabs and groups closed lately, as a right click on a strip's plus
 * offers them: each by its mark and name, a group by its first tab's with
 * how many tabs it brings back, and a pick brings that one back where it
 * stood. The first row names Reopen Closed Tab's key, which brings it back.
 * After a pick the caret goes where the side with the keyboard puts it, as
 * reopening from Activity does, and stays off the plus.
 */
export function RecentlyClosedMenu({
  chatTitles,
  onReopen,
}: {
  chatTitles: Map<ChatId, string>;
  onReopen: (id: TabId) => void;
}) {
  const closed = useRecentlyClosed();
  const appsBySlug = useAppsBySlug();
  const titleOf = useTabTitle(chatTitles);
  const hasPicked = useRef(false);
  return (
    <ContextMenuContent
      className="max-w-80 min-w-48"
      onCloseAutoFocus={(event) => {
        if (!hasPicked.current) {
          return;
        }
        hasPicked.current = false;
        event.preventDefault();
        const side = keyboardSide();
        if (side) {
          focusHomeIn(side);
        }
      }}
    >
      <ContextMenuLabel>Recently Closed</ContextMenuLabel>
      {closed.length === 0 ? (
        <ContextMenuItem disabled>No closed tabs</ContextMenuItem>
      ) : (
        closed.map((entry, index) => (
          <ContextMenuItem
            key={entry.id}
            onClick={() => {
              hasPicked.current = true;
              onReopen(entry.id);
            }}
          >
            <span className="flex size-4 shrink-0 items-center justify-center">
              <TabMark
                appsBySlug={appsBySlug}
                chatTitles={chatTitles}
                tab={entry.tab}
              />
            </span>
            <span className="truncate">{titleOf(entry.tab)}</span>
            {entry.tabCount > 1 ? (
              <span className="shrink-0 text-muted-foreground">
                {entry.tabCount} tabs
              </span>
            ) : null}
            {index === 0 ? (
              <ContextMenuShortcut className="pl-4">
                {formatAcceleratorText(WINDOW_SHORTCUTS.reopenTab.accelerator)}
              </ContextMenuShortcut>
            ) : null}
          </ContextMenuItem>
        ))
      )}
    </ContextMenuContent>
  );
}
