import { APP_PROTOCOL } from "@instrument-org/shared";

/**
 * Where the frame a card draws a page in is served (`live-page-frame.ts` in
 * the main process): a document of its own policy, framed with an opaque
 * origin, that writes the page it is sent over itself, so the page's scripts
 * run where they cannot reach the app, the disk or the network past the page
 * skill's hosts.
 */
export const LIVE_PAGE_HOST = "live-page";

export const LIVE_PAGE_FRAME_URL = `${APP_PROTOCOL}://${LIVE_PAGE_HOST}/`;

/**
 * The width a card lays a page out at before scaling it down to the card, so
 * the card reads as the page's first screen on a desk.
 */
export const LIVE_PAGE_WIDTH = 1024;

type Scroll = { x: number; y: number };

/**
 * What the window sends the frame, under a `livePage` key:
 *
 * - `open`: start the page afresh.
 * - `write`: write each piece in order, `null` standing for the page skill's
 *   foundation (its stylesheet and behaviors), which the frame has.
 * - `close`: the page is whole. Once it has loaded and drawn, the frame
 *   scrolls it to `scroll` (`"end"` for its foot), if given, and answers
 *   `loaded`.
 * - `follow`: keep the page's foot in view as it grows, gliding there
 *   (`followStep`), until the page is whole and the glide has come to rest.
 * - `glide`: ease the page to `to` over `ms` (`easeStep`).
 *
 * And what the frame answers: `ready` once it listens, `shows` once the page
 * draws enough to show, `loaded`, `scroll` as the page scrolls, and `rest`
 * when a follow or glide has stopped.
 */
export type LivePageMessage =
  | { ms: number; to: Scroll; type: "glide" }
  | { pieces: (null | string)[]; type: "write" }
  | { scroll?: "end" | Scroll; type: "close" }
  | { type: "follow" }
  | { type: "open" };

/**
 * One frame of a scroll following a page's foot as the page grows: a
 * critically damped spring, which turns writes landing in steps into one
 * steady glide and stops at its target rather than passing it, so it never
 * moves back while the page only grows. Answers where the scroll is and how
 * fast it moves (px per ms). The frame's script runs this function's own
 * source (`live-page-frame.ts`), so it uses nothing from outside its body.
 */
export function followStep(
  at: number,
  velocity: number,
  target: number,
  ms: number,
): [at: number, velocity: number] {
  // About how far behind a steadily growing page it trails: the longer, the
  // smoother the steps it irons out.
  const trailMs = 300;
  // A frame that comes late moves as far as one at 15 a second would.
  const dt = Math.min(Math.max(ms, 0), 64);
  const omega = 2 / trailMs;
  const x = omega * dt;
  const decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = at - target;
  const pull = (velocity + omega * change) * dt;
  const next = target + (change + pull) * decay;
  const passed = at <= target ? next > target : next < target;
  return passed ? [target, 0] : [next, (velocity - omega * pull) * decay];
}

/**
 * Where a scroll easing from `from` to `to` over `total` ms stands after
 * `elapsed`, slow at both ends. Run from its own source, as `followStep` is.
 */
export function easeStep(
  from: number,
  to: number,
  elapsed: number,
  total: number,
): number {
  const t = total <= 0 ? 1 : Math.min(1, Math.max(0, elapsed / total));
  const eased = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
  return from + (to - from) * eased;
}
