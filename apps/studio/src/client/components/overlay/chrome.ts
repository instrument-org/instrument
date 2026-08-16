import { rpcClient } from "@/client/rpc/client";
import { safe } from "@orpc/client";
import { useEffect } from "react";

/**
 * Shrinks the shared composer for the screens that still use it. It is sized
 * for a full page -- a three-rem text row inside sixteen pixels of padding --
 * which is too much of a panel this size. Overridden by attribute rather than
 * by editing the component, so the main window is untouched and all of it
 * leaves with the feature.
 */
export const COMPACT_COMPOSER = [
  "[&_[data-slot=composer-frame]]:min-h-0",
  "[&_[data-slot=composer-frame]]:grid-rows-[auto_minmax(1.75rem,1fr)_auto]",
  "[&_[data-slot=composer-frame]]:p-3",
  "[&_.prompt-editor]:min-h-7",
].join(" ");

/**
 * Each screen states the height it wants. Fixed rather than measured: a window
 * that resizes as you type reads as unstable, and a launcher has to be the same
 * shape every time you summon it.
 */
export function useOverlayHeight(height: number) {
  useEffect(() => {
    void safe(rpcClient.overlay.setHeight.call({ height }));
  }, [height]);
}
