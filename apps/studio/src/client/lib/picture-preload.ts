/** How many pictures stay loaded ahead: either side of the file shown, and the two before those. */
const KEPT = 4;

/**
 * The pictures loaded ahead, oldest first. Held, since an image nothing
 * refers to may lose its decoded pixels before a viewer asks for them.
 */
const kept = new Map<string, HTMLImageElement>();

/**
 * Loads and decodes a picture a viewer is likely to show next, so showing it
 * is a paint rather than a read from disk and a decode. `url` is the address
 * the viewer will ask for, version and all, since the browser reuses what it
 * loaded by address alone.
 */
export function preloadPicture(url: string) {
  const known = kept.get(url);
  if (known) {
    kept.delete(url);
    kept.set(url, known);
    return;
  }
  const image = new Image();
  image.src = url;
  image.decode().catch(() => undefined);
  kept.set(url, image);
  for (const oldest of kept.keys()) {
    if (kept.size <= KEPT) {
      break;
    }
    kept.delete(oldest);
  }
}
