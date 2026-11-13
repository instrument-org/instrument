import {
  PAGE_CAPTURE_CHANNEL,
  PAGE_CAPTURE_DEVICES_CHANNEL,
  PAGE_CAPTURE_PAUSE_CHANNEL,
  PAGE_CAPTURE_STOP_CHANNEL,
  PAGE_EDITOR_BOOT_CHANNEL,
  PAGE_EDGE_CHANNEL,
  PAGE_EDITOR_CHANNEL,
  PAGE_LAYER_CHANNEL,
  PAGE_REMOTE_CHANNEL,
  PAGE_THUMB_CHANNEL,
  type PageRemoteMessage,
} from "@/shared/page-editor-channels";
import { type PageEditorGuestMessage } from "@/shared/page-editor-messages";
/**
 * The preload of every browser guest. On every page it hands the mouse's
 * thumb buttons to the window, and on a local page the keys it had no use
 * for, and takes the keys the window drives it with. Otherwise it does nothing unless the guest is
 * showing a page's file being edited in place, and on a site it does not even
 * ask: the question is one synchronous message to the main process, made
 * before the page's first script so the editor can watch the page build
 * itself (see `editor/observer.ts`).
 *
 * The editor runs here, in the preload's isolated world: it reads and
 * changes the page's DOM, and the page's scripts cannot see it, call it, or
 * reach the channel it talks to the window on.
 */
import { contextBridge, ipcRenderer, webFrame } from "electron";

import { type PageEditorBoot, type PageEditorBridge } from "./bridge";
import { installObserver } from "./editor/observer";

/** The world this preload runs in, which Electron's context isolation keeps apart from the page's. */
const ISOLATED_WORLD = 999;

type Boot = PageEditorBoot | { error: string };

function boot() {
  if (/^(?:https?|about|chrome|devtools):$/.test(location.protocol)) {
    return;
  }
  let answer: Boot | null = null;
  try {
    answer = ipcRenderer.sendSync(PAGE_EDITOR_BOOT_CHANNEL) as Boot | null;
  } catch {
    return;
  }
  if (!answer) {
    return;
  }
  if ("error" in answer) {
    send({ kind: "error", message: answer.error, type: "status" });
    return;
  }
  const bridge: PageEditorBridge = {
    boot: answer,
    listen: (handler) => {
      // The window is the only sender on this channel: a guest's embedder.
      ipcRenderer.on(
        PAGE_EDITOR_CHANNEL,
        (_event, message: Parameters<typeof handler>[0]) => {
          handler(message);
        },
      );
    },
    send,
  };
  window.__instrumentPageEditor = bridge;
  // Now, before the page's first script, so every node the page's scripts
  // add or change is seen being added or changed.
  installObserver();
  // The bundle is an IIFE that reads the bridge above. It runs in this world,
  // never the page's, once there is a document for its libraries to look at,
  // and as a script the app injects rather than text turned into code, so a
  // page's own Content-Security-Policy has no say in it.
  const { bundle } = answer;
  document.addEventListener(
    "DOMContentLoaded",
    () => {
      webFrame
        .executeJavaScriptInIsolatedWorld(ISOLATED_WORLD, [{ code: bundle }])
        .catch((error: unknown) => {
          send({
            kind: "error",
            message: `The editor could not start: ${error instanceof Error ? error.message : String(error)}`,
            type: "status",
          });
        });
    },
    { once: true },
  );
}

/**
 * On a Mac the thumb buttons reach a page as mouse events, and Chromium steps
 * the guest's own history on the release unless the page consumes it; the
 * window decides instead, since back from a page's first entry is the tab's
 * back. Taken on the way down, before the page's own listeners, and on every
 * phase of the press, so neither Chromium nor a handler under the pointer
 * acts on it. Elsewhere the buttons arrive through the main process.
 */
function handThumbsToWindow() {
  if (process.platform !== "darwin") {
    return;
  }
  window.addEventListener("mousedown", swallow, { capture: true });
  window.addEventListener("auxclick", swallow, { capture: true });
  window.addEventListener(
    "mouseup",
    (event) => {
      if (!isThumb(event)) {
        return;
      }
      swallow(event);
      ipcRenderer.sendToHost(
        PAGE_THUMB_CHANNEL,
        event.button === 3 ? "back" : "forward",
      );
    },
    { capture: true },
  );
}

