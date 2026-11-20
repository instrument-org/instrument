import { sidebarWidthAtom } from "@/client/atoms/tab-groups";
import { openBuiltInPage } from "@/client/atoms/page-requests";
import { ToolbarTooltip } from "@/client/components/toolbar-tooltip";
import { Button } from "@/client/components/ui/button";
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
} from "@/client/components/ui/context-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/client/components/ui/popover";
import { formatAcceleratorText } from "@/client/lib/format-accelerator";
import { focusHomeIn } from "@/client/lib/keyboard-home";
import { keyboardSide } from "@/client/lib/keyboard-place";
import { SCREENS } from "@/shared/instrument-screens";
import { WINDOW_SHORTCUTS } from "@/shared/window-shortcuts";
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react/ClockCounterClockwise";
import { useAtomValue } from "jotai";
import { useRef, useState } from "react";

import { appTabsAtom } from "./app-tabs";
import { useAppsBySlug } from "./apps-by-slug";
import { closedGroupsOf } from "./closed-groups";
import { GroupRowLines } from "./group-row-lines";
import { TabMark } from "./row-half";
import { useShell } from "./shell-context";
import { useTabTitle } from "./tab-title";
import { useRecentlyClosed } from "./window-space-menu";

/** After a pick, the caret goes where the side with the keyboard puts it, as reopening from Activity does, and stays off what opened the list. */
function focusHomeAfterPick(event: Event, hasPicked: { current: boolean }) {
  if (!hasPicked.current) {
    return;
  }
  hasPicked.current = false;
  event.preventDefault();
  const side = keyboardSide();
  if (side) {
    focusHomeIn(side);
  }
}

/**
 * The tabs and groups closed lately, as a right click on a strip's plus
 * offers them: each by its mark and name, a group by its first tab's with
 * how many tabs it brings back, and a pick brings that one back where it
 * stood. The first row names Reopen Closed Tab's key, which brings it back,
 * and the last opens History's page. After a pick the caret goes where the
 * side with the keyboard puts it, as reopening from Activity does.
 */
export function RecentlyClosedMenu() {
  const shell = useShell();
  const closed = useRecentlyClosed();
  const appsBySlug = useAppsBySlug();
  const titleOf = useTabTitle(shell.chatTitles);
  const hasPicked = useRef(false);
  const rows = (
    <>
      <ContextMenuLabel>Recently Closed</ContextMenuLabel>
      {closed.length === 0 ? (
        <ContextMenuItem disabled>No closed tabs</ContextMenuItem>
      ) : (
        closed.map((entry, index) => (
          <ContextMenuItem
            key={entry.id}
            onClick={() => {
              hasPicked.current = true;
              shell.reopenClosed(entry.id);
            }}
          >
            <span className="flex size-4 shrink-0 items-center justify-center">
              <TabMark
                appsBySlug={appsBySlug}
                chatTitles={shell.chatTitles}
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
      <ContextMenuSeparator />
      <ContextMenuItem
        onClick={() => {
          hasPicked.current = true;
          openBuiltInPage(SCREENS.activity.href);
        }}
      >
        Show All History
      </ContextMenuItem>
    </>
  );
  return (
    <ContextMenuContent
      className="max-w-80 min-w-48"
      onCloseAutoFocus={(event) => {
        focusHomeAfterPick(event, hasPicked);
      }}
    >
      {rows}
    </ContextMenuContent>
  );
}

/**
 * The sidebar's History button: a press opens the tab groups closed lately
 * over the sidebar, newest first, each as the sidebar's row showed it as it
 * closed, and a pick brings that group back up. ⌘Y opens History's page
 * itself, as the popover's last row does.
 */
export function HistoryButton() {
  const shell = useShell();
  const [isOpen, setOpen] = useState(false);
  const hasPicked = useRef(false);
  const closed = closedGroupsOf(useAtomValue(appTabsAtom).recentlyClosed);
  const sidebarWidth = useAtomValue(sidebarWidthAtom);
  const pick = (run: () => void) => {
    hasPicked.current = true;
    setOpen(false);
    run();
  };
  return (
    <Popover onOpenChange={setOpen} open={isOpen}>
      <ToolbarTooltip chord="showActivity" label={SCREENS.activity.title}>
        <PopoverTrigger asChild>
          <Button
            aria-label={SCREENS.activity.title}
            className="size-7 text-muted-foreground/70 [-webkit-app-region:no-drag]"
            size="icon-sm"
            variant="ghost-toolbar"
          >
            <ClockCounterClockwiseIcon className="size-4" />
          </Button>
        </PopoverTrigger>
      </ToolbarTooltip>
      {/* As wide as the sidebar less its edges, on the sidebar's own
          ground, so it reads as the sidebar's list growing up from its foot. */}
      <PopoverContent
        align="end"
        className="flex w-auto flex-col bg-ground p-1.5 ring-1 ring-foreground/8"
        maxHeight="520px"
        onCloseAutoFocus={(event) => {
          focusHomeAfterPick(event, hasPicked);
        }}
        side="top"
        sideOffset={6}
        style={{ width: sidebarWidth - 12 }}
      >
        <p className="shrink-0 px-2.5 pt-1 pb-1.5 text-[12px] font-medium text-muted-foreground">
          Recently Closed
        </p>
        {closed.length === 0 ? (
          <p className="px-2.5 pb-2 text-[13px] text-muted-foreground">
            Tab groups you close show up here.
          </p>
        ) : (
          <div className="flex min-h-0 flex-col gap-0.5 overflow-y-auto">
            {closed.map((group) => (
              <button
                className="flex shrink-0 rounded-lg px-2.5 py-1.5 text-left hover:bg-foreground/[0.04]"
                key={group.id}
                onClick={() => {
                  pick(() => {
                    shell.reopenClosed(group.id);
                  });
                }}
                type="button"
              >
                <GroupRowLines
                  chatTitles={shell.chatTitles}
                  isCloseShown={false}
                  isOnScreen={false}
                  sides={group.sides}
                />
              </button>
            ))}
          </div>
        )}
        <div className="mt-1 shrink-0 border-t border-border/60 pt-1">
          <button
            className="flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-medium text-foreground/70 hover:bg-foreground/5 hover:text-foreground"
            onClick={() => {
              pick(() => {
                openBuiltInPage(SCREENS.activity.href);
              });
            }}
            type="button"
          >
            Show All History
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
