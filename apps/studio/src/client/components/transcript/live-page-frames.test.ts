import { describe, expect, it } from "vitest";

import {
  type LiveFrames,
  liveFrames,
  type LiveFramesEvent,
  NO_FRAMES,
} from "./live-page-frames";

const from = (state: LiveFrames, ...events: LiveFramesEvent[]): LiveFrames =>
  events.reduce(liveFrames, state);

const after = (...events: LiveFramesEvent[]): LiveFrames =>
  from(NO_FRAMES, ...events);

/** What the card draws: each frame by what it shows, the one up marked. */
function drawn({ frames, retiring, shown }: LiveFrames) {
  return frames.map(({ file, key }) => {
    const what = file ? `file "${file.text}"` : "stream";
    const mark =
      key === shown ? " (up)" : retiring.includes(key) ? " (under)" : "";
    return `${key.toString()}: ${what}${mark}`;
  });
}

describe("a page's frames", () => {
  it("keeps the words up until the page fed from the call draws something", () => {
    const writing = after({ type: "stream" });
    expect(writing.shown).toBeUndefined();
    expect(drawn(liveFrames(writing, { key: 0, type: "shows" }))).toEqual([
      "0: stream (up)",
    ]);
  });

  it("hands off to the file only once it has loaded, the stream left under it a moment", () => {
    const written = after(
      { type: "stream" },
      { key: 0, type: "shows" },
      { text: "v1", type: "file" },
      { key: 0, type: "rest" },
    );
    expect(drawn(written)).toEqual(["0: stream (up)", '1: file "v1"']);
    const loaded = liveFrames(written, { key: 1, type: "loaded" });
    expect(drawn(loaded)).toEqual(["0: stream (under)", '1: file "v1" (up)']);
    expect(drawn(liveFrames(loaded, { type: "retired" }))).toEqual([
      '1: file "v1" (up)',
    ]);
  });

  it("hands off only once the stream's scroll has come to rest at the page's foot", () => {
    const loaded = after(
      { type: "stream" },
      { key: 0, type: "shows" },
      { text: "v1", type: "file" },
      { key: 1, type: "loaded" },
    );
    expect(drawn(loaded)).toEqual(["0: stream (up)", '1: file "v1"']);
    expect(drawn(liveFrames(loaded, { key: 0, type: "rest" }))).toEqual([
      "0: stream (under)",
      '1: file "v1" (up)',
    ]);
  });

  it("settles the file back to its top after taking over from the stream, and holds a newer version until it has", () => {
    const tookOver = after(
      { type: "stream" },
      { key: 0, type: "shows" },
      { text: "v1", type: "file" },
      { key: 0, type: "rest" },
      { key: 1, type: "loaded" },
      { type: "retired" },
    );
    expect(tookOver.settling).toBe(1);
    const waiting = from(
      tookOver,
      { text: "v2", type: "file" },
      { key: 2, type: "loaded" },
    );
    expect(drawn(waiting)).toEqual(['1: file "v1" (up)', '2: file "v2"']);
    const settled = liveFrames(waiting, { key: 1, type: "rest" });
    expect(settled.settling).toBeUndefined();
    expect(drawn(settled)).toEqual([
      '1: file "v1" (under)',
      '2: file "v2" (up)',
    ]);
  });

  it("settles nothing when one version of the file takes over from another", () => {
    const edited = after(
      { text: "v1", type: "file" },
      { key: 0, type: "loaded" },
      { type: "retired" },
      { text: "v2", type: "file" },
      { key: 1, type: "loaded" },
    );
    expect(drawn(edited)).toEqual([
      '0: file "v1" (under)',
      '1: file "v2" (up)',
    ]);
    expect(edited.settling).toBeUndefined();
    expect(edited.moving).toEqual([]);
  });

  it("draws a later write again in place, the same way", () => {
    const rewritten = after(
      { text: "v1", type: "file" },
      { key: 0, type: "loaded" },
      { type: "retired" },
      // A rewrite of the page up feeds no frame of its own.
      { type: "stream" },
      { text: "v2", type: "file" },
    );
    expect(drawn(rewritten)).toEqual(['0: file "v1" (up)', '1: file "v2"']);
    expect(
      drawn(
        liveFrames(liveFrames(rewritten, { key: 1, type: "loaded" }), {
          type: "retired",
        }),
      ),
    ).toEqual(['1: file "v2" (up)']);
  });

  it("drops a version still loading for a newer one, and never shows it", () => {
    const state = after(
      { text: "v1", type: "file" },
      { key: 0, type: "loaded" },
      { type: "retired" },
      { text: "v2", type: "file" },
      { text: "v3", type: "file" },
      { key: 1, type: "loaded" },
    );
    expect(drawn(state)).toEqual(['0: file "v1" (up)', '2: file "v3"']);
  });

  it("loads nothing for a write that left the file as it was", () => {
    const state = after(
      { text: "v1", type: "file" },
      { key: 0, type: "loaded" },
    );
    expect(liveFrames(state, { text: "v1", type: "file" })).toBe(state);
  });

  it("shows the file straight away when the call's page never drew anything", () => {
    const state = after(
      { type: "stream" },
      { text: "v1", type: "file" },
      { key: 1, type: "loaded" },
    );
    expect(drawn(state)).toEqual(["0: stream (under)", '1: file "v1" (up)']);
  });
});
