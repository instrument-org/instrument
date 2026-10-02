import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
} from "@/client/components/ui/context-menu";
import { type ReactNode } from "react";

/**
 * The tabs closed lately, newest first, as a right click on the strip's plus
 * offers them: each by the mark and name its tab wore, and a pick brings
 * that one back where it stood.
 */
export function ClosedTabsMenu({
  closed,
  onReopen,
}: {
  closed: { icon: ReactNode; title: string }[];
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
          </ContextMenuItem>
        ))
      )}
    </ContextMenuContent>
  );
}
