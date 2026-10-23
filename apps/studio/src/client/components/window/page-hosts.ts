import { atom, useSetAtom } from "jotai";
import { useEffect } from "react";

import { type PageChromeSlots } from "./browser-tabs";

/**
 * A second place a group's page is drawn, besides the tab up in the window:
 * a draft window's band, which shows the draft's group's tabs itself; a
 * floating chat grown to show its tab, or peeking at one; a file tab drawing
 * a page's file beside its tree; or Quick Look. The panel for that group's
 * page is portaled into `into`, and shown while `isActive`.
 */
export interface PageHost {
  /**
   * Whether the page's own bar is drawn over it, or, for a surface that draws
   * the window's address row over the page, the elements in that row the
   * page's reload and controls go into; a surface with a head of its own and
   * no row says no.
   */
  chrome: boolean | PageChromeSlots;
  /** Drawn inside an overlay, whose own cover does not count against the page; see BrowserPanel. */
  insideOverlay?: boolean;
  into: HTMLElement;
  isActive: boolean;
  /** The window layer the guest is shown on, for a host inside a floating surface; the panel's own otherwise. */
  layer?: number;
  /**
   * Where the host stands, so a page is placed again when the host moves
   * without resizing. Left out for a host inside the window's row, which is
   * placed again as the row's width changes.
   */
  place?: string;
  /** The tab drawn, for a host showing one of its group's tabs that is not the one the group has up: a floating chat's peek. */
  tabId?: string;
}

/** Every place a page is drawn besides the tab up, by the group whose page it draws. In memory only, with the elements. */
export const pageHostsAtom = atom<Readonly<Record<string, PageHost>>>({});

/**
 * Says where this surface wants its group's page drawn, for as long as it
 * is mounted and has an element to draw into. Only its own entry is cleared
 * as it changes or leaves, so a surface arriving for the same group as this
 * one leaves is not cleared with it.
 */
export function usePageHost(
  group: string,
  host:
    | (Omit<PageHost, "into"> & { into: HTMLElement | null | undefined })
    | undefined,
) {
  const setHosts = useSetAtom(pageHostsAtom);
  const into = host?.into ?? null;
  const chrome = host?.chrome ?? false;
  const insideOverlay = host?.insideOverlay;
  const isActive = host?.isActive ?? false;
  const layer = host?.layer;
  const place = host?.place;
  const tabId = host?.tabId;
  useEffect(() => {
    if (!into) {
      return;
    }
    const shown: PageHost = {
      chrome,
      into,
      isActive,
      ...(insideOverlay === undefined ? {} : { insideOverlay }),
      ...(layer === undefined ? {} : { layer }),
      ...(place === undefined ? {} : { place }),
      ...(tabId === undefined ? {} : { tabId }),
    };
    setHosts((current) => ({ ...current, [group]: shown }));
    return () => {
      setHosts((current) => {
        if (current[group] !== shown) {
          return current;
        }
        const { [group]: _gone, ...rest } = current;
        return rest;
      });
    };
  }, [
    chrome,
    group,
    insideOverlay,
    into,
    isActive,
    layer,
    place,
    setHosts,
    tabId,
  ]);
}
