import { Controls, Time, Tooltip } from "@videojs/react";
import type { ComponentProps } from "react";

import { ButtonTooltip } from "@/client/components/videojs/ui/button-tooltip";
import { CaptionsButton } from "@/client/components/videojs/ui/captions-button";
import { FullscreenButton } from "@/client/components/videojs/ui/fullscreen-button";
import { PiPButton } from "@/client/components/videojs/ui/pip-button";
import { PlayButton } from "@/client/components/videojs/ui/play-button";
import { PlaybackRateButton } from "@/client/components/videojs/ui/playback-rate-button";
import { SeekButton } from "@/client/components/videojs/ui/seek-button";
import { TimeSlider } from "@/client/components/videojs/ui/time-slider";
import { VolumePopover } from "@/client/components/videojs/ui/volume-popover";
import { cn } from "@/client/lib/resolve-class-name";

export interface DefaultVideoControlsProps {
  renderThumbnail?: NonNullable<
    ComponentProps<typeof TimeSlider>
  >["renderThumbnail"];
}

/**
 * The timeline across the bottom of the video, and one row of controls under
 * it on the scrim: play, back and ahead 10 seconds, volume and the time on
 * the left; speed, captions, picture in picture and full screen on the right.
 * The captions button shows only when the video has captions.
 */
export function DefaultVideoControls({
  renderThumbnail,
}: DefaultVideoControlsProps = {}) {
  return (
    <Controls.Root>
      <Controls.Backdrop
        className={cn(
          "pointer-events-none absolute inset-0 z-10 rounded-[inherit]",
          "bg-[image:var(--media-controls-gradient)] bg-size-[100%_var(--media-controls-gradient-height)] bg-bottom bg-no-repeat",
          "transition-opacity duration-media-controls ease-out not-data-visible:opacity-0",
        )}
      />
      <Controls.Content
        className={cn(
          "group/controls text-media-controls-foreground text-shadow-media",
          "absolute inset-x-3 bottom-2 z-30 flex flex-col gap-0.5",
          "transition-[filter,opacity,translate] duration-media-controls-enter ease-out",
          "not-data-visible:pointer-events-none not-data-visible:opacity-0",
          "not-data-visible:translate-y-media-hidden-offset not-data-visible:duration-media-controls",
        )}
      >
        <Tooltip.Provider>
          <Controls.Group className={"flex items-center px-1"}>
            <TimeSlider renderThumbnail={renderThumbnail} />
          </Controls.Group>

          <Controls.Group
            className={"flex items-center gap-px rtl:flex-row-reverse"}
          >
            <ButtonTooltip side="top">
              <PlayButton />
            </ButtonTooltip>
            <ButtonTooltip side="top">
              <SeekButton seconds={-10} />
            </ButtonTooltip>
            <ButtonTooltip side="top">
              <SeekButton seconds={10} />
            </ButtonTooltip>
            <VolumePopover />
            <div
              className={
                "@container/media-time flex min-w-0 flex-1 items-center gap-1 px-2 tabular-nums"
              }
            >
              <Time.Value
                className={
                  "transition-opacity duration-media-slow ease-out data-unavailable:opacity-50"
                }
                type="current"
              />
              <span className={"opacity-70 @max-[6rem]/media-time:hidden"}>
                /
              </span>
              <Time.Value
                className={
                  "opacity-70 data-unavailable:opacity-0 @max-[6rem]/media-time:hidden"
                }
                type="duration"
              />
            </div>
            <PlaybackRateButton className={"w-auto px-2 font-medium"} />
            <ButtonTooltip side="top">
              <CaptionsButton />
            </ButtonTooltip>
            <ButtonTooltip side="top">
              <PiPButton className={"media-max-sm:hidden"} />
            </ButtonTooltip>
            <ButtonTooltip side="top">
              <FullscreenButton />
            </ButtonTooltip>
          </Controls.Group>
        </Tooltip.Provider>
      </Controls.Content>
    </Controls.Root>
  );
}
