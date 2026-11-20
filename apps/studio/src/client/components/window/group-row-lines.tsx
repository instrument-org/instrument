import { type WindowTab } from "@/client/atoms/window";
import { ShimmerSweep } from "@/client/components/shimmer-sweep";
import { hostPathOfFileUrl } from "@/client/lib/file-url";
import { cn } from "@/client/lib/utils";
import { extensionOf } from "@/shared/rendered-kinds";
import { XIcon } from "@phosphor-icons/react/X";
import { type ChatId } from "@instrument-org/workspace/client";
import { Fragment } from "react";

import { useAppsBySlug } from "./apps-by-slug";
import { chatDotOf, ChatMarkIcon } from "./chat-mark";
import { FadeTitle } from "./fade-title";
import { RowActionBar } from "./row-action-bar";
import { siteOf } from "./row-lines";
import { TabMark, TONE_INK, useRowLines, useRowSources } from "./row-half";
import { screenLocation } from "./screen-presentation";
import { chatOfTab } from "./tab-model";
import { useTaskTitles } from "./task-titles";

/** A group's sides as its row reads them: each side's tabs and the one in front, the left side first. */
type RowSides = readonly [RowSide, ...RowSide[]];
type RowSide = { tabs: readonly WindowTab[]; up: WindowTab };

/** The tab a group's row goes by: its first chat, else the left side's front tab. */
export function leadTabOf(sides: RowSides): WindowTab {
  return (
    sides
      .flatMap((side) => side.tabs)
      .find((tab) => chatOfTab(tab) !== undefined) ?? sides[0].up
  );
}

/** A run of tabs side by side in one side that wear the same mark, drawn once with their count. */
interface MarkRun {
  count: number;
  key: string;
  tab: WindowTab;
}

/**
 * A tab group's row as two lines of a fixed height: the group's title over
 * every tab's mark in tab order, side by side with a gap between the sides,
 * then what its lead tab says. The lead is its first chat, else the left
 * side's front tab, so a group with a chat goes by that chat wherever it
 * sits. Tabs beside each other that wear the same mark (five pages of one
 * site, three wireframes) are one mark and their count. Under the pointer,
 * one X at the row's end closes the whole group.
 */
export function GroupRowLines({
  chatTitles,
  close,
  isCloseShown,
  isOnScreen,
  sides,
}: {
  chatTitles: Map<ChatId, string>;
  close?: { label: string; run: () => void } | undefined;
  isCloseShown: boolean;
  /** Whether the group is up: a chat's mark wears no dot there. */
  isOnScreen: boolean;
  sides: RowSides;
}) {
  const appsBySlug = useAppsBySlug();
  const taskTitles = useTaskTitles();
  const { chats } = useRowSources();
  const lines = useRowLines(leadTabOf(sides), chatTitles);
  const keyOf = (tab: WindowTab): string => {
    if (tab.kind === "page") {
      const path = hostPathOfFileUrl(tab.url);
      return path === undefined
        ? `site:${siteOf(tab.url ?? tab.openedUrl)}`
        : `file:${extensionOf(path)}`;
    }
    const location = screenLocation(tab.href, {
      appsBySlug,
      chatTitles,
      taskTitles,
    });
    if (location.kind === "file") {
      return `file:${extensionOf(location.path)}`;
    }
    return location.kind === "chat" ? `chat:${tab.id}` : location.kind;
  };
  const runsOf = (tabs: readonly WindowTab[]) =>
    tabs.reduce<MarkRun[]>((runs, tab) => {
      const key = keyOf(tab);
      const last = runs.at(-1);
      if (last?.key === key) {
        last.count += 1;
      } else {
        runs.push({ count: 1, key, tab });
      }
      return runs;
    }, []);
  const markOf = (tab: WindowTab) => {
    const chat = chatOfTab(tab);
    return (
      <ChatMarkIcon
        dot={
          chat === undefined || isOnScreen
            ? undefined
            : chatDotOf(chats.find((each) => each.id === chat))
        }
        icon={
          <TabMark appsBySlug={appsBySlug} chatTitles={chatTitles} tab={tab} />
        }
      />
    );
  };
  return (
    <div
      className="flex min-w-0 flex-1 basis-0 items-center gap-1"
      data-row-half=""
    >
      <div className="flex h-10 min-w-0 flex-1 flex-col justify-center">
        <FadeTitle
          className={cn(
            "h-5 min-w-0 text-[13px] leading-5",
            lines.strong
              ? "font-semibold text-foreground"
              : "font-medium text-foreground/85",
          )}
        >
          {lines.title}
        </FadeTitle>
        <div className="flex h-5 min-w-0 items-center gap-1.5 text-[12px] leading-5">
          <span className="flex shrink-0 items-center gap-1 text-foreground/65">
            {sides.map((side, index) => (
              <Fragment key={side.up.id}>
                {index > 0 && (
                  <span
                    aria-hidden
                    className="mx-0.5 h-3 w-px bg-foreground/15"
                  />
                )}
                {runsOf(side.tabs).map((run) => (
                  <span className="flex items-center gap-0.5" key={run.tab.id}>
                    {markOf(run.tab)}
                    {run.count > 1 && (
                      <span className="text-[11px] text-muted-foreground tabular-nums">
                        {run.count}
                      </span>
                    )}
                  </span>
                ))}
              </Fragment>
            ))}
          </span>
          {lines.line !== "" &&
            (lines.tone === "work" ? (
              <span className="brand-shiny-text min-w-0 truncate">
                {lines.line}
                <ShimmerSweep text={lines.line} />
              </span>
            ) : (
              <span className={cn("min-w-0 truncate", TONE_INK[lines.tone])}>
                {lines.line}
              </span>
            ))}
        </div>
      </div>
      {close && (
        <RowActionBar
          actions={[
            {
              icon: <XIcon />,
              id: "close",
              label: close.label,
              run: close.run,
            },
          ]}
          isHeld={isCloseShown}
        />
      )}
    </div>
  );
}
