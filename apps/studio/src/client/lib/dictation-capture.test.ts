import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MicCapture, MicrophoneError } from "./dictation-capture";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A MediaRecorder that writes one chunk per stop, delivered after a tick like the real one. */
class FakeRecorder extends EventTarget {
  static instances: FakeRecorder[] = [];
  static failToStart = false;
  static isTypeSupported = () => true;
  state: "inactive" | "recording" = "inactive";
  readonly mimeType = "audio/webm;codecs=opus";

  constructor(
    _stream: unknown,
    readonly options: MediaRecorderOptions,
  ) {
    super();
    FakeRecorder.instances.push(this);
  }

  start() {
    if (FakeRecorder.failToStart) {
      throw new DOMException("no", "NotSupportedError");
    }
    this.state = "recording";
    setTimeout(() => this.dispatchEvent(new Event("start")), 0);
  }

  stop() {
    this.endByItself();
  }

  /** What a recorder does when its track ends: inactive at once, the last chunk and `stop` a moment later. */
  endByItself() {
    this.state = "inactive";
    setTimeout(() => {
      const chunk = new Event("dataavailable");
      Object.assign(chunk, { data: new Blob(["last"]) });
      this.dispatchEvent(chunk);
      this.dispatchEvent(new Event("stop"));
    }, 0);
  }
}

class FakeContext {
  static instances: FakeContext[] = [];
  closed = false;
  constructor() {
    FakeContext.instances.push(this);
  }
  close() {
    this.closed = true;
    return Promise.resolve();
  }
  createAnalyser() {
    return { fftSize: 0, getFloatTimeDomainData: () => undefined };
  }
  createMediaStreamSource() {
    return { connect: () => undefined };
  }
}

const track = { addEventListener: vi.fn(), stop: vi.fn() };

beforeEach(() => {
  FakeRecorder.instances = [];
  FakeRecorder.failToStart = false;
  FakeContext.instances = [];
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  vi.stubGlobal("AudioContext", FakeContext);
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: () =>
        Promise.resolve({
          getAudioTracks: () => [track],
          getTracks: () => [track],
        }),
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MicCapture", () => {
  it("records at the bitrate the API sizes uploads by", async () => {
    await MicCapture.open();
    expect(FakeRecorder.instances[0]?.options.audioBitsPerSecond).toBe(32_000);
  });
});
