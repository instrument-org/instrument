import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/client/components/ui/context-menu";
import { appTabsAtom } from "@/client/components/window/app-tabs";
import {
  type ClosedGroup,
  closedGroupsOf,
} from "@/client/components/window/closed-groups";
import { GroupRowLines } from "@/client/components/window/group-row-lines";
import { ShellContext } from "@/client/components/window/shell-context";
import { useTabTitle } from "@/client/components/window/tab-title";
import { forgetClosed } from "@/client/lib/tabs-model";
import { cn } from "@/client/lib/utils";
import { type ChatId } from "@instrument-org/workspace/client";
import { useAtomValue, useStore } from "jotai";
import { useContext } from "react";

const NO_TITLES = new Map<ChatId, string>();

/** How many closed groups All shows over its rows. */
const CARDS_IN_ALL = 3;

/** The tab groups this window closed, newest first, from the list Shift+Cmd+T reopens, and the words a search finds each by. */
export function useClosedGroups(): { group: ClosedGroup; words: string }[] {
  const shell = useContext(ShellContext);
  const list = useAtomValue(appTabsAtom).recentlyClosed;
  const titleOf = useTabTitle(shell?.chatTitles ?? NO_TITLES);
  return closedGroupsOf(list).map((group) => ({
    group,
    words: group.sides
      .flatMap((side) =>
        side.tabs.map(
          (tab) =>
            `${titleOf(tab)}\n${tab.kind === "page" ? (tab.url ?? "") : ""}`,
        ),
      )
      .join("\n")
      .toLowerCase(),
  }));
}

/** The newest closed groups over All's rows, in one line of cards; nothing when none has closed. */
export function RecentlyClosedCards({
  groups,
}: {
  groups: readonly ClosedGroup[];
}) {
  return (
    <section className="pb-5">
      <h2 className="pb-2 text-[13px] font-medium">Recently closed</h2>
      <CardGrid groups={groups.slice(0, CARDS_IN_ALL)} isOneLine />
    </section>
  );
}

/** Every closed group as a card, a grid per day, under the day's head. */
export function ClosedGroupDays({
  dayOf,
  groups,
}: {
  /** The head of the day a time falls on. */
  dayOf: (at: number) => string;
  groups: readonly ClosedGroup[];
}) {
  const days = new Map<string, ClosedGroup[]>();
  for (const group of groups) {
    // One closed before closes were timed is older than any that is.
    const day =
      group.closedAt === undefined ? "Earlier" : dayOf(group.closedAt);
    days.set(day, [...(days.get(day) ?? []), group]);
  }
  return [...days].map(([day, closed]) => (
    <section className="pb-5" key={day}>
      <h2 className="pb-2 text-[13px] font-medium">{day}</h2>
      <CardGrid groups={closed} />
    </section>
  ));
}

function CardGrid({
  groups,
  isOneLine = false,
}: {
  groups: readonly ClosedGroup[];
  /** Whether a narrow page leaves out the cards past its first line. */
  isOneLine?: boolean;
}) {
  // As many columns whatever there is to fill them, so one card alone keeps
  // a card's width.
  return (
    <div className="grid grid-cols-3 gap-2 @max-[560px]/list:grid-cols-2">
      {groups.map((group, index) => (
        <ClosedGroupCard
          className={cn(isOneLine && index >= 2 && "@max-[560px]/list:hidden")}
          group={group}
          key={group.id}
        />
      ))}
    </div>
  );
}

/** A closed tab group, as the sidebar's row showed it as it closed; a press brings it back. */
function ClosedGroupCard({
  className,
  group,
}: {
  className?: string;
  group: ClosedGroup;
}) {
  const shell = useContext(ShellContext);
  const store = useStore();
  const reopen = () => {
    shell?.reopenClosed(group.id);
  };
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          className={cn(
            "flex min-w-0 rounded-xl border border-border bg-card px-3 py-2 text-left hover:bg-accent",
            className,
          )}
          onClick={reopen}
          type="button"
        >
          <GroupRowLines
            chatTitles={shell?.chatTitles ?? NO_TITLES}
            isOnScreen={false}
            sides={group.sides}
          />
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <ContextMenuItem onSelect={reopen}>Reopen</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onSelect={() => {
            store.set(appTabsAtom, (current) =>
              forgetClosed(current, { id: group.id }),
            );
          }}
          variant="destructive"
        >
          Remove from History
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
