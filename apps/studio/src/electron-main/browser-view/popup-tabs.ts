import type { WebContents, WebContentsView } from "electron";

import { publisher } from "@/electron-main/rpc/publisher";
import { type PopupEvent, type PopupState } from "@/shared/browser";
import { type BrowserTargetId } from "@instrument-org/workspace/electron";

/** What the window shows of a popup's page: its address, title, history and load. */
export function popupState(page: WebContents): PopupState {
  return {
    canGoBack: page.navigationHistory.canGoBack(),
    canGoForward: page.navigationHistory.canGoForward(),
    loading: page.isLoading(),
    title: page.getTitle(),
    url: page.getURL(),
    webContentsId: page.id,
    zoom: page.getZoomFactor(),
  };
}

/**
 * Sends the window what a popup's page does, in the shapes a `<webview>`'s
 * own events carry, each with the page's state after it, so the window's
 * handle on the popup reads as a tab's guest does.
 */
export function forwardPopupEvents(
  targetId: BrowserTargetId,
  page: WebContents,
): void {
  const send = (event: PopupEvent | null) => {
    if (page.isDestroyed()) {
      return;
    }
    publisher.publish("browser.popup-changed", {
      event,
      state: popupState(page),
      targetId,
    });
  };
  page.on("did-start-loading", () => {
    send({ detail: {}, name: "did-start-loading" });
  });
  page.on("did-stop-loading", () => {
    send({ detail: {}, name: "did-stop-loading" });
  });
  page.on("dom-ready", () => {
    send({ detail: {}, name: "dom-ready" });
  });
  page.on("did-start-navigation", (details) => {
    send({
      detail: {
        isInPlace: details.isSameDocument,
        isMainFrame: details.isMainFrame,
        url: details.url,
      },
      name: "did-start-navigation",
    });
  });
  page.on("did-navigate", (_event, url, httpResponseCode) => {
    send({ detail: { httpResponseCode, url }, name: "did-navigate" });
  });
  page.on("did-navigate-in-page", (_event, url, isMainFrame) => {
    send({ detail: { isMainFrame, url }, name: "did-navigate-in-page" });
  });
  page.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      send({
        detail: { errorCode, errorDescription, isMainFrame, validatedURL },
        name: "did-fail-load",
      });
    },
  );
  page.on("page-title-updated", (_event, title) => {
    send({ detail: { title }, name: "page-title-updated" });
  });
  page.on("page-favicon-updated", (_event, favicons) => {
    send({ detail: { favicons }, name: "page-favicon-updated" });
  });
  page.on("found-in-page", (_event, result) => {
    send({ detail: { result }, name: "found-in-page" });
  });
  page.on("zoom-changed", () => {
    send(null);
  });
}

/**
 * Shows a popup's view over the slot showing its tab, in the window's
 * pixels, or hides it when no slot shows it, or something of the window's
 * own is open over the slot.
 */
export function placePopupView(
  view: WebContentsView,
  bounds: null | { height: number; width: number; x: number; y: number },
): void {
  if (!bounds) {
    view.setVisible(false);
    return;
  }
  view.setBounds({
    height: Math.round(bounds.height),
    width: Math.round(bounds.width),
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
  });
  view.setVisible(true);
}
