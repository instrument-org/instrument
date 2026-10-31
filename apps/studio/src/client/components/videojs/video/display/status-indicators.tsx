import type { ComponentProps } from "react";

import { SeekIndicator } from "@/client/components/videojs/ui/seek-indicator";
import { StatusAnnouncer } from "@/client/components/videojs/ui/status-announcer";
import {
  PlaybackStatusIndicator,
  StatusIndicator,
} from "@/client/components/videojs/ui/status-indicator";
import { VolumeIndicator } from "@/client/components/videojs/ui/volume-indicator";
import { cn } from "@/client/lib/resolve-class-name";

export type VideoStatusIndicatorsProps = Omit<
  ComponentProps<"div">,
  "children"
>;

export function VideoStatusIndicators({
  className,
  ...props
}: VideoStatusIndicatorsProps = {}) {
  return (
    <>
      <StatusAnnouncer />
      <div
        className={cn(
          "pointer-events-none absolute inset-0 z-20 grid grid-cols-3 items-center justify-items-center",
          "text-media-controls-foreground",
          className,
        )}
        {...props}
      >
        <VolumeIndicator />
        <StatusIndicator />
        <SeekIndicator />
        <PlaybackStatusIndicator />
      </div>
    </>
  );
}
