import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
} from "@/client/components/ui/dropdown-menu";
import { formatAcceleratorText } from "@/client/lib/format-accelerator";
import {
  WINDOW_SHORTCUTS,
  type WindowShortcutId,
} from "@/shared/window-shortcuts";
import { ArrowRightIcon } from "@phosphor-icons/react/ArrowRight";
import { DownloadSimpleIcon } from "@phosphor-icons/react/DownloadSimple";
import { PlusIcon } from "@phosphor-icons/react/Plus";
import { StarIcon } from "@phosphor-icons/react/Star";
import { type ReactNode, useRef, useState } from "react";

import { type RowFold, rowFoldsOf } from "./tab-row-folds";

/** How each control a row folds reads in its ⋮ menu, in the menu's order. */
const FOLDED: {
  chord?: WindowShortcutId;
  fold: Exclude<RowFold, "extensions">;
  icon: ReactNode;
  label: string;
}[] = [
  {
    chord: "forward",
    fold: "forward",
    icon: <ArrowRightIcon className="size-4" />,
    label: "Forward",
  },
  {
    chord: "bookmarkTab",
    fold: "star",
    icon: <StarIcon className="size-4" />,
    label: "Bookmark this tab",
  },
  {
    fold: "downloads",
    icon: <DownloadSimpleIcon className="size-4" />,
    label: "Downloads",
  },
  {
    chord: "newTab",
    fold: "newTab",
    icon: <PlusIcon className="size-4" />,
    label: "New Tab",
  },
];

/** The press a folded item was picked for, run once its menu has gone; one menu is open at a time, so there is at most one. */
const pending = new Set<() => void>();

/**
 * A row's ⋮ menu's side of folding (`ROW_FOLDS`): the props its trigger
 * takes, which mark the row as one whose controls fold and read which have
 * as the menu opens, and the items that stand in for them at the menu's top.
 * A press on one presses the control itself once the menu has gone, so it
 * does all the control does, and a card it opens (the star's, the
 * downloads') shows the control again to hang from.
 */
export function useFoldedRowItems({
  extensions,
}: {
  /** The menu's extensions items, shown in their own submenu while the row has folded its extensions group. */
  extensions?: (
    row: Element | null,
    onPress: (press: () => void) => void,
  ) => ReactNode;
} = {}) {
  const trigger = useRef<HTMLButtonElement>(null);
  // What the row had folded as the menu last opened, and the row.
  const [opened, setOpened] = useState<{
    folds: ReturnType<typeof rowFoldsOf>;
    row: Element | null;
  }>(() => ({ folds: new Map(), row: null }));
  const { folds, row } = opened;
  const onPress = (press: () => void) => {
    pending.clear();
    pending.add(press);
  };
  const items = FOLDED.flatMap(({ chord, fold, icon, label }) => {
    const element = folds.get(fold);
    if (!element) {
      return [];
    }
    return [
      <DropdownMenuItem
        disabled={element instanceof HTMLButtonElement && element.disabled}
        key={fold}
        onSelect={() => {
          onPress(() => {
            element.click();
          });
        }}
      >
        {icon}
        {/* The star says whether it keeps or edits. */}
        {fold === "star"
          ? (element.getAttribute("aria-label") ?? label)
          : label}
        {chord && (
          <DropdownMenuShortcut>
            {formatAcceleratorText(WINDOW_SHORTCUTS[chord].accelerator)}
          </DropdownMenuShortcut>
        )}
      </DropdownMenuItem>,
    ];
  });
  const hasExtensions = extensions !== undefined && folds.has("extensions");
  return {
    /** The extensions submenu's items while the row has folded its group, for the menu to put where its Extensions submenu is. */
    extensionItems: hasExtensions ? extensions(row, onPress) : null,
    /** The folded controls, with a separator under them, for the menu's top. */
    items:
      items.length > 0 ? (
        <>
          {items}
          <DropdownMenuSeparator />
        </>
      ) : null,
    /** For the menu's content: runs a press once the menu has gone. */
    onCloseAutoFocus: (event: Event) => {
      const [press] = pending;
      if (press) {
        pending.clear();
        event.preventDefault();
        press();
      }
    },
    /** For the menu: reads what the row has folded as it opens. */
    onOpenChange: (open: boolean) => {
      if (open) {
        setOpened({
          folds: rowFoldsOf(trigger.current),
          row: trigger.current?.closest("[data-tab-location]") ?? null,
        });
      }
    },
    /** For the menu's trigger. */
    triggerProps: { "data-row-menu": "", ref: trigger },
  };
}
