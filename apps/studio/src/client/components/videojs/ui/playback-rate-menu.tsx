"use client";

import "../styles/base.css";
import "../styles/audio/theme.css";
import "../styles/video/captions.css";
import "../styles/video/theme.css";
import { Menu, PlaybackRateRadioGroup } from "@videojs/react";
import { CheckIcon } from "lucide-react";

import { Button } from "@/client/components/videojs/ui/button";
import { cn } from "@/client/lib/resolve-class-name";

/**
 * The speed, shown on a button that opens the list of speeds to pick from.
 * The menu is drawn inside the player, so it opens in full screen too.
 */
export function PlaybackRateMenu({ className }: { className?: string }) {
  return (
    <Menu.Root align="center" boundary="viewport" side="top">
      <PlaybackRateRadioGroup.Root>
        <Menu.Trigger
          aria-label="Speed"
          render={
            <Button className={cn("tabular-nums", className)}>
              <PlaybackRateRadioGroup.Value />
            </Button>
          }
        />
        <Menu.Popup
          className={cn(
            "z-20 m-0 overflow-hidden border-0 p-0",
            "media-transitioning:scale-media-hidden-popup media-transitioning:opacity-0 media-transitioning:blur-media-hidden-popup",
            "data-[side=bottom]:origin-top data-[side=top]:origin-bottom",
            "transition-media-popup data-ending-style:duration-media-instant",
            "bg-media-popover text-media-popover-foreground surface-media after:surface-media-inset",
            "rounded-xl [--media-popup-side-offset:var(--media-popover-side-offset)]",
          )}
        >
          <Menu.Content className="flex flex-col p-1 outline-hidden">
            <PlaybackRateRadioGroup.Options
              className="flex flex-col"
              renderItem={(props) => (
                <Menu.RadioItem
                  {...props}
                  className={cn(
                    "group/rate flex min-h-8 cursor-pointer items-center justify-between gap-4 rounded-md px-2.5 font-sans text-sm tabular-nums",
                    "outline-hidden data-highlighted:highlight-media",
                  )}
                >
                  {props.children}
                  <CheckIcon className="size-4 opacity-0 group-aria-checked/rate:opacity-100" />
                </Menu.RadioItem>
              )}
            />
          </Menu.Content>
        </Menu.Popup>
      </PlaybackRateRadioGroup.Root>
    </Menu.Root>
  );
}
