import { type ClosedTabs } from "@/client/components/activity/activity-timeline";
import { useAppsBySlug } from "@/client/components/window/apps-by-slug";
import { appTabsAtom } from "@/client/components/window/app-tabs";
import { FadeTitle } from "@/client/components/window/fade-title";
import { RowHalf, TabMark } from "@/client/components/window/row-half";
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

/** How many of a side's tabs its strip draws before the rest go in a count. */
const STRIP_SHOWN = { split: 3, whole: 8 } as const;

/**
 * Closed tabs drawn as they stood: each side's tab up as its half of the
 * sidebar's row draws it (`RowHalf`), two sides split by the row's
 * hairline, and under each the side's tabs as its strip had them, squeezed:
 * the one up raised and named, the rest by their marks, and past a few a
 * count of the rest. The one up is always among those drawn.
 */
export function ClosedTabsPicture({ closed }: { closed: ClosedTabs }) {
  const shell = useContext(ShellContext);
  const chatTitles = shell?.chatTitles ?? NO_TITLES;
  const titles = new Map(closed.tabs.map(({ tab, title }) => [tab.id, title]));
  const most = closed.sides.length > 1 ? STRIP_SHOWN.split : STRIP_SHOWN.whole;
  return (
    <div className="flex min-w-0 items-stretch rounded-lg px-2.5 py-1.5 ring-1 ring-foreground/8">
      {closed.sides.map((side, index) => {
        const up = side.tabs.find((tab) => tab.id === side.up) ?? side.tabs[0];
        const first = side.tabs.slice(0, most);
        const shown =
          up && !first.includes(up) ? [...first.slice(0, -1), up] : first;
        const rest = side.tabs.length - shown.length;
        return (
          <div className="flex min-w-0 flex-1 basis-0" key={up?.id ?? index}>
            {index > 0 && (
              <span className="mx-2 my-0.5 w-px shrink-0 self-stretch bg-foreground/12" />
            )}
            <div className="flex min-w-0 flex-1 flex-col">
              {up && (
                <RowHalf chatTitles={chatTitles} isOnScreen={false} tab={up} />
              )}
              {side.tabs.length > 1 && (
                <div className="flex min-w-0 items-center gap-0.5 pb-0.5">
                  {shown.map((tab) => {
                    const isUp = tab === up;
                    return (
                      <span
                        className={cn(
                          "flex h-6 items-center gap-1.5 rounded-lg text-[12px] font-medium",
                          isUp
                            ? "max-w-40 min-w-14 flex-1 bg-background px-1.5 text-foreground shadow-xs-soft"
                            : "w-6 shrink-0 justify-center text-foreground/55 dark:text-foreground/65",
                        )}
                        key={tab.id}
                        title={titles.get(tab.id)}
                      >
                        <span className="grid size-3.5 shrink-0 place-items-center">
                          <ClosedTabMark tab={tab} />
                        </span>
                        {isUp && (
                          <FadeTitle className="min-w-0 flex-1 whitespace-nowrap">
                            {titles.get(tab.id)}
                          </FadeTitle>
                        )}
                      </span>
                    );
                  })}
                  {rest > 0 && (
                    <span className="shrink-0 px-1 text-[12px] text-muted-foreground tabular-nums">
                      +{rest} more
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
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
