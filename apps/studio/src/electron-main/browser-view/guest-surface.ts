import { type BrowserTargetId } from "@instrument-org/workspace/electron";

import { publisher } from "../rpc/publisher";
import { log } from "./log";

export interface GuestSurfaceSize {
  height: number;
  width: number;
}

// What the renderer last reported this window can rasterize in full, in CSS px.
// Main cannot derive it: the budget follows the window's content box, which only
// the renderer measures. Null until the pool reports, which it does as soon as it
// starts and on every resize after.
let rasterBudget: GuestSurfaceSize | null = null;

// What each target's guest has been asked to lay out at while parked. Held here
// rather than in the renderer so a renderer reload does not silently drop a size
// the model is still reasoning about; the pool re-reads it on subscribe.
const desiredSurfaces = new Map<BrowserTargetId, GuestSurfaceSize>();

// The size each guest is actually laid out at, as the renderer last applied it.
// It tracks the requested size until the window shrinks under it, at which point
// the pool clamps the guest to what this window can rasterize and reports the
// smaller number here. Keeping both is deliberate: the request survives so the
// guest returns to it when the window grows back, while this is what the guest
// can currently be asked about.
const effectiveSurfaces = new Map<BrowserTargetId, GuestSurfaceSize>();

/** Forget a target's surfaces, e.g. when its guest is destroyed. */
export function clearGuestSurface(targetId: BrowserTargetId) {
  effectiveSurfaces.delete(targetId);
  if (desiredSurfaces.delete(targetId)) {
    publisher.publish("browser.set-guest-surface", { size: null, targetId });
  }
}

export function getDesiredGuestSurfaces(): [
  BrowserTargetId,
  GuestSurfaceSize,
][] {
  return [...desiredSurfaces];
}

/**
 * What the target's guest is laid out at right now, or null before the renderer
 * has reported. Answers the window-dimension probe agent-browser makes, which
 * would otherwise report a fixed default and be wrong the moment either an agent
 * or a window resize moved the guest off it.
 */
export function getEffectiveGuestSurface(
  targetId: BrowserTargetId,
): GuestSurfaceSize | null {
  return effectiveSurfaces.get(targetId) ?? null;
}

/** Renderer-reported: the size the pool actually applied to a parked guest. */
export function recordEffectiveGuestSurface({
  size,
  targetId,
}: {
  size: GuestSurfaceSize;
  targetId: BrowserTargetId;
}) {
  const previous = effectiveSurfaces.get(targetId);
  effectiveSurfaces.set(targetId, size);

  const requested = desiredSurfaces.get(targetId);
  const clamped =
    requested != null &&
    (size.width < requested.width || size.height < requested.height);
  const changed =
    previous === undefined ||
    previous.width !== size.width ||
    previous.height !== size.height;
  if (clamped && changed) {
    log.info(
      `guest surface clamped targetId=${targetId} requested=${requested.width}x${requested.height} effective=${size.width}x${size.height}`,
    );
  }
}

/**
 * Record the size a target's parked guest should lay out at, or reject the
 * request when this window cannot rasterize it.
 *
 * The rejection is the point. Chromium crops a capture to the raster budget
 * while the page keeps reporting the size it was asked for, so silently clamping
 * would hand the model a viewport number that its own screenshots disagree with.
 * Refusing with the maximum lets it ask again for something real.
 */
export function requestGuestSurface({
  size,
  targetId,
}: {
  size: GuestSurfaceSize;
  targetId: BrowserTargetId;
}): { error: string; ok: false } | { ok: true } {
  if (!Number.isFinite(size.width) || !Number.isFinite(size.height)) {
    return { error: "Viewport width and height must be numbers.", ok: false };
  }
  if (size.width < 1 || size.height < 1) {
    return {
      error: "Viewport width and height must be at least 1.",
      ok: false,
    };
  }

  const budget = rasterBudget;
  if (!budget) {
    return {
      error:
        "The browser window has not reported its size yet. Retry in a moment.",
      ok: false,
    };
  }

  if (size.width > budget.width || size.height > budget.height) {
    return {
      error: `A ${size.width}x${size.height} viewport is larger than this window can render. The most it can render right now is ${budget.width}x${budget.height}, and a larger app window raises that. Ask for that size or smaller; to capture more than a viewport, export the page to PDF instead: \`agent-browser pdf <path>\`.`,
      ok: false,
    };
  }

  desiredSurfaces.set(targetId, size);
  publisher.publish("browser.set-guest-surface", { size, targetId });
  log.info(
    `guest surface set targetId=${targetId} size=${size.width}x${size.height}`,
  );
  return { ok: true };
}

/** Renderer-reported budget: 1.3x its content box, per axis. */
export function setRasterBudget(size: GuestSurfaceSize) {
  rasterBudget = size;
}
