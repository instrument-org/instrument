import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/client/components/ui/popover";
import { Switch } from "@/client/components/ui/switch";
import { cn } from "@/client/lib/utils";
import { CheckIcon } from "@phosphor-icons/react/Check";
import { NotificationIcon } from "@phosphor-icons/react/Notification";
import {
  OneLineIcon,
  ThreeLinesIcon,
  TwoLinesIcon,
} from "@/client/components/icons/row-density-icons";
import { StarIcon } from "@phosphor-icons/react/Star";
import { useAtom } from "jotai";
import { type ComponentType } from "react";

import { type ChatTag } from "./chats";
import {
  groupByDayAtom,
  type RowDensity,
  rowDensityAtom,
} from "./chat-list-view";
import { type SearchToken } from "./search-field";

/** The marks the search offers as tokens, in the order it offers them. */
export const TAGS: SearchToken<ChatTag>[] = [
  {
    icon: <NotificationIcon weight="fill" />,
    id: "unread",
    label: "Unread",
  },
  {
    icon: <StarIcon className="text-warning-500" weight="fill" />,
    id: "bookmarked",
    label: "Bookmarked",
  },
];

/** A square control at the head's height, its glyph in the muted ink. */
const HEAD_ICON_BUTTON =
  "grid size-9 shrink-0 place-items-center rounded-lg text-muted-foreground/70 hover:bg-foreground/5 hover:text-foreground data-[state=open]:bg-foreground/6 data-[state=open]:text-foreground";

/** The row densities as the view menu offers them. */
const DENSITIES: {
  icon: ComponentType<{ className?: string }>;
  id: RowDensity;
  label: string;
  note: string;
}[] = [
  {
    icon: ThreeLinesIcon,
    id: "three",
    label: "Three lines",
    note: "Title, preview, project and files",
  },
  {
    icon: TwoLinesIcon,
    id: "two",
    label: "Two lines",
    note: "Title, then project or last reply",
  },
  { icon: OneLineIcon, id: "one", label: "One line", note: "Just the titles" },
];

/**
 * The view button at the search's end, wearing the density the rows are
 * drawn at: under it the three densities and, for a list that has them, the
 * switch that puts a heading over each day. Both are kept for every window
 * on this computer.
 */
export function ViewButton({
  className,
  densityAtom = rowDensityAtom,
  hasDayHeadings = true,
}: {
  className?: string;
  /** Where the rows it sets are kept: the chat list's by default. */
  densityAtom?: typeof rowDensityAtom;
  /** Whether the list it sets puts a heading over each day when asked. */
  hasDayHeadings?: boolean;
}) {
  const [density, setDensity] = useAtom(densityAtom);
  const [groupByDay, setGroupByDay] = useAtom(groupByDayAtom);
  const Current =
    DENSITIES.find((entry) => entry.id === density)?.icon ?? ThreeLinesIcon;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          aria-label="View options"
          className={cn(HEAD_ICON_BUTTON, className)}
          title="View options"
          type="button"
        >
          <Current className="size-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-1.5" sideOffset={6}>
        <div
          aria-label="Rows"
          className="flex flex-col gap-0.5"
          role="radiogroup"
        >
          {DENSITIES.map((entry) => {
            const isOn = entry.id === density;
            return (
              <button
                aria-checked={isOn}
                className={cn(
                  "flex items-start gap-2.5 rounded-lg px-2.5 py-2 text-left",
                  isOn ? "bg-foreground/6" : "hover:bg-foreground/4",
                )}
                key={entry.id}
                onClick={() => {
                  setDensity(entry.id);
                }}
                role="radio"
                type="button"
              >
                <entry.icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm">{entry.label}</span>
                  <span className="block text-xs text-muted-foreground">
                    {entry.note}
                  </span>
                </span>
                {isOn && <CheckIcon className="mt-0.5 size-3.5 shrink-0" />}
              </button>
            );
          })}
        </div>
        {hasDayHeadings && (
          <>
            <div className="-mx-1.5 my-1.5 h-px bg-border" />
            <label className="flex h-9 items-center justify-between px-2.5 text-sm">
              Group by day
              <Switch checked={groupByDay} onCheckedChange={setGroupByDay} />
            </label>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
