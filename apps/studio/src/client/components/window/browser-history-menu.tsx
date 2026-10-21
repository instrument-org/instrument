import { PageFavicon } from "@/client/components/favicon";
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/client/components/ui/dropdown-menu";
import { useRecentPages } from "@/client/hooks/use-browser-history";
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react/ClockCounterClockwise";

import { shownAddress } from "./visited-page-rows";

/** How many pages the menu shows, as a browser's History menu does. */
const SHOWN = 8;

/**
 * A page menu's History: the pages visited lately, each opened in this tab.
 * Read only while the submenu is open.
 */
export function BrowserHistoryMenu({
  onOpen,
}: {
  onOpen: (url: string) => void;
}) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <ClockCounterClockwiseIcon className="size-4" />
        History
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-72">
        <HistoryRows onOpen={onOpen} />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function HistoryRows({ onOpen }: { onOpen: (url: string) => void }) {
  const visited = useRecentPages().slice(0, SHOWN);
  return (
    <>
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
