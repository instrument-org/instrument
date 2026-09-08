import { channelColor } from "@/client/components/orchestrator/channel-colors";
import {
  ChannelFace,
  type ChannelMark,
} from "@/client/components/orchestrator/channel-rail";
import { channelTint } from "@/client/components/orchestrator/channel-tint";
import { cn, isMacOS } from "@/client/lib/utils";
import { TOOLBAR_HEIGHT } from "@/shared/constants";
import { SidebarSimpleIcon } from "@phosphor-icons/react/SidebarSimple";
import { type ReactNode } from "react";

/**
 * The row across the top of the window: the traffic lights' band, the one
 * control that belongs to the window, then the channel and the tabs that
 * belong to it.
 *
 * The channel sits to the left of its tabs, which is what lets the tabs live
 * up here at all: a strip above every channel would read as the window's, and
 * a strip to the right of a named channel reads as that channel's. The bar is
 * tinted with the channel's own color, so which workspace you are in is
 * legible from the corner of the eye without any panel below having to say it.
 */
export function WindowBar({
  channel,
  isSidebarOpen,
  onOpenDetails,
  onToggleSidebar,
  tabs,
  trailing,
}: {
  channel?: ChannelMark & { name: string };
  isSidebarOpen: boolean;
  onOpenDetails: () => void;
  onToggleSidebar: () => void;
  /** The channel's own tab strip, which fills what the chip leaves. */
  tabs: ReactNode;
  /** What the window keeps at its right edge, past the tabs. */
  trailing?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-1.5 border-b border-border pr-2 channel-tint [-webkit-app-region:drag] [&_[role=tab]]:[-webkit-app-region:no-drag] [&_button]:[-webkit-app-region:no-drag]",
        // The lights are drawn by the system over the window's top left; on
        // the platforms that put controls elsewhere the row starts at the edge.
        isMacOS() ? undefined : "pl-2",
      )}
      style={{
        background: "var(--channel-tint-surface, var(--background))",
        borderColor: "var(--channel-tint-edge, var(--border))",
        // The band the main process centers the traffic lights in, so the row's
        // height is the one that arithmetic is done against.
        height: `${TOOLBAR_HEIGHT}px`,
        // The gutter the buttons sit in is real pixels the system draws, so it
        // has to stay a fixed visual width: divided by the window's zoom, the
        // zoomed row scales it back to a constant 5rem at every level. That is
        // the 12px cluster inset plus the 52px cluster, leaving the sidebar
        // button the same air from the lights that the row keeps elsewhere.
        ...(isMacOS()
          ? { paddingLeft: "calc(5rem / var(--app-zoom, 1))" }
          : {}),
        ...channelTint(channel && channelColor(channel)),
      }}
    >
      <button
        aria-label={
          isSidebarOpen ? "Hide the conversation" : "Show the conversation"
        }
        aria-pressed={isSidebarOpen}
        className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-foreground/8 hover:text-foreground"
        onClick={onToggleSidebar}
        type="button"
      >
        <SidebarSimpleIcon className="size-4" />
      </button>
      {channel && (
        <>
          <button
            className="flex h-7 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-xs font-medium hover:bg-foreground/8"
            onClick={onOpenDetails}
            title={`${channel.name} — channel details`}
            type="button"
          >
            {/* No tile behind it: the bar is already wearing this channel's
              color, and a second patch of it around the mark reads as a
              sticker on top of the thing it matches. The glyph is drawn in
              that same color rather than in ink, so on a light ground it reads
              as part of the bar; dark mode already has the contrast for ink. */}
            <ChannelFace
              channel={channel}
              className={cn(
                "text-[13px]",
                channel.isHome &&
                  "text-[var(--channel-tint-base)] dark:text-current",
              )}
            />
            <span className="max-w-40 truncate">{channel.name}</span>
          </button>
          <span aria-hidden className="h-5 w-px shrink-0 bg-border" />
        </>
      )}
      {/* `min-w-0`: the strip measures its own width and never scrolls, so
        every wrapper between it and the bar has to be allowed to shrink. */}
      <div className="flex min-w-0 flex-1 items-center">{tabs}</div>
      {/* Held against the window's right edge rather than against the last
        tab, so it is chrome the window keeps and not something the strip
        appears to have opened. */}
      {trailing ? (
        <div className="flex shrink-0 items-center gap-2">{trailing}</div>
      ) : null}
    </div>
  );
}
