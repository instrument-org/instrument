import { holdKeyboardFromPages } from "@/client/lib/browser-pool";
import { focusScreenHome } from "@/client/lib/keyboard-home";
import { atom, getDefaultStore, useAtomValue } from "jotai";
import { useEffect, useLayoutEffect, useRef } from "react";

import { showDrop } from "../sidebar-drop";
import { standInTabsAtom } from "../stand-in-tabs";
import {
  hasRested,
  holds,
  isOffWindow,
  type Point,
  type Rect,
  restAt,
  scrollSpeed,
  START_PX,
  type Dwell,
  DWELL_MS,
  FILE_GRAB_PX,
} from "./landing";
import { type Held, type Landing } from "./types";

/**
 * The one drag a window has going: whatever is held, by the pointer, the
 * system's drag or another window's, goes through here, and every place
 * that takes a drop answers through the targets it registers
 * (`useDropTarget`). A drag the pointer holds starts at one distance
 * (`START_PX`), is measured once a frame, scrolls the list under it near the
 * list's ends, waits a moment at a page's end before it splits the page
 * (`DWELL_MS`), and ends in one place for Escape, the window losing focus,
 * and the system taking the pointer away.
 */

/** A drag as the window draws it: what is held, how, where it would land, and where in it the pointer holds it. */
export interface Drag {
  /** Where in what is held the pointer holds it, in the window's px: a tab's left edge stands `grab.x` left of the pointer. */
  grab: Point;
  held: Held;
  /** The pointer here, the system's drag (files from elsewhere), or main, for another window's tab held over this one. */
  input: "native" | "pointer" | "remote";
  /** Past every edge of this window, where main has what is held. */
  isOff: boolean;
  landing: Landing | undefined;
}

export const dragAtom = atom<Drag | undefined>(undefined);

/**
 * Where the pointer is now, in the window's px, which whatever follows it
 * reads every frame (`useDragFrame`) rather than drawing again on each move.
 */
export const dragPoint: Point = { x: 0, y: 0 };

/** A place in the window that takes something held, which the window's own moves land (`setLander`). */
export interface DropTarget {
  /**
   * What letting go at a point would do, or nothing, or "native" where only
   * the system's drag can hand the files over (a web page, a composer).
   * `splits` is whether a page's end may make a side of its own, which it
   * may once the pointer has rested there.
   */
  landingAt: (
    point: Point,
    drag: Pick<Drag, "grab" | "held" | "input">,
    how: { splits: boolean },
  ) => Landing | "native" | undefined;
  /** Where it takes drops, in the window's px, as laid out now. */
  rect: () => Rect | undefined;
  /** A list in it that scrolls while something held nears its ends. */
  scrolls?: { axis: "x" | "y"; element: () => HTMLElement | null | undefined };
}

const targets = new Set<DropTarget>();

/**
 * Registers a place that takes drops for as long as it is mounted, read as
 * it is at each measure. None while `target` is, and none in a picture of
 * a window (`standInTabsAtom`).
 */
export function useDropTarget(target: DropTarget | undefined) {
  const latest = useRef(target);
  useLayoutEffect(() => {
    latest.current = target;
  });
  const isPicture = useAtomValue(standInTabsAtom) !== undefined;
  const isOn = target !== undefined && !isPicture;
  const scrolls = target?.scrolls !== undefined;
  useEffect(() => {
    if (!isOn) {
      return;
    }
    const registered: DropTarget = {
      landingAt: (point, drag, how) =>
        latest.current?.landingAt(point, drag, how),
      rect: () => latest.current?.rect(),
      ...(scrolls
        ? {
            scrolls: {
              axis: latest.current?.scrolls?.axis ?? "y",
              element: () => latest.current?.scrolls?.element(),
            },
          }
        : {}),
    };
    targets.add(registered);
    return () => {
      targets.delete(registered);
    };
  }, [isOn, scrolls]);
}

const frameListeners = new Set<() => void>();

/** Runs after every measure of the drag, for what follows the pointer without drawing again. */
export function useDragFrame(listener: () => void) {
  const latest = useRef(listener);
  useLayoutEffect(() => {
    latest.current = listener;
  });
  useEffect(() => {
    const call = () => {
      latest.current();
    };
    frameListeners.add(call);
    return () => {
      frameListeners.delete(call);
    };
  }, []);
}

