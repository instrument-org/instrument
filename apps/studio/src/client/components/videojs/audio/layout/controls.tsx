import { Controls, Time, Tooltip } from "@videojs/react";
import { AudioLinesIcon } from "lucide-react";

import { BufferingIndicator } from "@/client/components/videojs/ui/buffering-indicator";
import { ButtonTooltip } from "@/client/components/videojs/ui/button-tooltip";
import { PlayButton } from "@/client/components/videojs/ui/play-button";
import { PlaybackRateButton } from "@/client/components/videojs/ui/playback-rate-button";
import { SeekButton } from "@/client/components/videojs/ui/seek-button";
import { VolumePopover } from "@/client/components/videojs/ui/volume-popover";
import { cn } from "@/client/lib/resolve-class-name";

import { AudioTimeSlider } from "../sliders/time-slider";

/**
 * The file's name and length, a timeline as wide as the page with the time
 * played and the time left under its ends, and the controls beneath:
 * volume, back 10 seconds, play, ahead 10 seconds, and speed.
 */
export function DefaultAudioControls({ name }: { name: string }) {
  return (
    <Controls.Root visibility="always">
      <Controls.Content
        className={cn(
          "relative z-20 mx-auto flex w-full max-w-180 flex-col gap-6 px-10 py-14 text-media-foreground",
        )}
      >
        <Tooltip.Provider>
          <div className={"flex min-w-0 items-center gap-4"}>
            <span
              className={
                "grid size-16 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground"
              }
            >
              <AudioLinesIcon className={"size-7"} />
            </span>
            <div className={"min-w-0 font-sans"}>
              <div className={"truncate text-base font-semibold"}>{name}</div>
              <Time.Value
                className={
                  "mt-0.5 block text-sm text-muted-foreground tabular-nums data-unavailable:opacity-0"
                }
                type="duration"
              />
            </div>
          </div>

          <div className={"flex flex-col gap-1"}>
            <AudioTimeSlider
              className={"[--media-slider-height:--spacing(10)]"}
              previewOverflow="visible"
            />
            <div
              className={
                "flex justify-between font-sans text-xs text-muted-foreground tabular-nums"
              }
            >
              <Time.Value type="current" />
              <Time.Value type="remaining" />
            </div>
          </div>

          <Controls.Group className={"flex items-center justify-center gap-6"}>
            <VolumePopover boundary="viewport" />
            <ButtonTooltip boundary="viewport" side="top">
              <SeekButton seconds={-10} />
            </ButtonTooltip>
            <div className={"relative inline-flex"}>
              <BufferingIndicator
                className={cn(
                  "z-20 rounded-media-control text-inherit! before:hidden",
                  "data-visible:bg-media-controls",
                )}
              />
              <ButtonTooltip boundary="viewport" side="top">
                <PlayButton
                  className={cn(
                    "size-14 bg-media-primary text-media-primary-foreground [--media-icon-size:--spacing(6)]",
                    "not-aria-disabled:hover:bg-media-primary not-aria-disabled:hover:text-media-primary-foreground not-aria-disabled:hover:opacity-90",
                  )}
                />
              </ButtonTooltip>
            </div>
            <ButtonTooltip boundary="viewport" side="top">
              <SeekButton seconds={10} />
            </ButtonTooltip>
            <PlaybackRateButton
              className={
                "w-12 rounded-md font-sans text-sm font-medium ring-1 ring-border"
              }
            />
          </Controls.Group>
        </Tooltip.Provider>
      </Controls.Content>
    </Controls.Root>
  );
}
