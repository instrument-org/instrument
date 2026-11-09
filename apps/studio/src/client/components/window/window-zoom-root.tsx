import { appZoomAfter, zoomAtom } from "@/client/atoms/zoom";
import { ZoomToast } from "@/client/components/zoom-controls";
import { ZoomRoot } from "@/client/components/zoom-root";
import { useSyncZoom } from "@/client/hooks/use-sync-zoom";
import { rpcClient } from "@/client/rpc/client";
import { useSetAtom } from "jotai";
import { sleep } from "radashi";
import { type ReactNode, useEffect } from "react";

const RECONNECT_DELAY_MS = 500;

/** Applies the View menu's zoom commands until `signal` aborts, reconnecting when the stream drops. */
async function followZoomCommands(
  signal: AbortSignal,
  onCommand: (type: Parameters<typeof appZoomAfter>[0]) => void,
) {
  while (!signal.aborted) {
    try {
      const commands = await rpcClient.appCommands.events.command.call(
        undefined,
        { signal },
      );
      for await (const command of commands) {
        onCommand(command.type);
      }
    } catch {
      // Stream dropped (transport reset, hot reload); reconnect below unless
      // we're tearing down.
    }
    await sleep(RECONNECT_DELAY_MS);
  }
}

/**
 * Drives the app window's zoom, and the router's outside it (a debug page in
 * a browser, a test). This
 * subscribes to the main-process command stream the View menu's zoom items
 * publish on, then renders the shared {@link ZoomRoot} so zoom uses the CSS
 * `zoom` mechanism (clamped range, portalled-popover compensation via
 * `useAppZoomStyle`) rather than Electron's native page zoom, and reports the
 * level back for the window's macOS traffic lights. `zoomAtom` is kept state
 * every window shares, so the level set last is applied as the window mounts
 * and reaches the other windows as it changes.
 */
export function WindowZoomRoot({ children }: { children: ReactNode }) {
  const setZoom = useSetAtom(zoomAtom);

  useSyncZoom();

  useEffect(() => {
    const controller = new AbortController();

    void followZoomCommands(controller.signal, (type) => {
      setZoom((z) => appZoomAfter(type, z));
    });

    return () => {
      controller.abort();
    };
  }, [setZoom]);

  return (
    <>
      <ZoomRoot>{children}</ZoomRoot>
      <ZoomToast />
    </>
  );
}
