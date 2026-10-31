"use client";

import "../styles/video/base.css";
import type { ComponentProps, ReactNode } from "react";

import { BufferingIndicator } from "@/client/components/videojs/ui/buffering-indicator";
import { Container } from "@/client/components/videojs/ui/container";
import { ErrorDialog } from "@/client/components/videojs/ui/error-dialog";
import { cn } from "@/client/lib/resolve-class-name";

import { VideoGestures } from "./behaviors/gestures";
import { VideoHotkeys } from "./behaviors/hotkeys";
import { VideoStatusIndicators } from "./display/status-indicators";
import { DefaultVideoControls } from "./layout/controls";

export interface VideoSkinProps extends Omit<
  NonNullable<ComponentProps<typeof Container>>,
  "children"
> {
  children?: ReactNode;
  renderThumbnail?: NonNullable<
    ComponentProps<typeof DefaultVideoControls>
  >["renderThumbnail"];
}

/**
 * A video edge to edge in the viewer, square-cornered since the viewer's card
 * already rounds it, with its controls over the bottom while the pointer is
 * on it or it is paused.
 */
export function VideoSkin({
  children,
  className,
  renderThumbnail,
  ...props
}: VideoSkinProps = {}) {
  return (
    <Container
      className={cn(
        "pointer-fine:not-data-controls-visible:cursor-none",
        "[--media-border-color:transparent] [--media-border-radius:0]",
        className,
      )}
      data-theme="default"
      data-preset="video"
      {...props}
    >
      {children}
      <BufferingIndicator />
      <ErrorDialog />

      <DefaultVideoControls renderThumbnail={renderThumbnail} />

      <VideoHotkeys />
      <VideoGestures />
      <VideoStatusIndicators />
    </Container>
  );
}
