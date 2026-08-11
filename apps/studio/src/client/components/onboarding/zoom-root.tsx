import { ZOOM_MAX, ZOOM_MIN, zoomAtom } from "@/client/atoms/zoom";
import { ZoomToast } from "@/client/components/zoom-controls";
import { ZoomRoot } from "@/client/components/zoom-root";
import { rpcClient } from "@/client/rpc/client";
import { steppedZoom } from "@/shared/zoom";
import { useSetAtom } from "jotai";
import { sleep } from "radashi";
import { type ReactNode, useEffect } from "react";

const RECONNECT_DELAY_MS = 500;

/**
 * Drives the onboarding window's zoom. Onboarding runs its own web contents (the
 * single-router {@link App}, not MainWindow), so it doesn't get MainWindow's
 * `useAppCommands`. This subscribes to the same main-process command stream and
 * handles only the zoom commands the onboarding menu emits (ignoring
 * tab/navigation commands), then renders the shared {@link ZoomRoot} so
 * onboarding zoom uses the identical CSS-`zoom` mechanism as the main window
 * (clamped range, portalled-popover compensation via `useAppZoomStyle`) rather
 * than Electron's native page zoom. `zoomAtom` is `localStorage`-backed at the
 * same origin, so a zoom set here is already applied when the main window mounts
 * (and syncs live via storage events while both are open).
 */
export function OnboardingZoomRoot({ children }: { children: ReactNode }) {
  const setZoom = useSetAtom(zoomAtom);

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
            switch (command.type) {
              case "zoomIn": {
                setZoom((z) =>
                  steppedZoom({
                    direction: "in",
                    factor: z,
                    max: ZOOM_MAX,
                    min: ZOOM_MIN,
                  }),
                );
                break;
              }
              case "zoomOut": {
                setZoom((z) =>
                  steppedZoom({
                    direction: "out",
                    factor: z,
                    max: ZOOM_MAX,
                    min: ZOOM_MIN,
                  }),
                );
                break;
              }
              case "zoomReset": {
                setZoom(1);
                break;
              }
              default: {
                break;
              }
            }
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
