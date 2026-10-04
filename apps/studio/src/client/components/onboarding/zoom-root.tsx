import { appZoomAfter, zoomAtom } from "@/client/atoms/zoom";
import { ZoomToast } from "@/client/components/zoom-controls";
import { ZoomRoot } from "@/client/components/zoom-root";
import { useSyncZoom } from "@/client/hooks/use-sync-zoom";
import { rpcClient } from "@/client/rpc/client";
import { useSetAtom } from "jotai";
import { sleep } from "radashi";
import { type ReactNode, useEffect } from "react";

const RECONNECT_DELAY_MS = 500;

/**
 * Drives a window's zoom: the onboarding window's and the app window's. This
 * subscribes to the main-process command stream the View menu's zoom items
 * publish on, then renders the shared {@link ZoomRoot} so zoom uses the CSS
 * `zoom` mechanism (clamped range, portalled-popover compensation via
 * `useAppZoomStyle`) rather than Electron's native page zoom, and reports the
 * level back for the window's macOS traffic lights. `zoomAtom` is
 * `localStorage`-backed at the same origin, so a zoom set in one window is
 * already applied when the other mounts (and syncs live via storage events
 * while both are open).
 */
export function OnboardingZoomRoot({ children }: { children: ReactNode }) {
  const setZoom = useSetAtom(zoomAtom);

  useSyncZoom();

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;

    async function run() {
      while (!signal.aborted) {
        try {
          const commands = await rpcClient.appCommands.events.command.call(
            undefined,
            { signal },
          );
          for await (const command of commands) {
            setZoom((z) => appZoomAfter(command.type, z));
          }
        } catch {
          // Stream dropped (transport reset, hot reload); reconnect below unless
          // we're tearing down.
        }
        await sleep(RECONNECT_DELAY_MS);
      }
    }

    void run();

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
