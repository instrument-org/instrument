"use client";

import "../styles/base.css";
import "../styles/audio/theme.css";
import "../styles/video/captions.css";
import "../styles/video/theme.css";
import { PlaybackRateButton as PlaybackRateButtonPrimitive } from "@videojs/react";

import { Button } from "@/client/components/videojs/ui/button";
import { cn, resolveClassName } from "@/client/lib/resolve-class-name";

export type PlaybackRateButtonProps = Omit<
  PlaybackRateButtonPrimitive.Props,
  "children"
>;

export function PlaybackRateButton({
  className,
  ...props
}: PlaybackRateButtonProps = {}) {
  return (
    <PlaybackRateButtonPrimitive
      render={<Button />}
      className={(state) =>
        cn(
          "tabular-nums after:w-[4ch] after:content-[attr(data-rate)_'×']",
          resolveClassName(className, state),
        )
      }
      {...props}
    />
  );
}
