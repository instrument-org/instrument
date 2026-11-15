import { EntryIcon } from "@/client/components/activity/activity-icons";
import {
  ENTRY_ROW,
  EntryWords,
  TIME_COLUMN,
} from "@/client/components/activity/activity-page";
import { useModelName } from "@/client/components/activity/activity-requests";
import {
  bringsBack,
  entryText,
  type TimelineEntry,
  timelineOf,
  turnPlaceOf,
  placeOf,
} from "@/client/components/activity/activity-timeline";
import {
  useClosedTabs,
  useRestoreClosed,
} from "@/client/components/activity/recently-closed";
import { ToolbarTooltip } from "@/client/components/toolbar-tooltip";
import { Button } from "@/client/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/client/components/ui/popover";
import { useGesturesFor } from "@/client/hooks/use-open-target";
import { displayLocale } from "@/client/lib/display-locale";
import { cn, osConventions } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { SCREENS } from "@/shared/instrument-screens";
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react/ClockCounterClockwise";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

/** How many rows the popover lists, newest first. */
const SHOWN = 8;

/**
 * How many of the newest actions are read for those rows: most of what a
 * person does is a place visited, so this many leaves enough after the
 * rest are taken out.
 */
const READ = 100;

/** How often the rows are read again while the popover is open. */
const LIVE_MS = 2000;

const timeFormat = new Intl.DateTimeFormat(displayLocale, {
  hour: "numeric",
  minute: "2-digit",
});

/**
 * The sidebar's History button: a press opens the newest of History's rows
 * that bring something back, drawn as its page draws them, over a row that
 * opens the whole page as a tab.
 * ⌘Y opens the page itself.
 */
export function HistoryButton({
  onShowAll,
}: {
  /** Opens History's page as a tab. */
  onShowAll: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover onOpenChange={setOpen} open={open}>
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
      <PopoverContent align="end" className="w-95 overflow-hidden p-0">
        <div className="flex h-10 items-center border-b border-border px-4 text-[13px] font-semibold">
          {SCREENS.activity.title}
        </div>
        {open && (
          <HistoryRows
            onDone={() => {
              setOpen(false);
            }}
          />
        )}
        <div className="border-t border-border p-1">
          <button
            className="flex h-8 w-full items-center rounded-md px-3 text-left text-[13px] outline-none hover:bg-foreground/5 focus-visible:bg-foreground/5"
            onClick={() => {
              setOpen(false);
              onShowAll();
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

/**
 * The newest of History's rows that bring something back: the tabs and tab
 * groups closed, restored by a press, and the places visited, opened by one.
 * Read afresh as it opens and every few seconds while it is open, and the
 * closed list as it changes.
 */
function HistoryRows({ onDone }: { onDone: () => void }) {
  const modelName = useModelName();
  const gesturesFor = useGesturesFor();
  const restore = useRestoreClosed();
  const closed = useClosedTabs();
  const words = { trash: osConventions().trash };
  const actions = useQuery({
    ...rpcClient.actions.list.queryOptions({
      input: { limit: READ, since: 0 },
    }),
    refetchInterval: LIVE_MS,
  });
  if (actions.isPending) {
    return <div className="h-20" />;
  }
  // The closed tabs go in among the actions read, as far back as those go.
  const { entries } = timelineOf({
    actions: {
      complete: actions.data?.next === null,
      items: actions.data?.actions ?? [],
    },
    closed,
    requests: { complete: true, items: [] },
    view: "yours",
  });
  const shown = entries.filter(bringsBack).slice(0, SHOWN);
  if (shown.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-[13px] text-muted-foreground">
        Tabs you close and places you visit show up here.
      </p>
    );
  }
  const openEntry = (entry: TimelineEntry) => {
    onDone();
    if (entry.kind === "closed") {
      restore(entry.closed);
      return;
    }
    const target =
      entry.kind === "turn" ? turnPlaceOf(entry.turn) : placeOf(entry.action);
    if (target) {
      gesturesFor(target).primary?.run();
    }
  };
  return (
    <div className="p-1">
      {shown.map((entry) => {
        const text = entryText(entry, { modelName, words });
        return (
          <button
            className={cn(
              "flex min-h-9 w-full cursor-default items-center gap-3 rounded-md px-3 text-left outline-none hover:bg-foreground/5 focus-visible:bg-foreground/5",
              ENTRY_ROW,
            )}
            key={entry.id}
            onClick={() => {
              openEntry(entry);
            }}
            type="button"
          >
            <span className="grid size-5 shrink-0 place-items-center">
              <EntryIcon entry={entry} />
            </span>
            <EntryWords
              at={entry.at}
              context={text.context}
              keepContext={entry.kind === "closed"}
              title={text.title}
            />
            <span
              className={cn(
                "shrink-0 text-xs text-muted-foreground tabular-nums",
                TIME_COLUMN,
              )}
            >
              {timeFormat.format(entry.at)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
