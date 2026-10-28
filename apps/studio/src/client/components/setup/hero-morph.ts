import { type RefObject, useLayoutEffect, useState } from "react";

import { useHeroMorph, useHeroRegistry } from "./kit/setup-page-switch";

/** How long a piece takes to fly from the picture before to its place. */
const FLY_MS = 650;
/** Each piece leaves a little after the one before it. */
const STAGGER_MS = 25;
/** A gentle overshoot, so a piece settles into its place. */
const FLY_EASING = "cubic-bezier(0.32, 1.15, 0.5, 1)";

/**
 * Makes a setup picture one picture with the page before's, where the
 * switch says the two pages share one (`sharedHero`): each piece marked
 * `data-hero-piece` flies from where the same piece was in the picture
 * before, turning from its tilt there (`data-rotate`) to its own, and the
 * pieces there are hidden at once so only one of each is seen. A piece
 * whose own box isn't its shape (the folder's art, in a square bigger than
 * the folder) is measured by an element marked `data-hero-box` with its
 * name instead. A piece the
 * picture before had none of fades in where it is. Returns whether the
 * picture is arriving that way, which holds back its own entrance.
 */
export function useHeroPieces(ref: RefObject<HTMLElement | null>): boolean {
  const registry = useHeroRegistry();
  // Read once: the page's flag changes as it leaves, and the picture
  // registers for as long as it is mounted.
  const [morph] = useState(useHeroMorph());
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root || !registry) {
      return;
    }
    const before = registry.current;
    registry.current = root;
    if (morph && before) {
      flyFrom(before, root);
    }
    return () => {
      if (registry.current === root) {
        registry.current = null;
      }
    };
  }, [morph, ref, registry]);
  return morph;
}

function flyFrom(before: HTMLElement, root: HTMLElement) {
  const pieces = root.querySelectorAll<HTMLElement>("[data-hero-piece]");
  const sources = new Map<string, HTMLElement[]>();
  for (const piece of before.querySelectorAll<HTMLElement>(
    "[data-hero-piece]",
  )) {
    const name = piece.dataset.heroPiece ?? "";
    sources.set(name, [...(sources.get(name) ?? []), piece]);
  }
  // Parts of one piece (the folder's back and front) move as one.
  const order = [...new Set([...pieces].map((p) => p.dataset.heroPiece))];
  for (const piece of pieces) {
    const source = sources.get(piece.dataset.heroPiece ?? "")?.[0];
    const delay = order.indexOf(piece.dataset.heroPiece) * STAGGER_MS;
    if (!source) {
      piece.animate(
        [
          { opacity: 0, transform: "scale(0.6)" },
          { opacity: 1, transform: "none" },
        ],
        {
          delay: delay + 200,
          duration: 400,
          easing: FLY_EASING,
          fill: "backwards",
        },
      );
      continue;
    }
    const name = piece.dataset.heroPiece ?? "";
    const own = piece.getBoundingClientRect();
    const to = boxOf(root, name, piece);
    const from = boxOf(before, name, source);
    // Rects are on-screen px; the piece moves in its own layout px, which a
    // scaled picture or the window's zoom make different.
    const perScreenPx = piece.offsetWidth / own.width;
    const dx = (from.x + from.width / 2 - (to.x + to.width / 2)) * perScreenPx;
    const dy =
      (from.y + from.height / 2 - (to.y + to.height / 2)) * perScreenPx;
    const scale = from.width / to.width;
    const origin = `${String((to.x + to.width / 2 - own.x) * perScreenPx)}px ${String((to.y + to.height / 2 - own.y) * perScreenPx)}px`;
    const turn =
      Number(source.dataset.rotate ?? 0) - Number(piece.dataset.rotate ?? 0);
    piece.animate(
      [
        {
          transform: `translate(${String(dx)}px, ${String(dy)}px) rotate(${String(turn)}deg) scale(${String(scale)})`,
          transformOrigin: origin,
        },
        { transform: "none", transformOrigin: origin },
      ],
      { delay, duration: FLY_MS, easing: FLY_EASING, fill: "backwards" },
    );
  }
  for (const [name, list] of sources) {
    if (root.querySelector(`[data-hero-piece="${name}"]`)) {
      for (const source of list) {
        source.style.visibility = "hidden";
      }
    }
  }
}

/** Where a piece's shape is on screen: its marked box, or the piece itself. */
function boxOf(root: HTMLElement, name: string, piece: HTMLElement): DOMRect {
  return (
    root.querySelector(`[data-hero-box="${name}"]`) ?? piece
  ).getBoundingClientRect();
}
