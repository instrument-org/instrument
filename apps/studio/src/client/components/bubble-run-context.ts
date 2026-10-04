import { createContext } from "react";

/**
 * The bubbles in the conversation that another bubble of the same speaker
 * follows in one run, by the id of the part each draws.
 *
 * Only the last bubble of a run wears the short corner at the bottom, on the
 * speaker's side, the way a text chat draws a tail on the last message of a
 * stack; these are the ones above it. A bubble drawn with no stream around it
 * ends its run, so the default is that none are followed.
 */
export const FollowedBubblesContext = createContext<ReadonlySet<string>>(
  new Set(),
);
