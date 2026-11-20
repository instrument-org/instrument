import { type ClosedTabs } from "@/client/components/activity/activity-timeline";
import { useAppsBySlug } from "@/client/components/window/apps-by-slug";
import { appTabsAtom } from "@/client/components/window/app-tabs";
import { TabMark } from "@/client/components/window/row-half";
import { ShellContext } from "@/client/components/window/shell-context";
import {
  closedGroupTabOf,
  closedSideOf,
  closedSidesOf,
  closedTabGroupOf,
} from "@/client/components/window/tab-model";
import { useTabTitle } from "@/client/components/window/tab-title";
import { forgetClosed } from "@/client/lib/tabs-model";
import { cn } from "@/client/lib/utils";
import { type ChatId } from "@instrument-org/workspace/client";
import { StackIcon } from "@phosphor-icons/react/Stack";
import { useAtomValue, useStore } from "jotai";
import { useContext } from "react";

const NO_TITLES = new Map<ChatId, string>();

/**
 * The tabs, sides and tab groups this window closed, from the list Shift+Cmd+T
 * reopens, each with when it closed, for Activity to list among the rest.
 * An entry from before closes were timed has no place in time, so it stays
 * off the list, as does a tab of the window's own strip rather than a group.
 */
export function useClosedTabs(): { at: number; closed: ClosedTabs }[] {
  const shell = useContext(ShellContext);
  const list = useAtomValue(appTabsAtom).recentlyClosed;
  const titleOf = useTabTitle(shell?.chatTitles ?? NO_TITLES);
  if (!shell) {
    return [];
  }
  return list.flatMap((entry) => {
    const group = closedTabGroupOf(entry);
    const tabs = group ?? [closedGroupTabOf(entry)].filter((tab) => !!tab);
    const sides = closedSidesOf(entry);
    if (entry.closedAt === undefined || tabs.length === 0 || !sides) {
      return [];
    }
    return [
      {
        at: entry.closedAt,
        closed: {
          id: entry.id,
          kind:
            group === undefined
              ? "tab"
              : closedSideOf(entry)
                ? "side"
                : "group",
          sides,
          tabs: tabs.map((tab) => ({ tab, title: titleOf(tab) })),
        },
      },
    ];
  });
}

/** Brings one closed entry back as it was, the way Shift+Cmd+T would. */
export function useRestoreClosed() {
  const shell = useContext(ShellContext);
  return (closed: ClosedTabs) => {
    shell?.reopenClosed(closed.id);
  };
}

/** A closed row's mark: its tab's own, or a stack for a whole tab group or a side of several. */
export function ClosedMark({
  className,
  closed,
}: {
  className?: string;
  closed: ClosedTabs;
}) {
  const [first] = closed.tabs;
  if (
    !first ||
    closed.kind === "group" ||
    (closed.kind === "side" && closed.tabs.length > 1)
  ) {
    return <StackIcon className={cn("size-4 text-foreground/60", className)} />;
  }
  return <ClosedTabMark tab={first.tab} />;
}

function ClosedTabMark({ tab }: { tab: ClosedTabs["tabs"][number]["tab"] }) {
  const shell = useContext(ShellContext);
  const appsBySlug = useAppsBySlug();
  return (
    <TabMark
      appsBySlug={appsBySlug}
      chatTitles={shell?.chatTitles ?? NO_TITLES}
      tab={tab}
    />
  );
}

/** The tabs a closed entry had, a line each with its mark and title, in their order. */
export function ClosedTabRows({ closed }: { closed: ClosedTabs }) {
  return (
    <ul className="flex flex-col">
      {closed.tabs.map(({ tab, title }) => (
        <li
          className="flex h-8 min-w-0 items-center gap-2.5 px-1 text-sm"
          key={tab.id}
        >
          <span className="grid size-4 shrink-0 place-items-center">
            <ClosedTabMark tab={tab} />
          </span>
          <span className="min-w-0 truncate">{title}</span>
        </li>
      ))}
    </ul>
  );
}

/** Takes closed entries off the list, so neither Activity nor Shift+Cmd+T brings them back. */
export function useForgetClosed() {
  const store = useStore();
  return (closed: readonly ClosedTabs[]) => {
    for (const { id } of closed) {
      store.set(appTabsAtom, (current) => forgetClosed(current, { id }));
    }
  };
}