/**
 * On a local page, hands the window the keys the page had no use for, and
 * takes the window's keys while the keyboard stays beside the page:
 *
 * - An up or down arrow pressed alone and fresh rather than held, outside
 *   anything typed in, not answered by the page's own scripts, and with
 *   nothing the press would scroll able to go further that way. Whether it
 *   could scroll is read before the press is dispatched, and whether the
 *   page answered it after.
 * - Escape, the same way, pressed with nothing of the page's open.
 * - Whether something of the page's is open, each time that changes.
 */
function handKeysToWindow() {
  if (location.protocol !== "file:") {
    return;
  }
  // Where Chromium scrolls from when nothing is focused: the last place the
  // pointer went down.
  let pressedAt: Element | null = null;
  window.addEventListener(
    "pointerdown",
    (event) => {
      pressedAt = event.target instanceof Element ? event.target : null;
    },
    { capture: true },
  );
  window.addEventListener(
    "keydown",
    (event) => {
      const edge =
        event.key === "ArrowUp"
          ? "up"
          : event.key === "ArrowDown"
            ? "down"
            : event.key === "Escape"
              ? "escape"
              : null;
      if (
        !edge ||
        !event.isTrusted ||
        event.repeat ||
        event.isComposing ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        isTyping(event.target)
      ) {
        return;
      }
      if (edge === "escape" ? hasLayer() : canScrollFrom(scrollStart(), edge)) {
        return;
      }
      setTimeout(() => {
        if (!event.defaultPrevented) {
          ipcRenderer.sendToHost(PAGE_EDGE_CHANNEL, edge);
        }
      });
    },
    { capture: true },
  );
  function scrollStart() {
    const focused = document.activeElement;
    return focused &&
      focused !== document.body &&
      focused !== document.documentElement
      ? focused
      : pressedAt?.isConnected
        ? pressedAt
        : null;
  }
  ipcRenderer.on(PAGE_REMOTE_CHANNEL, (_event, message: PageRemoteMessage) => {
    if (message.type === "key") {
      // Where the page's own key would land. Built here, so the page sees an
      // untrusted event, the way a page sees any key a script sent it.
      const target = document.activeElement ?? document.body;
      const init = {
        bubbles: true,
        cancelable: true,
        code: message.key,
        composed: true,
        key: message.key,
      };
      target.dispatchEvent(new KeyboardEvent("keydown", init));
      target.dispatchEvent(new KeyboardEvent("keyup", init));
      return;
    }
    if (message.type === "scroll") {
      scrollByScreen(scrollStart(), message.by);
      return;
    }
    closeLayer();
  });
  let layered = false;
  const tellLayer = () => {
    const now = hasLayer();
    if (now !== layered) {
      layered = now;
      ipcRenderer.sendToHost(PAGE_LAYER_CHANNEL, now);
    }
  };
  document.addEventListener("fullscreenchange", tellLayer);
  document.addEventListener("toggle", tellLayer, { capture: true });
  new MutationObserver(tellLayer).observe(document, {
    attributeFilter: ["open"],
    subtree: true,
  });
}

/** What of the page's is open over it, which Escape would close: full screen, a modal dialog, or a popover. */
function topLayer(): Element | null {
  return (
    document.fullscreenElement ??
    [...document.querySelectorAll("dialog:modal, :popover-open")].at(-1) ??
    null
  );
}

function hasLayer() {
  return topLayer() !== null;
}

/**
 * Closes what of the page's is open, as Escape would: a dialog hears its
 * `cancel` first and may keep itself open.
 */
function closeLayer() {
  const layer = topLayer();
  if (!layer) {
    return;
  }
  if (layer === document.fullscreenElement) {
    void document.exitFullscreen();
    return;
  }
  if (layer instanceof HTMLDialogElement) {
    if (layer.dispatchEvent(new Event("cancel", { cancelable: true }))) {
      layer.close();
    }
    return;
  }
  if (layer instanceof HTMLElement) {
    layer.hidePopover();
  }
}

/** Scrolls what an arrow would by most of a screen, the way Space pages. */
function scrollByScreen(from: Element | null, by: -1 | 1) {
  const direction = by === 1 ? "down" : "up";
  const root = document.scrollingElement ?? document.documentElement;
  for (let at = from; at && at !== root; at = at.parentElement) {
    if (at !== document.body && isScroller(at) && hasRoomIn(at, direction)) {
      at.scrollBy({ behavior: "smooth", top: by * at.clientHeight * 0.85 });
      return;
    }
  }
  if (!topLayer()) {
    window.scrollBy({
      behavior: "smooth",
      top: by * window.innerHeight * 0.85,
    });
  }
}

