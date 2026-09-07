import { channelTint } from "@/client/components/orchestrator/channel-tint";
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
  // The channel the conversation started in wears the app icon: the glyph in
  // white on brand, so the app's own room is the app's own colors.
  if (channel.isHome) {
    return (
      <span
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-xl bg-brand-600 text-white",
          className,
        )}
      >
        <ChannelFace channel={channel} />
      </span>
    );
  }
  return (
    <span
      className={cn(
        "grid size-9 shrink-0 place-items-center rounded-xl text-[17px] channel-tint",
        className,
      )}
      style={{
        // A tint rather than a fill: the emoji has to stay legible on it, and a
        // column of solid squares would read as a toolbar.
        background: "var(--channel-tint-surface, var(--card))",
        ...channelTint(channel.color ?? assignedColor(channel.name ?? "")),
      }}
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
    // Sized from the text around it rather than fixed, so the glyph and an
    // emoji come out the same size wherever a face is drawn.
    return <InstrumentGlyph className={cn("size-[1.15em]", className)} />;
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
  onReorder,
  onSelect,
  selectedId,
}: {
  channels: RailChannel[];
  /** Right-clicked: the channel and where, for the menu the chip also opens. */
  onMenu: (id: string, at: { x: number; y: number }) => void;
  onNew: () => void;
  /** The order the user dragged the rail into, first channel included. */
  onReorder: (ids: string[]) => void;
  onSelect: (id: string) => void;
  selectedId?: string;
}) {
  // The channel a tile is being carried over, and which half of it, so the
  // line lands where the drop will.
  const [drag, setDrag] = useState<{
    after: boolean;
    id: string;
    over: string;
  }>();

  const dragOver = (id: string) => (event: React.DragEvent) => {
    if (!drag || drag.id === id) {
      return;
    }
    event.preventDefault();
    const box = event.currentTarget.getBoundingClientRect();
    const after = event.clientY > box.top + box.height / 2;
    if (drag.over !== id || drag.after !== after) {
      setDrag({ after, id: drag.id, over: id });
    }
  };
  const drop = (event: React.DragEvent) => {
    event.preventDefault();
    if (drag && drag.id !== drag.over) {
      const ids = channels
        .map((channel) => channel.id)
        .filter((id) => id !== drag.id);
      const at = ids.indexOf(drag.over) + (drag.after ? 1 : 0);
      ids.splice(at, 0, drag.id);
      // Sent with the first channel still at the head: the server treats the
      // order it is given as the whole order, so dropping it here would move
      // the app's own room out of first place.
      onReorder(ids);
    }
    setDrag(undefined);
  };

  return (
    <nav
      aria-label="Channels"
      className="flex w-14 shrink-0 flex-col items-center border-r border-border bg-muted/60 py-2"
    >
      {/* `overflow-y-auto` clips anything drawn outside a tile, so the
        selected mark and the working ring are both drawn inside the tile's own
        box rather than beside it. */}
      <div className="flex min-h-0 w-full flex-1 flex-col items-center gap-1 overflow-x-clip overflow-y-auto">
        {channels.map((channel, index) => (
          <ChannelTile
            // The channel the conversation started in cannot be archived, and
            // for the same reason it does not move.
            canDrag={index > 0}
            channel={{ ...channel, isHome: index === 0 }}
            drop={
              drag?.over === channel.id
                ? drag.after
                  ? "after"
                  : "before"
                : undefined
            }
            isCarried={drag?.id === channel.id}
            isSelected={channel.id === selectedId}
            key={channel.id}
            onDragEnd={() => {
              setDrag(undefined);
            }}
            onDragOver={dragOver(channel.id)}
            onDragStart={() => {
              setDrag({ after: false, id: channel.id, over: channel.id });
            }}
            onDrop={drop}
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
  canDrag,
  channel,
  drop,
  isCarried,
  isSelected,
  onDragEnd,
  onDragOver,
  onDragStart,
  onDrop,
  onMenu,
  onSelect,
}: {
  canDrag: boolean;
  channel: ChannelMark & RailChannel;
  /** Where the carried channel would land against this one. */
  drop?: "after" | "before";
  isCarried: boolean;
  isSelected: boolean;
  onDragEnd: () => void;
  onDragOver: (event: React.DragEvent) => void;
  onDragStart: () => void;
  onDrop: (event: React.DragEvent) => void;
  onMenu: (at: { x: number; y: number }) => void;
  onSelect: () => void;
}) {
  // The rail scrolls, so anything drawn beside a tile is clipped by it. The
  // name is placed against the window instead, off the button's own box.
  const [flyoutAt, setFlyoutAt] = useState<{ left: number; top: number }>();
  return (
    <div
      className={cn(
        "flex h-11 w-full shrink-0 items-center justify-center",
        drop === "before" && "shadow-[inset_0_2px_0_0_var(--primary)]",
        drop === "after" && "shadow-[inset_0_-2px_0_0_var(--primary)]",
      )}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <button
        aria-current={isSelected ? "true" : undefined}
        aria-label={channel.name}
        className={cn(
          "relative transition",
          isSelected ? "" : "opacity-55 hover:opacity-100",
          isCarried && "opacity-30",
        )}
        draggable={canDrag}
        onClick={onSelect}
        onContextMenu={(event) => {
          event.preventDefault();
          setFlyoutAt(undefined);
          onMenu({ x: event.clientX, y: event.clientY });
        }}
        onDragEnd={onDragEnd}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "move";
          onDragStart();
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
            // A ring rather than an outline or an inset shadow. An outline is
            // painted outside the border box and the rail clips what leaves a
            // tile; an inset shadow sits half over the tint and softens at the
            // corners. A ring is a box-shadow with no spread gap, so it takes
            // the tile's radius exactly and stays inside what the rail clips.
            isSelected && "ring-2 ring-foreground",
          )}
        />
        {channel.working ? (
          // Working takes the corner the count would have had, because it is
          // the same question answered sooner: something happened in there.
          // A ring around the whole tile read as a second selection.
          <span className="absolute top-0 right-0 grid size-4 place-items-center rounded-full bg-card ring-2 ring-card">
            <span className="size-2 animate-pulse rounded-full bg-primary motion-reduce:animate-none" />
          </span>
        ) : channel.needsYou ? (
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
