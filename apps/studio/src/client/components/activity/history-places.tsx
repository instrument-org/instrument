import { SHOW_LABELS } from "@/client/components/activity/activity-timeline";
import { cn } from "@/client/lib/utils";
import { type Show } from "@/shared/history-show";
import { ChartBarIcon } from "@phosphor-icons/react/ChartBar";
import { ChatCircleIcon } from "@phosphor-icons/react/ChatCircle";
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react/ClockCounterClockwise";
import { FileIcon } from "@phosphor-icons/react/File";
import { GlobeIcon } from "@phosphor-icons/react/Globe";
import { PencilSimpleIcon } from "@phosphor-icons/react/PencilSimple";
import { StackIcon } from "@phosphor-icons/react/Stack";
import { type ComponentType, Fragment } from "react";

const PLACES: {
  icon: ComponentType<{ className?: string }>;
  show: Show | undefined;
}[] = [
  { icon: ClockCounterClockwiseIcon, show: undefined },
  { icon: GlobeIcon, show: "pages" },
  { icon: FileIcon, show: "files" },
  { icon: ChatCircleIcon, show: "chats" },
  { icon: PencilSimpleIcon, show: "changes" },
  { icon: ChartBarIcon, show: "ai" },
  { icon: StackIcon, show: "closed" },
];

/**
 * What History shows, one at a time: everything, one kind of row, or, past a
 * line, the tab groups closed lately. A list beside the rows, or on a page
 * too narrow for one a line of pills over them.
 */
export function HistoryPlaces({
  closedCount,
  isNarrow,
  onShow,
  show,
}: {
  closedCount: number;
  isNarrow: boolean;
  onShow: (show: Show | undefined) => void;
  show: Show | undefined;
}) {
  return (
    <nav
      aria-label="History"
      className={
        isNarrow
          ? "flex shrink-0 flex-wrap items-center gap-1 border-b border-border px-4 py-2"
          : "flex w-48 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border px-2.5 py-3"
      }
    >
      {PLACES.map(({ icon: Icon, show: each }) => {
        const label = each === undefined ? "All" : SHOW_LABELS[each];
        return (
          <Fragment key={label}>
            {each === "closed" && !isNarrow ? (
              <div className="my-1.5 h-px shrink-0 bg-border" />
            ) : null}
            <button
              aria-current={show === each ? "page" : undefined}
              className={
                isNarrow
                  ? cn(
                      "h-7 rounded-full px-3 text-[13px]",
                      show === each
                        ? "bg-foreground text-background"
                        : "text-muted-foreground ring-1 ring-border hover:bg-foreground/5 hover:text-foreground",
                    )
                  : cn(
                      "flex h-8 w-full shrink-0 items-center gap-2 rounded-lg px-2 text-left text-sm",
                      show === each
                        ? "bg-foreground/8 font-medium"
                        : "hover:bg-foreground/5",
                    )
              }
              onClick={() => {
                onShow(each);
              }}
              type="button"
            >
              {isNarrow ? null : (
                <Icon className="size-4 shrink-0 text-foreground/70" />
              )}
              <span className="min-w-0 flex-1 truncate">{label}</span>
              {each === "closed" && !isNarrow && closedCount > 0 ? (
                <span className="text-xs font-normal text-muted-foreground tabular-nums">
                  {closedCount}
                </span>
              ) : null}
            </button>
          </Fragment>
        );
      })}
    </nav>
  );
}