/** What the window's own moves do with something let go where it lands, or where nothing takes it (`useDragSystem`). */
type Lander = (held: Held, landing: Landing | undefined) => void;
let lander: Lander | undefined;
export function setLander(next: Lander | undefined) {
  lander = next;
}

/**
 * A drag that main carries past the window's edges as well, a tab's or a
 * whole group's: told of every move, and asked at the release whether what
 * is held went to another window or a window of its own.
 */
export interface Carry {
  cancel: () => void;
  /** The window goes with the pointer, as a window's only tab takes it: nothing in it can take what is held. */
  followsPointer: boolean;
  move: (event: PointerEvent, isOff: boolean) => void;
  /** Let go past the window, or with the window following: main says whether it went (`gone`) or stays. */
  release: (event: PointerEvent) => Promise<"gone" | "stays">;
}
type Carrier = (
  held: Held,
  event: PointerEvent,
  grab: Point,
) => Carry | undefined;
let carrier: Carrier | undefined;
export function setCarrier(next: Carrier | undefined) {
  carrier = next;
}

interface Session {
  carry: Carry | undefined;
  /** Told each time the landing changes, for a drag whose landing goes back to main. */
  onLanding?: (landing: Landing | undefined) => void;
  /** Measures again once a rest begun with the pointer still has gone on long enough. */
  restTimer?: number;
  drag: Drag;
  dwell: Dwell | undefined;
  /** Each list scrolling under the pointer, since when the pointer has been at its end, and when it last scrolled. */
  scrolling: Map<HTMLElement, { last: number; since: number }>;
  stop: () => void;
}

let session: Session | undefined;

/** The drag the window has going, read now. */
export function currentDrag() {
  return session?.drag;
}

function publish(drag: Drag | undefined) {
  const store = getDefaultStore();
  const was = store.get(dragAtom);
  if (
    was === drag ||
    (was !== undefined &&
      drag !== undefined &&
      was.held === drag.held &&
      was.input === drag.input &&
      was.isOff === drag.isOff &&
      was.grab === drag.grab &&
      JSON.stringify(was.landing) === JSON.stringify(drag.landing))
  ) {
    return;
  }
  store.set(dragAtom, drag);
}

/** Every target under a point, the innermost first. */
function targetsAt(point: Point) {
  return [...targets]
    .flatMap((target) => {
      const rect = target.rect();
      return rect && holds(rect, point)
        ? [{ area: rect.width * rect.height, target }]
        : [];
    })
    .toSorted((a, b) => a.area - b.area)
    .map(({ target }) => target);
}

/** Where what is held lands at a point; "native" where only the system's drag reaches. */
function measure(
  point: Point,
  drag: Pick<Drag, "grab" | "held" | "input">,
  how = { splits: true },
): { landing?: Landing; native?: true } {
  for (const target of targetsAt(point)) {
    const found = target.landingAt(point, drag, how);
    if (found === "native") {
      return { native: true };
    }
    if (found) {
      return { landing: found };
    }
  }
  return {};
}

/** A landing that splits a page waits for the pointer to rest there; this names which one it rests on. */
function restKeyOf(landing: Landing | undefined) {
  return landing?.kind === "side" && landing.split
    ? `${landing.group}:${landing.side}`
    : undefined;
}

