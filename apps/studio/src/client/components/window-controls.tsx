import { forceWindowControlsAtom } from "@/client/atoms/window-controls";
import { immediateClickHandlers } from "@/client/lib/immediate-click";
import { cn, isLinux, isMacOS, isWindows } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { CopyIcon, MinusIcon, SquareIcon, XIcon } from "@phosphor-icons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { type ReactNode } from "react";

// The custom title bar (Windows/Linux) draws its own window controls so they
// scale with the app's CSS `zoom`; the native overlay would stay a fixed pixel
// size and clip out of the zoomed toolbar. On macOS the native traffic lights
// are used instead, but the dev force-show toggle renders these too for layout
// debugging.
export function WindowControls() {
  const forceShow = useAtomValue(forceWindowControlsAtom);
  const shouldRender = isWindows() || isLinux() || (isMacOS() && forceShow);

  const { data } = useQuery(
    rpcClient.utils.live.windowMaximized.experimental_liveOptions(),
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
      {...immediateClickHandlers<HTMLButtonElement>({
        // Window chrome follows the OS, which lets a press be canceled by
        // releasing away from the control.
        activation: "release",
        onClick,
      })}
      title={label}
      type="button"
    >
      {children}
    </button>
  );
}
