/** Every player on a page of the window, playing or not. */
export const players = new Set<HTMLMediaElement>();

/**
 * Plays or pauses the player inside `root`, for a key pressed outside it.
 * Says whether there was one, so a screen with none leaves the key alone.
 */
export function togglePlayerIn(root: Element) {
  for (const media of players) {
    if (root.contains(media)) {
      if (media.paused) {
        media.play().catch(() => undefined);
      } else {
        media.pause();
      }
      return true;
    }
  }
  return false;
}
