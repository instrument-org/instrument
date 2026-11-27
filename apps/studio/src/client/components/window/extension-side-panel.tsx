import { toast } from "@/client/lib/toast";
import { rpcClient } from "@/client/rpc/client";
import {
  type ExtensionSidePanel,
  sidePanelPartition,
} from "@/shared/browser-extensions";
import {
  type BrowserTargetId,
  browserTargetOf,
} from "@instrument-org/workspace/client";
import { useQuery } from "@tanstack/react-query";
import { atom, useAtomValue, useSetAtom } from "jotai";
import { useEffect, useRef } from "react";

import { useWindowTabs } from "./window-tabs";

/**
 * Each tab's extension side panel in this window, by the tab's target: a
 * `<webview>` kept in `document.body` for as long as the panel is open, so
 * its page lives on while another tab's panel shows, and laid over the
 * side panel's column while its own shows.
 */
const mounted = new Map<
  BrowserTargetId,
  { url: string; webview: HTMLElement }
>();

/** The tab whose extension side panel the window shows now. */
const shownPanelAtom = atom<BrowserTargetId | null>(null);

/** How many still frames a shown panel waits before it stops following its column. */
const STILL_FRAMES = 30;

/** The extension side panels open in tabs, kept current. */
function useExtensionSidePanels(): ExtensionSidePanel[] {
  const { data } = useQuery(
    rpcClient.browserExtensions.live.sidePanels.experimental_liveOptions(),
  );
  return data ?? [];
}

/** The extension side panel open in a tab, when one is. */
export function useExtensionSidePanelOf(
  targetId: BrowserTargetId | undefined,
): ExtensionSidePanel | undefined {
  const panels = useExtensionSidePanels();
  return targetId === undefined
    ? undefined
    : panels.find((panel) => panel.targetId === targetId);
}

/** Whether the window shows the extension side panel of the tab on `targetId`. */
export function useIsExtensionSidePanelShown(
  targetId: BrowserTargetId | undefined,
): boolean {
  const shown = useAtomValue(shownPanelAtom);
  return targetId !== undefined && shown === targetId;
}

/** Closes the extension side panel open in a tab. */
export function closeExtensionSidePanel(targetId: BrowserTargetId): void {
  void rpcClient.browserExtensions.closeSidePanel
    .call({ targetId })
    .catch((error: unknown) => {
      toast.error("Couldn't close the side panel", { cause: error });
    });
}

function hide(webview: HTMLElement) {
  Object.assign(webview.style, {
    pointerEvents: "none",
    visibility: "hidden",
  } satisfies Partial<CSSStyleDeclaration>);
}

/** The panel's `<webview>`, mounted now when it has none, or sent to the page it shows now. */
function mount(panel: ExtensionSidePanel): HTMLElement {
  const kept = mounted.get(panel.targetId);
  if (kept) {
    if (kept.url !== panel.url) {
      kept.url = panel.url;
      kept.webview.setAttribute("src", panel.url);
    }
    return kept.webview;
  }
  // oxlint-disable-next-line studio/no-raw-webview -- an extension's page, not a tab's guest: nothing drives it, and the pool never sees it
  const webview = document.createElement("webview");
  // The partition names the tab, and main gives the panel the tab's session
  // in `will-attach-webview` once it finds this page open there.
  webview.setAttribute("partition", sidePanelPartition(panel.targetId));
  webview.setAttribute("src", panel.url);
  Object.assign(webview.style, {
    border: "0",
    height: "480px",
    left: "0",
    overflow: "hidden",
    position: "fixed",
    top: "0",
    width: "320px",
    zIndex: "0",
  } satisfies Partial<CSSStyleDeclaration>);
  webview.style.setProperty("-webkit-app-region", "no-drag");
  hide(webview);
  document.body.append(webview);
  mounted.set(panel.targetId, { url: panel.url, webview });
  return webview;
}

/**
 * Keeps a page for each extension side panel open in this window's tabs,
 * and lets go of the rest: closed, or their tab gone from the window.
 */
export function useExtensionSidePanelPages() {
  const panels = useExtensionSidePanels();
  const windowTabs = useWindowTabs();
  const here = new Set(
    windowTabs.allTabs
      .filter((tab) => tab.kind === "page")
      .map((tab) => browserTargetOf(tab.id)),
  );
  const wanted = panels.filter((panel) => here.has(panel.targetId));
  useEffect(() => {
    const kept = new Set(wanted.map((panel) => panel.targetId));
    for (const [targetId, { webview }] of mounted) {
      if (!kept.has(targetId)) {
        webview.remove();
        mounted.delete(targetId);
      }
    }
    for (const panel of wanted) {
      mount(panel);
    }
  });
}

/**
 * A tab's extension side panel in the side panel's column, in place of the
 * column's own contents: the panel's page laid over this element, following
 * it as the column slides, resizes or the window does.
 */
export function ExtensionSidePanelView({
  panel,
}: {
  panel: ExtensionSidePanel;
}) {
  const slotRef = useRef<HTMLDivElement>(null);
  const setShown = useSetAtom(shownPanelAtom);
  const { extensionId, name, targetId, url } = panel;
  useEffect(() => {
    const slot = slotRef.current;
    if (!slot) {
      return;
    }
    const webview = mount({ extensionId, name, targetId, url });
    setShown(targetId);
    let frame = 0;
    let still = 0;
    let last = "";
    const place = () => {
      const rect = slot.getBoundingClientRect();
      const at = `${rect.x} ${rect.y} ${rect.width} ${rect.height}`;
      if (at === last) {
        still += 1;
      } else {
        last = at;
        still = 0;
        Object.assign(webview.style, {
          borderRadius: getComputedStyle(slot).borderRadius,
          height: `${rect.height}px`,
          left: `${rect.x}px`,
          pointerEvents: "auto",
          top: `${rect.y}px`,
          visibility: "visible",
          width: `${rect.width}px`,
        } satisfies Partial<CSSStyleDeclaration>);
      }
      frame = still < STILL_FRAMES ? requestAnimationFrame(place) : 0;
    };
    const follow = () => {
      still = 0;
      if (frame === 0) {
        frame = requestAnimationFrame(place);
      }
    };
    const observer = new ResizeObserver(follow);
    observer.observe(slot);
    observer.observe(document.documentElement);
    follow();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      hide(webview);
      setShown((shown) => (shown === targetId ? null : shown));
    };
  }, [extensionId, name, setShown, targetId, url]);
  return (
    <div
      aria-label={name}
      className="min-h-0 flex-1 overflow-hidden rounded-xl bg-card [-webkit-app-region:no-drag]"
      ref={slotRef}
      role="region"
    />
  );
}
