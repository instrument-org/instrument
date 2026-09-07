import { InstrumentGlyph } from "@/client/components/wordmark";
import { cn } from "@/client/lib/utils";
import { PlusIcon } from "@phosphor-icons/react/Plus";
import { useState } from "react";

/** What a channel is marked with, whatever the user has and has not chosen. */
export interface ChannelMark {
  color?: string;
  emoji?: string;
  /** The app's own channel, which wears the mark and takes no emoji. */
  isHome?: boolean;
  name?: string;
}

/** A channel as the rail draws it: what stands for it, and what it wants. */
export interface RailChannel {
  color?: string;
  emoji?: string;
  id: string;
  name: string;
  /** An ask is waiting on the user in it: it has stopped until they answer. */
  needsYou?: boolean;
  /** Agent messages since the user last had it on screen. */
  unread: number;
  /** A task filed from it is working. */
  working?: boolean;
}

/**
 * The color a channel with no chosen one is drawn in, from its name, so it
 * keeps the same one for as long as it is called that.
 */
const ASSIGNED = [
  "#3b6ef6",
  "#e0562f",
  "#0f9d6e",
  "#8b5cf6",
  "#d4a017",
  "#0891b2",
  "#db2777",
  "#65a30d",
];
/** The tile a channel's mark sits on, tinted by the color it carries. */
export function ChannelChip({
  channel,
  className,
}: {
  channel: ChannelMark;
  className?: string;
}) {
  const tint =
    channel.color ??
    (channel.isHome ? undefined : assignedColor(channel.name ?? ""));
  return (
    <span
      className={cn(
        "grid size-9 shrink-0 place-items-center rounded-xl text-[17px] ring-1 ring-inset",
        className,
      )}
      // A tint rather than a fill: the emoji has to stay legible on it, and a
      // column of solid squares would read as a toolbar. The ring takes the
      // color too, which is what makes it visible at all on a dark ground.
      style={
        tint
          ? ({
              background: `${tint}2e`,
              // Tailwind's ring color is a custom property, which React's
              // style typing has no room for.
              "--tw-ring-color": `${tint}59`,
            } as React.CSSProperties)
          : undefined
      }
    >
      <ChannelFace channel={channel} />
    </span>
  );
}

/**
 * What stands for a channel wherever one is named. Its emoji if it has one,
 * the mark for the channel the conversation started in, and otherwise the
 * first letter of its name: a channel made before there were emoji, or one
 * whose emoji the user never chose, still has to be told apart from its
 * neighbors at a glance.
 */
export function ChannelFace({
  channel,
  className,
}: {
  channel: ChannelMark;
  className?: string;
}) {
  if (channel.emoji) {
    return (
      <span className={cn("leading-none", className)}>{channel.emoji}</span>
    );
  }
  if (channel.isHome) {
    return <InstrumentGlyph className={cn("size-4 text-primary", className)} />;
  }
  // By grapheme, so a name that starts with an emoji or an accented letter
  // gives one character rather than half of one.
  const [first] = new Intl.Segmenter().segment(channel.name ?? "?");
  const letter = first?.segment ?? "?";
  return (
    <span
      className={cn("font-semibold uppercase", className)}
      style={{ color: channel.color ?? assignedColor(channel.name ?? "") }}
    >
      {letter}
    </span>
  );
}

/**
 * The channels, down the left edge of the window.
 *
 * A channel owns a window's worth of state, so its mark sits outside the
 * conversation rather than inside it: switching here changes the conversation,
 * the tabs and the pages in them. One is always open, which is what keeps the
 * composer in one place.
 */
