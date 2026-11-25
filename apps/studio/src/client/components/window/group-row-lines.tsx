import { type WindowTab } from "@/client/atoms/window";
import { ShimmerSweep } from "@/client/components/shimmer-sweep";
import { hostPathOfFileUrl } from "@/client/lib/file-url";
import { cn } from "@/client/lib/utils";
import { extensionOf } from "@/shared/rendered-kinds";
import { XIcon } from "@phosphor-icons/react/X";
import { type ChatId } from "@instrument-org/workspace/client";
import { useState } from "react";

import { useAppsBySlug } from "./apps-by-slug";
import { chatDotOf, ChatMarkIcon } from "./chat-mark";
import { FadeTitle } from "./fade-title";
import { RowActionBar } from "./row-action-bar";
import { type RowLines, siteOf, tabsBesideLead } from "./row-lines";
import { TabMark, TONE_INK, useRowLines, useRowSources } from "./row-half";
import { screenLocation } from "./screen-presentation";
import { chatOfTab } from "./tab-model";
import { useTaskTitles } from "./task-titles";

/** A group's sides as its row reads them: each side's tabs and the one in front, the left side first. */
type RowSides = readonly [RowSide, ...RowSide[]];
type RowSide = { tabs: readonly WindowTab[]; up: WindowTab };

/**
 * The tab a group's row goes by: its first chat, else the left side's tab
 * that was in front when the group was last left. While the group is up, the
 * row keeps that tab, so picking another tab in it does not rename it; the
 * front tab at the moment the group goes out of sight becomes the new one.
 * A tab since closed gives way to the front tab.
 */
function useLeadTab(sides: RowSides, isOnScreen: boolean): WindowTab {
  const front = sides[0].up;
  const [held, setHeld] = useState(front.id);
  const [wasOnScreen, setWasOnScreen] = useState(isOnScreen);
  if (wasOnScreen !== isOnScreen) {
    setWasOnScreen(isOnScreen);
    if (!isOnScreen) {
      setHeld(front.id);
    }
  }
  return (
    sides
      .flatMap((side) => side.tabs)
      .find((tab) => chatOfTab(tab) !== undefined) ??
    sides[0].tabs.find((tab) => tab.id === held) ??
    front
  );
}

/** How many marks a row draws after its title. */
const MOST_MARKS = 5;

/** A run of tabs side by side in one side that wear the same mark, drawn once with their count. */
interface MarkRun {
  count: number;
  key: string;
  tab: WindowTab;
}

/**
 * A tab group's row as two lines of a fixed height. The first is the lead
 * tab's mark and title, with the X that closes the whole group at its end
 * under the pointer; the second is what the lead tab says, in words under its
 * title, then every other tab's mark at the line's far end, in tab order
 * whichever side each is in. No mark stands under the lead tab's. The
 * lead tab is the group's first chat, else the left side's tab in front
 * when the group was last left (`useLeadTab`), so a group with a chat goes by
 * that chat wherever it sits. Tabs beside each
 * other that wear the same mark (five pages of one site, three wireframes)
 * are one mark and their count, and a tab on the very thing the lead tab is
 * on (one file open twice) has none. Only the first few marks are drawn, so
 * a group of many tabs still shows its title. A chat that is not the lead
 * has no line to say it is at work, so its mark wears the working pulse.
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
  /** Whether the group is up: the tabs in front then wear no unread dot, as in their strips. */
  isOnScreen: boolean;
  sides: RowSides;
}) {
  const appsBySlug = useAppsBySlug();
  const taskTitles = useTaskTitles();
  const { chats } = useRowSources();
  const lead = useLeadTab(sides, isOnScreen);
  const lines = useRowLines(lead, chatTitles);
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
  const dotOf = (chat: ChatId, tab: WindowTab) => {
    const dot = chatDotOf(
      chats.find((each) => each.id === chat),
      { isWorkShown: tab.id !== lead.id },
    );
    const isSeen = isOnScreen && sides.some((side) => side.up.id === tab.id);
    return dot === "unread" && isSeen ? undefined : dot;
  };
  const markOf = (tab: WindowTab) => {
    const chat = chatOfTab(tab);
    return (
      <ChatMarkIcon
        dot={chat === undefined ? undefined : dotOf(chat, tab)}
        icon={
          <TabMark appsBySlug={appsBySlug} chatTitles={chatTitles} tab={tab} />
        }
      />
    );
  };
  const others = runsOf(
    tabsBesideLead(
      sides.flatMap((side) => side.tabs),
      lead,
    ),
  ).slice(0, MOST_MARKS);
  const otherMarks = others.length > 0 && (
    <span className="ml-auto flex shrink-0 items-center gap-1 text-foreground/65">
      {others.map((run) => (
        <span className="flex items-center gap-0.5" key={run.tab.id}>
          {markOf(run.tab)}
          {run.count > 1 && (
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {run.count}
            </span>
          )}
        </span>
      ))}
    </span>
  );
  return (
    <div
      className="flex h-10 min-w-0 flex-1 basis-0 flex-col justify-center"
      data-row-half=""
    >
      <div className="flex h-5 min-w-0 items-center gap-2">
        <span className="grid w-4 shrink-0 place-items-center text-foreground/65">
          {markOf(lead)}
        </span>
        <FadeTitle
          className={cn(
            "min-w-0 flex-1 text-[13px] leading-5",
            lines.strong
              ? "font-semibold text-foreground"
              : "font-medium text-foreground/85",
          )}
        >
          {lines.title}
        </FadeTitle>
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
      {(lines.line !== "" || otherMarks) && (
        <div className="flex h-5 min-w-0 items-center gap-2 pl-6 text-[12px] leading-5">
          <SecondLine lines={lines} />
          {otherMarks}
        </div>
      )}
    </div>
  );
}

/** A row's second line in words. */
function SecondLine({ lines }: { lines: RowLines }) {
  if (lines.line === "") {
    return null;
  }
  if (lines.tone === "work") {
    return (
      <span className="brand-shiny-text min-w-0 truncate">
        {lines.line}
        <ShimmerSweep text={lines.line} />
      </span>
    );
  }
  return lines.trail && lines.trail.length > 1 ? (
    <TrailLine className={TONE_INK[lines.tone]} trail={lines.trail} />
  ) : (
    <span className={cn("min-w-0 truncate", TONE_INK[lines.tone])}>
      {lines.line}
    </span>
  );
}

/**
 * The folders to a place on one line, keeping the nearest. Laid out from the
 * last folder back, so one that does not fit wraps out of sight whole, with
 * every folder before it.
 */
function TrailLine({
  className,
  trail,
}: {
  className?: string;
  trail: readonly string[];
}) {
  const last = trail.length - 1;
  return (
    <span className="flex min-w-0">
      <span className="sr-only">{trail.join(" › ")}</span>
      <span
        aria-hidden
        className={cn(
          "flex h-5 min-w-0 flex-row-reverse flex-wrap justify-end overflow-hidden",
          className,
        )}
      >
        {trail
          .map((name, index) => (
            <span
              className={cn(
                "max-w-full",
                index === last ? "truncate" : "shrink-0 whitespace-pre",
              )}
              // oxlint-disable-next-line react/no-array-index-key -- a folder's place in the trail is what it is
              key={index}
            >
              {index === last ? name : `${name} › `}
            </span>
          ))
          .toReversed()}
      </span>
    </span>
  );
}
