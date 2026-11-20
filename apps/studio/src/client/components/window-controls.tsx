import { forceWindowControlsAtom } from "@/client/atoms/window-controls";
import { cn, isLinux, isMacOS, isWindows } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { CopyIcon } from "@phosphor-icons/react/Copy";
import { MinusIcon } from "@phosphor-icons/react/Minus";
import { SquareIcon } from "@phosphor-icons/react/Square";
import { XIcon } from "@phosphor-icons/react/X";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { type ReactNode } from "react";

/**
 * Whether the window draws its own caption buttons: off the Mac, and on it
 * too while the dev force-show toggle is on.
 */
export function useDrawsWindowControls() {
  const forceShow = useAtomValue(forceWindowControlsAtom);
  return isWindows() || isLinux() || (isMacOS() && forceShow);
}

/**
 * Room at the end of whatever row reaches the card's top right, for the
 * caption buttons the window draws over that corner off the Mac
 * (`--caption-room`, set by the window's frame).
 */
export function CaptionRoom() {
  return <div aria-hidden className="w-(--caption-room) shrink-0" />;
}

// The custom title bar (Windows/Linux) draws its own window controls so they
// scale with the app's CSS `zoom`; the native overlay would stay a fixed pixel
// size and clip out of the zoomed toolbar. On macOS the native traffic lights
// are used instead, but the dev force-show toggle renders these too for layout
// debugging.
export function WindowControls() {
  const shouldRender = useDrawsWindowControls();

  const { data } = useQuery(
    rpcClient.utils.live.windowState.experimental_liveOptions(),
  );
  const { mutate: minimize } = useMutation(
    rpcClient.utils.minimizeWindow.mutationOptions(),
  );
  const { mutate: toggleMaximize } = useMutation(
    rpcClient.utils.toggleMaximizeWindow.mutationOptions(),
  );
  const { mutate: closeWindow } = useMutation(
    rpcClient.utils.closeWindow.mutationOptions(),
  );

  if (!shouldRender) {
    return null;
  }

  const isMaximized = data?.maximized ?? false;
  // Setup holds the window at its own shape, so there is nothing to maximize.
  const isMaximizable = data?.maximizable ?? true;

  return (
    <div className="flex h-full shrink-0 items-stretch [-webkit-app-region:no-drag]">
      <WindowControlButton
        label="Minimize"
        onClick={() => {
          minimize(undefined);
        }}
      >
        <MinusIcon className="size-3.5" />
      </WindowControlButton>
      {isMaximizable && (
        <WindowControlButton
          label={isMaximized ? "Restore" : "Maximize"}
          onClick={() => {
            toggleMaximize(undefined);
          }}
        >
          {isMaximized ? (
            <CopyIcon className="size-3" />
          ) : (
            <SquareIcon className="size-3" />
          )}
        </WindowControlButton>
      )}
      <WindowControlButton
        label="Close"
        onClick={() => {
          closeWindow(undefined);
        }}
        variant="close"
      >
        <XIcon className="size-3.5" />
      </WindowControlButton>
    </div>
  );
}

function WindowControlButton({
  children,
  label,
  onClick,
  variant = "default",
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
  variant?: "close" | "default";
}) {
  return (
    <button
      aria-label={label}
      className={cn(
        "flex h-full w-12 items-center justify-center text-foreground/70",
        variant === "close"
          ? "hover:bg-destructive hover:text-white"
          : "hover:bg-foreground/10 hover:text-foreground",
      )}
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  );
}
