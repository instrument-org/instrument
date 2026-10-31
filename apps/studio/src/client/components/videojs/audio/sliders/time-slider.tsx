import type { SliderPreviewOverflow } from "@videojs/core";
import { TimeSlider } from "@videojs/react";

import {
  SliderBuffer,
  SliderFill,
  SliderThumb,
  SliderTrack,
} from "@/client/components/videojs/ui/slider";
import { cn, resolveClassName } from "@/client/lib/resolve-class-name";

export interface AudioTimeSliderProps extends Omit<
  TimeSlider.RootProps,
  "children"
> {
  previewOverflow?: SliderPreviewOverflow | undefined;
}

export function AudioTimeSlider({
  className,
  previewOverflow = "clamp",
  ...props
}: AudioTimeSliderProps = {}) {
  return (
    <TimeSlider.Root
      className={(state) =>
        cn(
          "group/slider relative flex flex-1 cursor-pointer items-center justify-center outline-hidden",
          "data-disabled:pointer-events-none",
          "transition-[--media-slider-fill,--media-slider-buffer] duration-media-slider ease-out data-dragging:duration-0",
          "rounded-media-pill",
          "data-[orientation=horizontal]:h-(--media-slider-height,--spacing(8))",
          "data-[orientation=vertical]:w-8 data-[orientation=vertical]:min-w-0",
          "data-[orientation=horizontal]:min-w-18 data-[orientation=vertical]:h-18",
          resolveClassName(className, state),
        )
      }
      {...props}
    >
      <TimeSlider.Track render={<SliderTrack />}>
        <TimeSlider.Buffer render={<SliderBuffer />} />
        <TimeSlider.Fill render={<SliderFill />} />
      </TimeSlider.Track>
      <TimeSlider.Thumb
        render={<SliderThumb />}
        className={
          "opacity-0 data-interactive:opacity-100 pointer-fine:group-hover/slider:scale-100 pointer-fine:group-hover/slider:opacity-100"
        }
      />
      <TimeSlider.Preview
        className={cn(
          "group/preview relative h-1 [--media-slider-preview-max-height:var(--media-slider-preview-max-width)]",
          "media-2xl:[--media-slider-preview-max-width:min(--spacing(48),100cqi)]",
          "before:pointer-events-none before:absolute before:z-1 before:-translate-1/2 before:scale-50 before:opacity-0",
          "before:transition-[opacity,scale] before:duration-media-slow before:ease-out",
          "data-pointing:not-data-dragging:before:scale-100 data-pointing:not-data-dragging:before:opacity-100",
          "min-w-(--media-slider-preview-max-width)",
          "[--media-slider-preview-max-width:min(--spacing(32),100cqi)]",
          "@min-[30rem]/media-root:[--media-slider-preview-max-width:min(--spacing(40),100cqi)]",
          "before:top-1/2 before:left-1/2 before:size-1 before:rounded-media-control before:bg-current",
        )}
        overflow={previewOverflow}
      >
        <div
          className={cn(
            "absolute max-w-(--media-slider-preview-max-width) -translate-x-1/2 translate-y-media-hidden-preview-offset scale-media-hidden-preview opacity-0",
            "origin-bottom blur-media-hidden",
            "transition-[filter,opacity,scale] duration-media-base ease-out",
            "group-data-pointing/preview:scale-100 group-data-pointing/preview:opacity-100 group-data-pointing/preview:filter-none",
            "group-has-focus-visible/slider:scale-100 group-has-focus-visible/slider:opacity-100 group-has-focus-visible/slider:filter-none",
            "bg-media-popover text-media-popover-foreground surface-media after:surface-media-inset",
            "rounded-media-control py-1 text-media whitespace-nowrap [--media-popup-side-offset:var(--media-tooltip-side-offset)]",
            "data-open:flex data-open:items-center data-open:gap-1",
            "px-2.5",
            "bottom-[calc(100%+var(--media-slider-preview-label-offset))] tabular-nums",
            "left-1/2",
          )}
        >
          <TimeSlider.Value className={"tabular-nums"} type="pointer" />
        </div>
      </TimeSlider.Preview>
    </TimeSlider.Root>
  );
}
