import type { NativeImage } from "electron";

import { EventEmitter } from "node:events";
import { noop } from "radashi";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  type CapturedContents,
  captureFrame,
  EmptyFrameError,
  FrameNotDrawnError,
} from "./capture-frame";

function image(empty = false) {
  return { isEmpty: () => empty } as unknown as NativeImage;
}

/** A contents whose capturePage answers as `capture` says, and whose paints are emitted by hand. */
function contents({
  capture = vi.fn().mockResolvedValue(image()),
  hostCapture,
  offscreen = false,
}: {
  capture?: ReturnType<typeof vi.fn>;
  hostCapture?: ReturnType<typeof vi.fn>;
  offscreen?: boolean;
} = {}) {
  // Electron's WebContents is a Node EventEmitter.
  const events = new EventEmitter();
  const fake = Object.assign(events, {
    capturePage: capture,
    hostWebContents: hostCapture
      ? { capturePage: hostCapture, isDestroyed: () => false }
      : null,
    invalidate: vi.fn(),
    isOffscreen: () => offscreen,
  });
  return { capture, contents: fake as unknown as CapturedContents, events };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("captureFrame", () => {
  it("hands back the frame the contents draws", async () => {
    const frame = image();
    const { capture, contents: wc } = contents({
      capture: vi.fn().mockResolvedValue(frame),
    });
    await expect(captureFrame(wc, { deadlineMs: 1000 })).resolves.toBe(frame);
    expect(capture).toHaveBeenCalledWith();
  });

  it("takes part of the page when asked for a rect", async () => {
    const { capture, contents: wc } = contents();
    const rect = { height: 720, width: 1280, x: 0, y: 0 };
    await captureFrame(wc, { deadlineMs: 1000, rect });
    expect(capture).toHaveBeenCalledWith(rect);
  });

  it("asks again after a capture fails, until one gives a frame", async () => {
    const frame = image();
    const capture = vi
      .fn()
      .mockRejectedValueOnce(new Error("UnknownVizError"))
      .mockRejectedValueOnce(new Error("UnknownVizError"))
      .mockResolvedValue(frame);
    const { contents: wc } = contents({ capture });
    await expect(captureFrame(wc, { deadlineMs: 2000 })).resolves.toBe(frame);
    expect(capture).toHaveBeenCalledTimes(3);
  });

  it("gives up at the deadline on a capture that never answers", async () => {
    vi.useFakeTimers();
    const { contents: wc } = contents({
      capture: vi.fn().mockReturnValue(new Promise(noop)),
    });
    const failure = captureFrame(wc, { deadlineMs: 5000 }).catch(
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(5000);
    expect(await failure).toBeInstanceOf(FrameNotDrawnError);
  });

  it("names the last failure when every capture failed, and then stops asking", async () => {
    vi.useFakeTimers();
    const capture = vi.fn().mockRejectedValue(new Error("UnknownVizError"));
    const { contents: wc } = contents({ capture });
    const failure = captureFrame(wc, { deadlineMs: 500 }).catch(
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(500);
    const error = await failure;
    expect(error).toBeInstanceOf(FrameNotDrawnError);
    expect(String(error)).toContain("UnknownVizError");
    const asked = capture.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(capture).toHaveBeenCalledTimes(asked);
  });

  it("fails at once on an empty frame when told to", async () => {
    const capture = vi.fn().mockResolvedValue(image(true));
    const { contents: wc } = contents({ capture });
    await expect(
      captureFrame(wc, { deadlineMs: 5000, rejectEmpty: true }),
    ).rejects.toBeInstanceOf(EmptyFrameError);
    expect(capture).toHaveBeenCalledOnce();
  });

  it("hands an empty frame back when not told otherwise", async () => {
    const empty = image(true);
    const { contents: wc } = contents({
      capture: vi.fn().mockResolvedValue(empty),
    });
    await expect(captureFrame(wc, { deadlineMs: 1000 })).resolves.toBe(empty);
  });

  // A guest in a covered window has no frame until the window draws.
  it("makes the hosting window draw while it waits, when told to", async () => {
    const hostCapture = vi.fn().mockResolvedValue(image());
    const capture = vi
      .fn()
      .mockImplementation(() =>
        hostCapture.mock.calls.length > 0
          ? Promise.resolve(image())
          : Promise.reject(new Error("UnknownVizError")),
      );
    const { contents: wc } = contents({ capture, hostCapture });
    await captureFrame(wc, { deadlineMs: 2000, forceDraw: true });
    expect(hostCapture).toHaveBeenCalledWith(
      { height: 1, width: 1, x: 0, y: 0 },
      { stayHidden: true },
    );
  });

  it("takes an offscreen contents' next painted frame, skipping an empty one", async () => {
    const frame = image();
    const { capture, contents: wc, events } = contents({ offscreen: true });
    const shot = captureFrame(wc, { deadlineMs: 1000, rejectEmpty: true });
    events.emit("paint", {}, {}, image(true));
    events.emit("paint", {}, {}, frame);
    await expect(shot).resolves.toBe(frame);
    expect(capture).not.toHaveBeenCalled();
  });
});