export function ChannelRail({
  channels,
  onMenu,
  onNew,
  onSelect,
  selectedId,
}: {
  channels: RailChannel[];
  /** Right-clicked: the channel and where, for the menu the banner also opens. */
  onMenu: (id: string, at: { x: number; y: number }) => void;
  onNew: () => void;
  onSelect: (id: string) => void;
  selectedId?: string;
}) {
  return (
    <nav
      aria-label="Channels"
      className="flex w-14 shrink-0 flex-col items-center border-r border-border bg-muted/60 pt-10 pb-2 [-webkit-app-region:drag] [&_button]:[-webkit-app-region:no-drag]"
    >
      {/* `overflow-y-auto` clips anything drawn outside a tile, so the
        selected mark and the working ring are both drawn inside the tile's own
        box rather than beside it. */}
      <div className="flex min-h-0 w-full flex-1 flex-col items-center gap-1 overflow-x-clip overflow-y-auto">
        {channels.map((channel, index) => (
          <ChannelTile
            channel={{ ...channel, isHome: index === 0 }}
            isSelected={channel.id === selectedId}
            key={channel.id}
            onMenu={(at) => {
              onMenu(channel.id, at);
            }}
            onSelect={() => {
              onSelect(channel.id);
            }}
          />
        ))}
        {/* Held against the last channel rather than at the foot of the rail:
          a new one appears where this sits, so the control and its outcome
          are in the same place however many channels there are. */}
        <button
          aria-label="New channel"
          className="grid size-9 shrink-0 place-items-center rounded-xl border border-dashed border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground"
          onClick={onNew}
          type="button"
        >
          <PlusIcon className="size-4" />
        </button>
      </div>
    </nav>
  );
}

function assignedColor(name: string) {
  let sum = 0;
  for (const character of name) {
    sum += character.codePointAt(0) ?? 0;
  }
  return ASSIGNED[sum % ASSIGNED.length];
}

/** One channel's mark, with what it is saying and the name it says on hover. */
function ChannelTile({
  channel,
  isSelected,
  onMenu,
  onSelect,
}: {
  channel: ChannelMark & RailChannel;
  isSelected: boolean;
  onMenu: (at: { x: number; y: number }) => void;
  onSelect: () => void;
}) {
  // The rail scrolls, so anything drawn beside a tile is clipped by it. The
  // name is placed against the window instead, off the button's own box.
  const [flyoutAt, setFlyoutAt] = useState<{ left: number; top: number }>();
  return (
    <div className="flex h-11 w-full shrink-0 items-center justify-center">
      <button
        aria-current={isSelected ? "true" : undefined}
        aria-label={channel.name}
        className={cn(
          "relative transition",
          isSelected ? "" : "opacity-55 hover:opacity-100",
        )}
        onClick={onSelect}
        onContextMenu={(event) => {
          event.preventDefault();
          setFlyoutAt(undefined);
          onMenu({ x: event.clientX, y: event.clientY });
        }}
        onPointerEnter={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          setFlyoutAt({ left: box.right + 8, top: box.top + box.height / 2 });
        }}
        onPointerLeave={() => {
          setFlyoutAt(undefined);
        }}
        type="button"
      >
        <ChannelChip
          channel={channel}
          className={cn(
            !channel.color && !channel.isHome ? "" : "bg-card",
            // An outline rather than a ring: the chip sets its ring color
            // inline from the channel's tint, so a selected ring would come
            // out the channel's color instead of the selection's.
            isSelected &&
              "shadow-sm outline-2 -outline-offset-2 outline-foreground/80",
            channel.working &&
              !isSelected &&
              "outline-2 -outline-offset-2 outline-primary",
          )}
        />
        {channel.needsYou ? (
          // A question rather than a warning: it is asking the user something,
          // and it takes the corner from the count because a channel that has
          // stopped is the more urgent of the two. Inside the tile's own box,
          // which is what the rail's scrolling allows.
          <span className="absolute top-0 right-0 grid size-4 place-items-center rounded-full bg-warning-500 text-[10px] font-bold text-white ring-2 ring-card">
            ?
          </span>
        ) : channel.unread > 0 ? (
          <span className="absolute top-0 right-0 grid h-4 min-w-4 place-items-center rounded-full bg-foreground px-1 text-[10px] font-medium text-background ring-2 ring-card">
            {channel.unread > 99 ? "99+" : channel.unread}
          </span>
        ) : null}
      </button>
      {flyoutAt && (
        <span
          className="pointer-events-none fixed z-50 -translate-y-1/2 rounded-md bg-popover px-2 py-1 text-xs whitespace-nowrap text-popover-foreground shadow-md ring-1 ring-border"
          style={{ left: flyoutAt.left, top: flyoutAt.top }}
        >
          {channel.name}
        </span>
      )}
    </div>
  );
}
