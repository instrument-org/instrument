import { zoomAtom } from "@/client/atoms/zoom";
import { rpcClient } from "@/client/rpc/client";
import { safe } from "@orpc/client";
import { useAtomValue } from "jotai";
import { useEffect } from "react";

/**
 * Reports this window's UI zoom to the main process, which keeps the macOS
 * traffic lights centered in the band of chrome the window draws behind them:
 * that band's visual height is the zoom the renderer is drawn at, and the
 * buttons are real pixels the system draws over the web contents.
 *
 * Every root that renders zoomed chrome calls this, since any of them can be the
 * window the user zooms and the level is one setting shared across them.
 */
export function useSyncZoom() {
  const zoom = useAtomValue(zoomAtom);

  useEffect(() => {
    void safe(rpcClient.utils.syncZoom.call({ zoom }));
  }, [zoom]);
}
