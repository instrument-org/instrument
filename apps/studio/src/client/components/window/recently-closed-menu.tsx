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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { formatAcceleratorText } from "@/client/lib/format-accelerator";
import { focusHomeIn } from "@/client/lib/keyboard-home";
import { keyboardSide } from "@/client/lib/keyboard-place";
import { SCREENS } from "@/shared/instrument-screens";
import { WINDOW_SHORTCUTS } from "@/shared/window-shortcuts";
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react/ClockCounterClockwise";
import { useRef } from "react";

import { useAppsBySlug } from "./apps-by-slug";
import { TabMark } from "./row-half";
import { useShell } from "./shell-context";
import { useTabTitle } from "./tab-title";
import { useRecentlyClosed } from "./window-space-menu";

/** The menu parts each way of opening the list draws it with. */
const PARTS = {
  context: {
    Item: ContextMenuItem,
    Label: ContextMenuLabel,
    Separator: ContextMenuSeparator,
    Shortcut: ContextMenuShortcut,
  },
  dropdown: {
    Item: DropdownMenuItem,
    Label: DropdownMenuLabel,
    Separator: DropdownMenuSeparator,
    Shortcut: DropdownMenuShortcut,
  },
};

/**
 * The tabs and groups closed lately, as a right click on a strip's plus and
 * a press on the sidebar's History button offer them: each by its mark and
 * name, a group by its first tab's with how many tabs it brings back, and a
 * pick brings that one back where it stood. The first row names Reopen
 * Closed Tab's key, which brings it back, and the last opens History's page.
 * After a pick the caret goes where the side with the keyboard puts it, as
 * reopening from Activity does, and stays off the button that opened it.
 */
export function RecentlyClosedMenu({
  menu,
}: {
  /** A right click's menu, or a button's. */
  menu: keyof typeof PARTS;
}) {
  const shell = useShell();
  const closed = useRecentlyClosed();
  const appsBySlug = useAppsBySlug();
  const titleOf = useTabTitle(shell.chatTitles);
  const hasPicked = useRef(false);
  const { Item, Label, Separator, Shortcut } = PARTS[menu];
  const content = {
    className: "max-w-80 min-w-48",
    onCloseAutoFocus: (event: Event) => {
      if (!hasPicked.current) {
        return;
      }
      hasPicked.current = false;
      event.preventDefault();
      const side = keyboardSide();
      if (side) {
        focusHomeIn(side);
      }
    },
  };
  const rows = (
    <>
      <Label>Recently Closed</Label>
      {closed.length === 0 ? (
        <Item disabled>No closed tabs</Item>
      ) : (
        closed.map((entry, index) => (
          <Item
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
              <Shortcut className="pl-4">
                {formatAcceleratorText(WINDOW_SHORTCUTS.reopenTab.accelerator)}
              </Shortcut>
            ) : null}
          </Item>
        ))
      )}
      <Separator />
      <Item
        onClick={() => {
          hasPicked.current = true;
          openBuiltInPage(SCREENS.activity.href);
        }}
      >
        Show All History
      </Item>
    </>
  );
  return menu === "dropdown" ? (
    <DropdownMenuContent align="end" {...content}>
      {rows}
    </DropdownMenuContent>
  ) : (
    <ContextMenuContent {...content}>{rows}</ContextMenuContent>
  );
}

/**
 * The sidebar's History button: a press opens the recently closed list, as
 * a right click on a strip's plus does. ⌘Y opens History's page itself.
 */
export function HistoryButton() {
  return (
    <DropdownMenu modal={false}>
      <ToolbarTooltip chord="showActivity" label={SCREENS.activity.title}>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label={SCREENS.activity.title}
            className="size-7 text-muted-foreground/70 [-webkit-app-region:no-drag]"
            size="icon-sm"
            variant="ghost-toolbar"
          >
            <ClockCounterClockwiseIcon className="size-4" />
          </Button>
        </DropdownMenuTrigger>
      </ToolbarTooltip>
      <RecentlyClosedMenu menu="dropdown" />
    </DropdownMenu>
  );
}
