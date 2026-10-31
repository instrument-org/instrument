"use client";

import "../styles/audio/base.css";
import type { ComponentProps, ReactNode } from "react";

import { Container } from "@/client/components/videojs/ui/container";
import { StatusAnnouncer } from "@/client/components/videojs/ui/status-announcer";
import { cn } from "@/client/lib/resolve-class-name";

import { PlaybackHotkeys } from "./behaviors/playback-hotkeys";
import { AudioErrorDialog } from "./dialogs/error-dialog";
import { DefaultAudioControls } from "./layout/controls";

export interface AudioSkinProps extends Omit<
  NonNullable<ComponentProps<typeof Container>>,
  "children"
> {
  children?: ReactNode;
  /** The file's name, shown over the timeline. */
  name: string;
}

/**
 * A sound file as a page of its own: its name and length over a wide
 * timeline, with skip, play and speed beneath it.
 */
export function AudioSkin({
  children,
  className,
  name,
  ...props
}: AudioSkinProps) {
  return (
    <Container
      className={cn("overflow-y-auto! rounded-none! after:hidden", className)}
      data-theme="default"
      data-preset="audio"
      {...props}
    >
      {children}
      <AudioErrorDialog />
      <DefaultAudioControls name={name} />
      <PlaybackHotkeys />
      <StatusAnnouncer />
    </Container>
  );
}