/** Measures the session where the pointer is now, and shows what it found. */
function evaluate(current: Session, now = performance.now()) {
  const { drag } = current;
  const isOff =
    current.carry?.followsPointer === true ||
    (drag.input === "pointer" &&
      isOffWindow(dragPoint, {
        height: window.innerHeight,
        width: window.innerWidth,
      }));
  const found = isOff ? {} : measure(dragPoint, drag);
  const restKey = restKeyOf(found.landing);
  current.dwell = restAt(current.dwell, restKey, dragPoint, now);
  const isResting = restKey !== undefined && !hasRested(current.dwell, now);
  // Until the pointer has rested at a page's end, the end is what the rest
  // of the page is, so nothing there goes on to what the page shows.
  const landing = isResting
    ? measure(dragPoint, drag, { splits: false }).landing
    : found.landing;
  window.clearTimeout(current.restTimer);
  if (isResting && current.dwell) {
    current.restTimer = window.setTimeout(
      () => {
        if (session === current) {
          evaluate(current);
        }
      },
      current.dwell.since + DWELL_MS - now,
    );
  }
  const changed = JSON.stringify(drag.landing) !== JSON.stringify(landing);
  current.drag = { ...drag, isOff, landing };
  if (changed) {
    current.onLanding?.(landing);
  }
  showDrop(landing?.kind === "sidebar" ? landing.drop : undefined);
  publish(current.drag);
  for (const listener of frameListeners) {
    listener();
  }
}

/** Scrolls whatever list of a target the pointer is near the end of, by how long since the last frame. */
function scrollLists(current: Session, now: number) {
  const near = new Set<HTMLElement>();
  for (const target of targetsAt(dragPoint)) {
    const scroller = target.scrolls;
    const element = scroller?.element();
    if (!scroller || !element) {
      continue;
    }
    const bounds = element.getBoundingClientRect();
    const isX = scroller.axis === "x";
    const first = isX ? bounds.left : bounds.top;
    const last = isX ? bounds.right : bounds.bottom;
    const at = isX ? dragPoint.x : dragPoint.y;
    const was = current.scrolling.get(element);
    const speed = scrollSpeed({
      at,
      end: last,
      heldFor: was ? now - was.since : 0,
      start: first,
    });
    if (speed === 0) {
      continue;
    }
    near.add(element);
    const since = was?.since ?? now;
    const elapsed = was ? now - was.last : 0;
    current.scrolling.set(element, { last: now, since });
    // In the list's own px, which the window's zoom scales.
    const zoom = isX
      ? bounds.width / (element.offsetWidth || 1)
      : bounds.height / (element.offsetHeight || 1);
    const by = (speed * elapsed) / 1000 / (zoom || 1);
    if (isX) {
      element.scrollLeft += by;
    } else {
      element.scrollTop += by;
    }
  }
  for (const element of current.scrolling.keys()) {
    if (!near.has(element)) {
      current.scrolling.delete(element);
    }
  }
}

/** Ends the session where it stands: nothing lands, and everything it drew goes. */
function end(current: Session) {
  if (session !== current) {
    return;
  }
  session = undefined;
  window.clearTimeout(current.restTimer);
  current.stop();
  showDrop(undefined);
  publish(undefined);
  for (const listener of frameListeners) {
    listener();
  }
}

/** Keeps the click a drag's release makes from choosing what is under it. */
function swallowNextClick() {
  const swallow = (click: MouseEvent) => {
    click.stopPropagation();
    click.preventDefault();
  };
  window.addEventListener("click", swallow, { capture: true, once: true });
  setTimeout(() => {
    window.removeEventListener("click", swallow, { capture: true });
  }, 0);
}

/** A press as the pointer made it. */
interface Press {
  button: number;
  clientX: number;
  clientY: number;
  isPrimary: boolean;
}

/**
 * A press that becomes a drag once the pointer has moved `START_PX` from
 * it. `begin` says, at that moment, what is held and where in it the press
 * was (from the press, not the pointer now), or nothing to let the press be
 * a click. Returns whether it is listening.
 */
