/**
 * What the keyboard does to the picture holding it. A picture can hold the
 * keyboard from its own pane, from its zoom menu, or from the Quick Look panel
 * it fills, which keeps the keyboard on the panel itself.
 */
export type PictureKeys = {
  canPan: () => boolean;
  pan: (dx: number, dy: number) => void;
  zoom: (chord: PictureChord) => void;
};

export type PictureChord = "zoomIn" | "zoomOut" | "zoomReset";

const HOLDER_SELECTOR = "[data-picture-keys]";

const keysOf = new WeakMap<Element, PictureKeys>();

/** Makes `element`, marked `data-picture-keys`, answer for a picture. */
export function setPictureKeys(element: Element, keys: PictureKeys) {
  keysOf.set(element, keys);
  return () => {
    keysOf.delete(element);
  };
}

export function pictureHoldingKeyboard(): null | PictureKeys {
  const place = document.activeElement;
  const holder =
    place?.closest(HOLDER_SELECTOR) ??
    (place?.getAttribute("role") === "dialog"
      ? place.querySelector(HOLDER_SELECTOR)
      : null);
  return (holder && keysOf.get(holder)) ?? null;
}

/**
 * Does what a zoom chord means to the picture holding the keyboard; false when
 * none is, and the chord means the window's own zoom.
 */
export function runPictureChord(chord: PictureChord) {
  const keys = pictureHoldingKeyboard();
  keys?.zoom(chord);
  return keys !== null;
}
