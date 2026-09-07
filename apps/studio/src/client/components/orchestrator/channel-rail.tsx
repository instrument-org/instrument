import { InstrumentGlyph } from "@/client/components/wordmark";
import { cn } from "@/client/lib/utils";
import { PlusIcon } from "@phosphor-icons/react/Plus";
import { useEffect, useState } from "react";

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
 * What stands for a channel wherever one is named: its emoji, or the mark for
 * the channel the conversation started in, which has no emoji and does not
 * take one.
 */
export function ChannelFace({
  channel,
  className,
}: {
  channel: { emoji?: string; id: string };
  className?: string;
}) {
  return channel.emoji ? (
    <span className={cn("leading-none", className)}>{channel.emoji}</span>
  ) : (
    <InstrumentGlyph className={cn("size-4 text-primary", className)} />
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
  onNew,
  onSelect,
  selectedId,
}: {
  channels: RailChannel[];
  onNew: () => void;
  onSelect: (id: string) => void;
  selectedId?: string;
}) {
  return (
    <nav
      aria-label="Channels"
      className="flex w-14 shrink-0 flex-col items-center border-r border-border bg-muted/60 pt-10 pb-2 [-webkit-app-region:drag] [&_button]:[-webkit-app-region:no-drag]"
    >
      <div className="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto">
        {channels.map((channel) => (
          <ChannelTile
            channel={channel}
            isSelected={channel.id === selectedId}
            key={channel.id}
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

/** One channel's mark, with what it is saying and the name it says on hover. */
function ChannelTile({
  channel,
  isSelected,
  onSelect,
}: {
  channel: RailChannel;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const [isHovered, setHovered] = useState(false);
  // A tile that leaves under the pointer (the rail reordered, the channel
  // archived) would otherwise keep its flyout up with nothing under it.
  useEffect(() => () => {
    setHovered(false);
  }, []);
  return (
    <div className="relative flex h-11 w-full shrink-0 items-center justify-center">
      {isSelected && (
        <span className="absolute top-1/2 left-0 h-7 w-0.5 -translate-y-1/2 rounded-r-full bg-foreground" />
      )}
      <button
        aria-current={isSelected ? "true" : undefined}
        aria-label={channel.name}
        className={cn(
          "relative grid size-9 place-items-center rounded-xl bg-card text-[17px] ring-1 ring-border transition",
          isSelected ? "shadow-sm" : "opacity-60 hover:opacity-100",
          channel.working && "ring-2 ring-primary ring-offset-2 ring-offset-muted",
        )}
        onClick={onSelect}
        onPointerEnter={() => {
          setHovered(true);
        }}
        onPointerLeave={() => {
          setHovered(false);
        }}
        type="button"
      >
        <ChannelFace channel={channel} />
        {channel.needsYou ? (
          // A question rather than a warning: it is asking the user something,
          // and it takes the corner from the count because a channel that has
          // stopped is the more urgent of the two.
          <span className="absolute -top-1 -right-1 grid size-4 place-items-center rounded-full bg-warning-500 text-[10px] font-bold text-white ring-2 ring-muted">
            ?
          </span>
        ) : channel.unread > 0 ? (
          <span className="absolute -top-1 -right-1 grid h-4 min-w-4 place-items-center rounded-full bg-foreground px-1 text-[10px] font-medium text-background ring-2 ring-muted">
            {channel.unread > 99 ? "99+" : channel.unread}
          </span>
        ) : null}
      </button>
      {isHovered && (
        <span className="pointer-events-none absolute top-1/2 left-12 z-50 -translate-y-1/2 rounded-md bg-popover px-2 py-1 text-xs whitespace-nowrap text-popover-foreground shadow-md ring-1 ring-border">
          {channel.name}
        </span>
      )}
    </div>
  );
}