export function pressToDrag(
  press: Press,
  begin: () => undefined | { grab: Point; held: Held },
): boolean {
  if (
    press.button !== 0 ||
    !press.isPrimary ||
    session?.drag.input === "pointer"
  ) {
    return false;
  }
  const from = { x: press.clientX, y: press.clientY };
  // A page the press brings up takes the keyboard once the press is over,
  // as a click or as the drag it becomes, which holds pages off for itself.
  const letGoOfKeyboard = holdKeyboardFromPages();
  // A page runs in a process of its own, which takes every move over it,
  // and the release, from a press in the window: a bookmark pulled down
  // onto the page under the bar would never move far enough here to be a
  // drag. Pages let the pointer pass from the press, as the drag has them.
  document.documentElement.toggleAttribute("data-pressing", true);
  const stop = () => {
    document.documentElement.removeAttribute("data-pressing");
    window.removeEventListener("pointermove", onMove, { capture: true });
    window.removeEventListener("pointerup", onEnd, { capture: true });
    window.removeEventListener("pointercancel", onEnd, { capture: true });
  };
  const onEnd = () => {
    stop();
    letGoOfKeyboard();
  };
  const onMove = (move: PointerEvent) => {
    if (!move.isPrimary) {
      return;
    }
    // The button came up where the window never heard it: the press is over.
    if ((move.buttons & 1) === 0) {
      onEnd();
      return;
    }
    if (Math.hypot(move.clientX - from.x, move.clientY - from.y) < START_PX) {
      return;
    }
    stop();
    const started = begin();
    if (started) {
      startPointerDrag(started.held, started.grab, move);
    }
    letGoOfKeyboard();
  };
  window.addEventListener("pointermove", onMove, { capture: true });
  window.addEventListener("pointerup", onEnd, { capture: true });
  window.addEventListener("pointercancel", onEnd, { capture: true });
  return true;
}

/** The element a page is drawn in by a frame of its own: a guest's `<webview>`, or an iframe. */
function isPageFrame(element: Element | null): element is HTMLElement {
  return (
    element instanceof HTMLElement &&
    (element.tagName === "WEBVIEW" || element.tagName === "IFRAME")
  );
}

/** A drag the pointer holds, from its first movement past the start. */
function startPointerDrag(held: Held, grab: Point, event: PointerEvent) {
  if (session) {
    end(session);
  }
  dragPoint.x = event.clientX;
  dragPoint.y = event.clientY;
  let frame = 0;
  const onMove = (move: PointerEvent) => {
    if (!move.isPrimary || session !== current) {
      return;
    }
    dragPoint.x = move.clientX;
    dragPoint.y = move.clientY;
    evaluate(current);
    current.carry?.move(move, current.drag.isOff);
  };
  const onUp = (up: PointerEvent) => {
    if (!up.isPrimary || session !== current) {
      return;
    }
    dragPoint.x = up.clientX;
    dragPoint.y = up.clientY;
    swallowNextClick();
    void release(current, up);
  };
  const onCancel = () => {
    cancel(current);
  };
  const onKey = (key: KeyboardEvent) => {
    if (key.key !== "Escape") {
      return;
    }
    key.preventDefault();
    key.stopPropagation();
    cancel(current);
  };
  // A page with the keyboard hears keys, and the window's loss of focus, in
  // a process of its own; on a Mac the window's document then reads as
  // unfocused too. Pages are held off the keyboard for the drag
  // (`holdKeyboardFromPages`), and one that takes it anyway (an agent typing
  // into it) gives it back, so Escape and losing the window still reach the
  // drag here. The keyboard goes home once the drag is over.
  const letGoOfKeyboard = holdKeyboardFromPages();
  let tookKeyboard = false;
  const takeKeyboard = () => {
    const page = document.activeElement;
    if (session === current && isPageFrame(page)) {
      tookKeyboard = true;
      page.blur();
    }
  };
  // Losing the window to another app takes the pointer with it; main's own
  // pictures off the window take nothing, and neither does the keyboard
  // going into a page in the window, which blurs the window too.
  const onBlur = () => {
    if (isPageFrame(document.activeElement)) {
      // Once the page has the keyboard, not while it is moving there.
      window.setTimeout(takeKeyboard, 0);
    } else if (!current.drag.isOff) {
      cancel(current);
    }
  };
  const onHidden = () => {
    if (document.visibilityState === "hidden") {
      cancel(current);
    }
  };
  const tick = (now: number) => {
    if (session !== current) {
      return;
    }
    scrollLists(current, now);
    evaluate(current, now);
    frame = requestAnimationFrame(tick);
  };
  const current: Session = {
    carry: undefined,
    drag: { grab, held, input: "pointer", isOff: false, landing: undefined },
    dwell: undefined,
    scrolling: new Map(),
    stop: () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove, { capture: true });
      window.removeEventListener("pointerup", onUp, { capture: true });
      window.removeEventListener("pointercancel", onCancel, { capture: true });
      window.removeEventListener("keydown", onKey, { capture: true });
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onHidden);
      document.documentElement.removeAttribute("data-tab-held");
      letGoOfKeyboard();
      if (tookKeyboard) {
        tookKeyboard = false;
        focusScreenHome({ leaving: false });
      }
    },
  };
  session = current;
  // A page runs in a process of its own, which would take the pointer and
  // the release with it, so pages let it pass for the drag.
  document.documentElement.toggleAttribute("data-tab-held", true);
  window.addEventListener("pointermove", onMove, { capture: true });
  window.addEventListener("pointerup", onUp, { capture: true });
  window.addEventListener("pointercancel", onCancel, { capture: true });
  window.addEventListener("keydown", onKey, { capture: true });
  window.addEventListener("blur", onBlur);
  document.addEventListener("visibilitychange", onHidden);
  // A page may have taken the keyboard during the press all the same.
  takeKeyboard();
  current.carry = carrier?.(held, event, grab);
  evaluate(current);
  frame = requestAnimationFrame(tick);
}

