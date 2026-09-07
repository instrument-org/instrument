import { CHANNEL_COLORS } from "@/client/components/orchestrator/channel-colors";
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
  color,
  onColor,
  onEmoji,
  onOpenChange,
  open,
}: {
  /** The trigger: the mark as it stands. */
  children: ReactNode;
  color?: string;
  onColor: (color: string) => void;
  onEmoji: (emoji: string) => void;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
}) {
  return (
    <Popover onOpenChange={onOpenChange} open={open}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <EmojiGrid
          onPick={(picked) => {
            onEmoji(picked);
            onOpenChange?.(false);
          }}
        />
        <div className="border-t border-border p-3">
          <p className="pb-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            Color
          </p>
          <ColorRow
            onPick={onColor}
            {...(color === undefined ? {} : { value: color })}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** A row of tints, one of them chosen. */
export function ColorRow({
  onPick,
  value,
}: {
  onPick: (color: string) => void;
  value?: string;
}) {
  return (
    <div className="flex gap-2">
      {CHANNEL_COLORS.map((color) => (
        <button
          aria-label={`Color ${color}`}
          className={cn(
            "size-6 rounded-full transition",
            color === value
              ? "ring-2 ring-foreground ring-offset-2 ring-offset-background"
              : "hover:scale-110",
          )}
          key={color}
          onClick={() => {
            onPick(color);
          }}
          style={{ background: color }}
          type="button"
        />
      ))}
    </div>
  );
}
