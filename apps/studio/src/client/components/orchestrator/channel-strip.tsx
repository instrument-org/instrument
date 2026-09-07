import { cn } from "@/client/lib/utils";
import { PlusIcon } from "@phosphor-icons/react/Plus";
import { useState } from "react";

/** A channel as the strip draws it: what it is called and what it wants. */
export interface ChannelTab {
  id: string;
  name: string;
  /** Agent messages since the user last had it on screen. */
  unread: number;
  /** A task filed from this channel is working. */
  working?: boolean;
}

/**
 * How much of a tab is drawn, chosen by how many there are. The rule is the
 * pane strip's: an even share of the row, then compression, never a scroll.
 */
type Density = "full" | "mark" | "short";

/** How long a name may be, matching what the workspace stores. */
const CHANNEL_NAME_MAX = 16;

/** The tints a channel's mark takes, picked from its name so it never moves. */
const TINTS = [
  "bg-brand-100 text-brand-700",
  "bg-sky-100 text-sky-700",
  "bg-violet-100 text-violet-700",
  "bg-amber-100 text-amber-700",
  "bg-rose-100 text-rose-700",
  "bg-emerald-100 text-emerald-700",
];

/**
 * The channels, as the first row of the conversation.
 *
 * The tab carries its own signal: a count for what arrived while the user was
 * elsewhere, a dot for work still running. Nothing else in the sidebar says
 * either, so the row has to hold up at any number of channels, which is what
 * the densities are for.
 */
export function ChannelStrip({
  channels,
  onNew,
  onSelect,
  selectedId,
}: {
  channels: ChannelTab[];
  onNew: (name: string) => void;
  onSelect: (id: string) => void;
  selectedId?: string;
}) {
  const [naming, setNaming] = useState(false);
  const density = densityFor(channels.length);
  return (
    <div className="flex h-8 shrink-0 items-center gap-1 px-2">
      {channels.map((channel) => {
        const isSelected = channel.id === selectedId;
        const asMark = density === "mark" && !isSelected;
        return (
          <button
            aria-current={isSelected ? "true" : undefined}
            className={cn(
              "flex h-7 shrink items-center gap-1.5 rounded-md text-xs font-medium",
              asMark ? "w-7 justify-center px-0" : "min-w-0 px-1.5",
              isSelected
                ? "bg-gray-200 text-foreground"
                : "text-muted-foreground hover:bg-gray-100",
            )}
            key={channel.id}
            onClick={() => {
              onSelect(channel.id);
            }}
            title={channel.name}
            type="button"
          >
            <span className="relative shrink-0">
              <span
                className={cn(
                  "grid size-5 place-items-center rounded-md text-[10px] font-semibold uppercase",
                  tintOf(channel.name),
                  channel.working && "ring-2 ring-brand-500/60",
                )}
              >
                {channel.name.slice(0, 1)}
              </span>
              {asMark && channel.unread > 0 && (
                <span className="absolute -top-1 -right-1 grid min-w-3.5 place-items-center rounded-full bg-gray-900 px-1 text-[9px] leading-3.5 font-medium text-white">
                  {channel.unread}
                </span>
              )}
            </span>
            {!asMark && (
              <>
                <span className="min-w-0 truncate">{channel.name}</span>
                {channel.unread > 0 && (
                  <span className="shrink-0 rounded-full bg-gray-900 px-1 text-[10px] font-medium text-white">
                    {channel.unread}
                  </span>
                )}
                {channel.working && (
                  <span className="size-1.5 shrink-0 rounded-full bg-brand-500" />
                )}
              </>
            )}
          </button>
        );
      })}
      {naming ? (
        <input
          aria-label="Channel name"
          autoFocus
          className="h-6 w-24 shrink-0 rounded-md bg-white px-1.5 text-xs ring-1 ring-black/5 outline-hidden"
          maxLength={CHANNEL_NAME_MAX}
          onBlur={() => {
            setNaming(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setNaming(false);
              return;
            }
            if (event.key !== "Enter") {
              return;
            }
            const name = event.currentTarget.value.trim();
            setNaming(false);
            if (name) {
              onNew(name);
            }
          }}
          placeholder="name"
        />
      ) : (
        <button
          aria-label="New channel"
          className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-gray-100"
          onClick={() => {
            setNaming(true);
          }}
          type="button"
        >
          <PlusIcon className="size-3.5" />
        </button>
      )}
    </div>
  );
}

function densityFor(count: number): Density {
  if (count <= 3) {
    return "full";
  }
  return count <= 5 ? "short" : "mark";
}

function tintOf(name: string) {
  let sum = 0;
  for (const character of name) {
    sum += character.codePointAt(0) ?? 0;
  }
  return TINTS[sum % TINTS.length] ?? TINTS[0];
}
