import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuShortcut,
} from "@/client/components/ui/context-menu";
import { formatAcceleratorText } from "@/client/lib/format-accelerator";
import { WINDOW_SHORTCUTS } from "@/shared/window-shortcuts";
import { type ReactNode } from "react";

/**
 * The tabs closed lately, newest first, as a right click on the strip's plus
 * offers them: each by the mark and name its tab wore, and a pick brings
 * that one back where it stood.
 */
export function ClosedTabsMenu({
  closed,
  firstIsReopenedByKey,
  onReopen,
}: {
  closed: { icon: ReactNode; title: string }[];
  /** Whether the first row is the one Reopen Closed Tab's key brings back, so it names the key. */
  firstIsReopenedByKey: boolean;
  /** Which one, by its place in `closed`. */
  onReopen: (entry: number) => void;
}) {
  return (
    <ContextMenuContent className="max-w-72 min-w-48">
      <ContextMenuLabel>Recently Closed</ContextMenuLabel>
      {closed.length === 0 ? (
        <ContextMenuItem disabled>No closed tabs</ContextMenuItem>
      ) : (
        closed.map((tab, entry) => (
          <ContextMenuItem
            // Entries are taken out as they are reopened, so a place in the
            // list is only ever one tab while the menu is open.
            // eslint-disable-next-line react/no-array-index-key
            key={entry}
            onClick={() => {
              onReopen(entry);
            }}
          >
            <span className="flex size-4 shrink-0 items-center justify-center">
              {tab.icon}
            </span>
            <span className="truncate">{tab.title}</span>
            {entry === 0 && firstIsReopenedByKey ? (
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