function isScroller(element: Element) {
  return /^(?:auto|scroll|overlay)$/.test(getComputedStyle(element).overflowY);
}

function hasRoomIn(element: Element, direction: "down" | "up") {
  return hasRoom(
    element.scrollTop,
    element.clientHeight,
    element.scrollHeight,
    direction,
  );
}

/** Whether a press is typing: in a field, a menu of options, or editable text. */
function isTyping(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.closest("input, textarea, select") !== null)
  );
}

/**
 * Whether anything from `from` up to the page itself can still scroll that
 * way, which is where Chromium's arrow scroll looks, passing to the box
 * around one that has reached its end.
 */
function canScrollFrom(from: Element | null, direction: "down" | "up") {
  const root = document.scrollingElement ?? document.documentElement;
  for (let at = from; at && at !== root; at = at.parentElement) {
    if (at === document.body) {
      continue;
    }
    if (isScroller(at) && hasRoomIn(at, direction)) {
      return true;
    }
  }
  // The page itself, unless something of the page's is open over it, which
  // keeps the keys from what is behind, or it hides its overflow: `html`'s,
  // or the body's where `html` leaves it to the body.
  if (hasLayer()) {
    return false;
  }
  const htmlOverflow = getComputedStyle(document.documentElement).overflowY;
  const overflow =
    htmlOverflow === "visible" && document.body
      ? getComputedStyle(document.body).overflowY
      : htmlOverflow;
  return (
    overflow !== "hidden" &&
    overflow !== "clip" &&
    hasRoom(window.scrollY, window.innerHeight, root.scrollHeight, direction)
  );
}

function hasRoom(
  top: number,
  height: number,
  scrollHeight: number,
  direction: "down" | "up",
) {
  return direction === "up" ? top > 0.5 : top + height < scrollHeight - 0.5;
}

/** Whether a press is one of the mouse's thumb buttons, back or forward. */
function isThumb(event: MouseEvent) {
  return event.button === 3 || event.button === 4;
}

/** A message to the window, on the channel the page's scripts cannot reach. */
function send(message: PageEditorGuestMessage) {
  ipcRenderer.sendToHost(PAGE_EDITOR_CHANNEL, message);
}

/** Keeps a thumb press from the page and from Chromium's own history step. */
function swallow(event: MouseEvent) {
  if (isThumb(event)) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
}

/** The DOM events between the page's world and this one: what the page captures, and the window's Stop, Pause and picked devices. */
const CAPTURE_EVENTS = {
  devices: "instrument-page-capture-devices",
  pause: "instrument-page-capture-pause",
  report: "instrument-page-capture",
  stop: "instrument-page-capture-stop",
};

/**
 * Tells main what the page is capturing, which no Electron event says: the
 * page's `getUserMedia` and its tracks' `stop` and `clone` are wrapped in the
 * page's own world before its first script, and each change goes out as a
 * DOM event this world hears, with only a string on it (an object would not
 * cross between the worlds). Main's Stop comes back the same way, and ends
 * every track as though its device went away; so do Pause, which turns the
 * tracks off without ending them, and the devices the person picked for the
 * site, which replace a default device the page did not choose itself.
 */
function reportCapture() {
  if (!/^https?:$/.test(location.protocol)) {
    return;
  }
  document.addEventListener(CAPTURE_EVENTS.report, (event) => {
    if (event instanceof CustomEvent && typeof event.detail === "string") {
      ipcRenderer.send(PAGE_CAPTURE_CHANNEL, event.detail);
    }
  });
  const toPage = (name: string, detail = "") => {
    document.dispatchEvent(new CustomEvent(name, { detail }));
  };
  ipcRenderer.on(PAGE_CAPTURE_STOP_CHANNEL, () => {
    toPage(CAPTURE_EVENTS.stop);
  });
  ipcRenderer.on(PAGE_CAPTURE_PAUSE_CHANNEL, (_event, paused: unknown) => {
    toPage(CAPTURE_EVENTS.pause, paused === true ? "1" : "");
  });
  ipcRenderer.on(PAGE_CAPTURE_DEVICES_CHANNEL, (_event, devices: unknown) => {
    if (typeof devices === "string") {
      toPage(CAPTURE_EVENTS.devices, devices);
    }
  });
  try {
    contextBridge.executeInMainWorld({
      args: [CAPTURE_EVENTS],
      func: watchCaptureInPage,
    });
  } catch {
    // A page with no main world to run in has no tracks to watch either.
  }
}

