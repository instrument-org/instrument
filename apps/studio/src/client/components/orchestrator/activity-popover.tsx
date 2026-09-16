import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/client/components/ui/popover";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/ArrowSquareOut";
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react/ClockCounterClockwise";
import { useState } from "react";

import { type ActivityFilters, NO_ACTIVITY_FILTERS } from "./activity";
import { ActivityFilterBar } from "./activity-filter-bar";
import { ActivityList } from "./activity-list";
import { useAppsBySlug } from "./apps-by-slug";
import { useOrchestrator } from "./context";
import { ACTIVITY_HREF } from "./screen-presentation";
import { useActivity } from "./use-activity";

/**
 * Activity behind a clock at the right end of the window bar: the same rows
 * as the page, in a tall panel that scrolls, for flipping between places
 * without leaving the one that is up. Whose side is shown and Topics along
 * its top, since that is what fits; the foot opens the page with the rest.
 * A row opening something closes the panel, since what it opened is now
 * where the eye is. The filters hold while the window lives, so the panel
 * reopens the way it was left.
 */
export function ActivityPopover() {
  const [open, setOpen] = useState(false);
  const [filters, setFilters] = useState<ActivityFilters>(NO_ACTIVITY_FILTERS);
  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <button
          aria-label="Activity"
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/50 hover:text-foreground data-[state=open]:bg-accent/50 data-[state=open]:text-foreground"
          title="Activity"
          type="button"
        >
          <ClockCounterClockwiseIcon className="size-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        aria-label="Activity"
        className="flex w-112 flex-col p-0"
        maxHeight="44rem"
        side="bottom"
        sideOffset={4}
      >
        {/* Mounted only while open, so the live log is read only then. */}
        <Panel
          filters={filters}
          onClose={() => {
            setOpen(false);
          }}
          onFiltersChange={setFilters}
        />
      </PopoverContent>
    </Popover>
  );
}

function Panel({
  filters,
  onClose,
  onFiltersChange,
}: {
  filters: ActivityFilters;
  onClose: () => void;
  onFiltersChange: (filters: ActivityFilters) => void;
}) {
  const orchestrator = useOrchestrator();
  const activity = useActivity(orchestrator.taskId);
  const appsBySlug = useAppsBySlug();
  return (
    <>
      <div className="shrink-0 border-b border-border px-3 py-2">
        <ActivityFilterBar
          appsBySlug={appsBySlug}
          filters={filters}
          groups={["topics"]}
          onFiltersChange={onFiltersChange}
          rows={activity.rows}
          topics={activity.topics}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1 py-1">
        <ActivityList
          appsBySlug={appsBySlug}
          filters={filters}
          isLoading={activity.isLoading}
          onOpened={onClose}
          rows={activity.rows}
          topics={activity.topics}
        />
      </div>
      <div className="flex shrink-0 justify-end border-t border-border px-2 py-1.5">
        <button
          className="flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] text-muted-foreground hover:bg-accent/50 hover:text-foreground"
          onClick={() => {
            orchestrator.openScreen(ACTIVITY_HREF);
            onClose();
          }}
          type="button"
        >
          <ArrowSquareOutIcon className="size-3.5" />
          Open Activity
        </button>
      </div>
    </>
  );
}