/** Puts back what is held, landing nothing. */
function cancel(current: Session) {
  if (session !== current) {
    return;
  }
  current.carry?.cancel();
  end(current);
}

/** Let go: main says where something carried past the window went, and anything else lands where it is. */
async function release(current: Session, event: PointerEvent) {
  evaluate(current);
  if (session !== current) {
    return;
  }
  const { carry, drag } = current;
  current.stop();
  if (carry && (drag.isOff || carry.followsPointer)) {
    // What the window drew for the drag stays until main has said.
    await carry.release(event).catch(() => "stays" as const);
    end(current);
    return;
  }
  carry?.cancel();
  lander?.(drag.held, drag.landing);
  end(current);
  // What landed may have moved the keyboard to another side or group, and
  // the press left the caret where it was, or on nothing.
  focusScreenHome({ leaving: false });
}

/**
 * Another window's tab, or whole group, held over this one by main, which
 * says where the pointer is: measured here as any drag is, and answered with
 * where it lands. None once main says it has gone.
 */
export function followRemote(
  next: undefined | { grab: Point; held: Held; point: Point },
  onLanding: (landing: Landing | undefined) => void,
): Landing | undefined {
  if (!next) {
    if (session?.drag.input === "remote") {
      end(session);
    }
    return undefined;
  }
  dragPoint.x = next.point.x;
  dragPoint.y = next.point.y;
  const current =
    session?.drag.input === "remote" &&
    JSON.stringify(session.drag.held) === JSON.stringify(next.held)
      ? session
      : startSession(next.held, next.grab, "remote");
  current.onLanding = onLanding;
  evaluate(current);
  return current.drag.landing;
}

/** Files from elsewhere held over the window by the system's drag, as it says where the pointer is. */
export function followNative(
  held: Extract<Held, { kind: "files" }>,
  point: Point,
): Landing | undefined {
  dragPoint.x = point.x;
  dragPoint.y = point.y;
  const current =
    session?.drag.input === "native"
      ? session
      : startSession(held, { x: FILE_GRAB_PX, y: 0 }, "native");
  if (current.drag.held !== held) {
    current.drag = { ...current.drag, held };
  }
  evaluate(current);
  return current.drag.landing;
}

/** The system's drag let go over the window: where it lands, which the caller lands, and the drag over. */
export function releaseNative(point: Point): Landing | undefined {
  const current = session;
  if (current?.drag.input !== "native") {
    return undefined;
  }
  dragPoint.x = point.x;
  dragPoint.y = point.y;
  evaluate(current);
  const { landing } = current.drag;
  end(current);
  return landing;
}

/** Ends a drag that came from elsewhere, the system's or another window's, with nothing landing. */
export function endFromElsewhere(input: "native" | "remote") {
  if (session?.drag.input === input) {
    end(session);
  }
}

function startSession(held: Held, grab: Point, input: "native" | "remote") {
  if (session) {
    end(session);
  }
  const current: Session = {
    carry: undefined,
    drag: { grab, held, input, isOff: false, landing: undefined },
    dwell: undefined,
    scrolling: new Map(),
    stop: () => undefined,
  };
  session = current;
  return current;
}