/** Runs in the page's world, so everything it uses is its own. */
function watchCaptureInPage(names: {
  devices: string;
  pause: string;
  report: string;
  stop: string;
}) {
  const devices = navigator.mediaDevices as MediaDevices | undefined;
  if (!devices || typeof devices.getUserMedia !== "function") {
    return;
  }
  const live = new Set<MediaStreamTrack>();
  let told = "";
  const tell = () => {
    let audio = false;
    let video = false;
    for (const track of live) {
      if (track.readyState !== "live") {
        live.delete(track);
      } else if (track.kind === "audio") {
        audio = true;
      } else {
        video = true;
      }
    }
    const kinds = [audio && "audio", video && "video"]
      .filter(Boolean)
      .join(",");
    if (kinds !== told) {
      told = kinds;
      document.dispatchEvent(new CustomEvent(names.report, { detail: kinds }));
    }
  };
  let paused = false;
  /** The devices picked for the site, by name, as main last said. */
  let picked: { audio?: string; video?: string } = {};
  const watch = (track: MediaStreamTrack) => {
    live.add(track);
    track.addEventListener("ended", tell);
    if (paused) {
      track.enabled = false;
    }
  };
  const getUserMedia = devices.getUserMedia.bind(devices);
  const enumerate = devices.enumerateDevices.bind(devices);
  /**
   * Swaps a track the page left to the default device for the one picked
   * for the site, in place in the stream it was handed, so the page's first
   * picture and sound come from the device the person chose.
   */
  const usePicked = async (
    stream: MediaStream,
    constraints: MediaStreamConstraints | undefined,
  ) => {
    for (const kind of ["audio", "video"] as const) {
      const asked = constraints?.[kind];
      const name = picked[kind];
      const track = stream.getTracks().find((each) => each.kind === kind);
      if (
        !asked ||
        !name ||
        !track ||
        track.label === name ||
        (typeof asked === "object" && asked.deviceId !== undefined)
      ) {
        continue;
      }
      const device = (await enumerate()).find(
        (each) => each.kind === `${kind}input` && each.label === name,
      );
      if (!device) {
        continue;
      }
      const swap = await getUserMedia({
        [kind]: {
          ...(typeof asked === "object" ? asked : {}),
          deviceId: { exact: device.deviceId },
        },
      }).catch(() => null);
      const fresh = swap?.getTracks()[0];
      if (!fresh) {
        continue;
      }
      stream.removeTrack(track);
      stop.call(track);
      live.delete(track);
      stream.addTrack(fresh);
    }
  };
  devices.getUserMedia = async (constraints) => {
    const stream = await getUserMedia(constraints);
    await usePicked(stream, constraints).catch(() => undefined);
    stream.getTracks().forEach(watch);
    tell();
    return stream;
  };
  const trackProto = MediaStreamTrack.prototype;
  // oxlint-disable-next-line typescript/unbound-method -- kept to call on each track with `.call`, past the wrapper
  const stop = trackProto.stop;
  trackProto.stop = function (this: MediaStreamTrack) {
    stop.call(this);
    if (live.delete(this)) {
      tell();
    }
  };
  // oxlint-disable-next-line typescript/unbound-method -- kept to call on each track with `.call`, past the wrapper
  const cloneTrack = trackProto.clone;
  trackProto.clone = function (this: MediaStreamTrack) {
    const copy = cloneTrack.call(this);
    if (live.has(this)) {
      watch(copy);
    }
    return copy;
  };
  // oxlint-disable-next-line typescript/unbound-method -- kept to call on each stream with `.call`, past the wrapper
  const cloneStream = MediaStream.prototype.clone;
  MediaStream.prototype.clone = function (this: MediaStream) {
    const copy = cloneStream.call(this);
    if (this.getTracks().some((track) => live.has(track))) {
      copy.getTracks().forEach(watch);
    }
    return copy;
  };
  document.addEventListener(names.devices, (event) => {
    if (event instanceof CustomEvent && typeof event.detail === "string") {
      try {
        picked = JSON.parse(event.detail) as typeof picked;
      } catch {
        picked = {};
      }
    }
  });
  document.addEventListener(names.pause, (event) => {
    paused = event instanceof CustomEvent && event.detail === "1";
    for (const track of live) {
      track.enabled = !paused;
    }
  });
  document.addEventListener(names.stop, () => {
    for (const track of live) {
      stop.call(track);
      track.dispatchEvent(new Event("ended"));
    }
    live.clear();
    tell();
  });
}

handThumbsToWindow();
handKeysToWindow();
reportCapture();
boot();
