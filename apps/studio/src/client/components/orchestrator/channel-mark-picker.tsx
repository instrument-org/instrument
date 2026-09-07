import { CHANNEL_COLORS } from "@/client/components/orchestrator/channel-colors";
import { channelTint } from "@/client/components/orchestrator/channel-tint";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/client/components/ui/popover";
import { cn } from "@/client/lib/utils";
import { type ReactNode } from "react";

import { EmojiGrid } from "./emoji-grid";

/**
 * The mark a channel is known by, and the popover that changes it: every emoji
 * with a search field, and the tints under it, so the two decisions that make
 * a channel findable are made in one place.
 */
export function ChannelMarkPicker({
  children,
  onEmoji,
  onOpenChange,
  open,
}: {
  /** The trigger: the mark as it stands. */
  children: ReactNode;
  onEmoji: (emoji: string) => void;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
}) {
  return (
    <Popover onOpenChange={onOpenChange} open={open}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-72 p-0"
        side="bottom"
        sideOffset={6}
      >
        <EmojiGrid
          onPick={(picked) => {
            onEmoji(picked);
            onOpenChange?.(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * The tints, one of them chosen: a pale one and a deep one of every hue, in
 * that order, so the two rows read as two families rather than as sixteen
 * neighbors. Each swatch is drawn in the rebuilt color rather than the raw hex,
 * since only the hue of a palette entry survives the tint and two entries that
 * look different here would otherwise come out the same on the bar.
 */
export function ColorRow({
  onPick,
  value,
}: {
  onPick: (color: string) => void;
  value?: string;
}) {
  return (
    // Eight to a row, each swatch taking an equal share of the width, so the
    // pale row sits square over the deep one and the two read as two families.
    <div className="grid grid-cols-8 justify-items-center gap-2">
      {CHANNEL_COLORS.map((color) => (
        <button
          aria-label={`Color ${color}`}
          className={cn(
            "size-7 rounded-full transition channel-tint",
            color === value
              ? // Outside the swatch, so choosing one does not shrink it: an
                // inset ring eats into the color it is meant to be marking.
                "ring-2 ring-foreground ring-offset-2 ring-offset-popover"
              : "ring-1 ring-black/10 ring-inset hover:scale-110",
          )}
          key={color}
          onClick={() => {
            onPick(color);
          }}
          style={{
            background: "var(--channel-tint-base)",
            ...channelTint(color),
          }}
          type="button"
        />
      ))}
    </div>
  );
}
