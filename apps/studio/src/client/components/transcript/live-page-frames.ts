/**
 * The frames a card draws a page in, and which one is up. A page being
 * written whole draws in a frame fed as its source arrives; once the file is
 * on disk, and after every later write of it, the file draws in a new frame
 * under the one up, which takes its place only once it has loaded and the one
 * up has come to rest, so the card never shows a page loading or a scroll
 * cut short. The one it replaces stays a moment longer beneath it, so the
 * swap leaves no gap for a frame not yet painted.
 */

interface LiveFrame {
  /** The file it draws, or nothing for the frame fed from the call. */
  file?: { text: string };
  /** It has loaded its whole page and drawn it. */
  isLoaded?: boolean;
  key: number;
}

export interface LiveFrames {
  /** In the order they were made, which is their order in the card. */
  frames: LiveFrame[];
  /**
   * Frames whose scroll is on the move, which nothing replaces until they
   * rest: the one fed from the call, following the page's foot until the
   * page is whole, and one settling back.
   */
  moving: number[];
  nextKey: number;
  /** Frames left under the one up until the swap has painted. */
  retiring: number[];
  /**
   * The file's frame that took over from the call's, at the call's scroll,
   * which goes back to its top once the swap has painted.
   */
  settling?: number;
  /** The frame up, once one has something to show. */
  shown?: number;
}

export type LiveFramesEvent =
  /** The file at a new version, read. */
  | { text: string; type: "file" }
  /** A frame has loaded its whole page and drawn it. */
  | { key: number; type: "loaded" }
  /** A frame's scroll has stopped. */
  | { key: number; type: "rest" }
  /** The swap has painted. */
  | { type: "retired" }
  /** A frame fed from the call drew enough to show. */
  | { key: number; type: "shows" }
  /** A call started writing the page whole. */
  | { type: "stream" };

export const NO_FRAMES: LiveFrames = {
  frames: [],
  moving: [],
  nextKey: 0,
  retiring: [],
};

export function liveFrames(
  state: LiveFrames,
  event: LiveFramesEvent,
): LiveFrames {
  switch (event.type) {
    case "stream": {
      // Only the page's first drawing is fed from the call; a page already
      // up stays until the write lands and draws again in place.
      return state.frames.length > 0
        ? state
        : {
            ...state,
            frames: [{ key: state.nextKey }],
            moving: [...state.moving, state.nextKey],
            nextKey: state.nextKey + 1,
          };
    }
    case "file": {
      const newest = state.frames.findLast((frame) => frame.file);
      if (newest?.file?.text === event.text) {
        return state;
      }
      // A frame still loading an older version is never shown.
      const frames = state.frames.filter(
        (frame) =>
          !frame.file ||
          frame.key === state.shown ||
          state.retiring.includes(frame.key),
      );
      return {
        ...state,
        frames: [...frames, { file: { text: event.text }, key: state.nextKey }],
        nextKey: state.nextKey + 1,
      };
    }
    case "shows": {
      const frame = state.frames.find(({ key }) => key === event.key);
      return state.shown === undefined && frame && !frame.file
        ? { ...state, shown: event.key }
        : state;
    }
    case "loaded": {
      return swap({
        ...state,
        frames: state.frames.map((frame) =>
          frame.key === event.key ? { ...frame, isLoaded: true } : frame,
        ),
      });
    }
    case "rest": {
      return swap({
        ...state,
        moving: state.moving.filter((key) => key !== event.key),
        settling: state.settling === event.key ? undefined : state.settling,
      });
    }
    case "retired": {
      return state.retiring.length === 0
        ? state
        : {
            ...state,
            frames: state.frames.filter(
              ({ key }) => !state.retiring.includes(key),
            ),
            retiring: [],
          };
    }
  }
}

/**
 * The newest file's frame put up, once it has loaded and the frame up is
 * still. Taking over from the call's frame, it settles back afterwards.
 */
function swap(state: LiveFrames): LiveFrames {
  const newest = state.frames.findLast((frame) => frame.file);
  if (
    !newest?.isLoaded ||
    newest.key === state.shown ||
    (state.shown !== undefined && state.moving.includes(state.shown))
  ) {
    return state;
  }
  const isFromCall = state.frames.some(
    (frame) => frame.key === state.shown && !frame.file,
  );
  return {
    ...state,
    moving: isFromCall ? [newest.key] : [],
    retiring: state.frames
      .filter(({ key }) => key !== newest.key)
      .map(({ key }) => key),
    settling: isFromCall ? newest.key : undefined,
    shown: newest.key,
  };
}
