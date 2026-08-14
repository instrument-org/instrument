/**
 * The motion the app's two rails open and close on: the studio sidebar on the
 * left, the task pane on the right. Shared so the claim that they read as one
 * piece of motion is enforced rather than a comment on each of them.
 */
export const RAIL_SLIDE_TRANSITION = {
  damping: 42,
  stiffness: 520,
  type: "spring",
} as const;

export const RAIL_FADE_TRANSITION = {
  duration: 0.14,
  ease: "easeOut",
} as const;
