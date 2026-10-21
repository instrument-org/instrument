import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type DictationStreamEvent } from "@/shared/dictation";

import {
  type DictationPhase,
  sendDuringDictation,
  useDictation,
} from "./use-dictation";

const mocks = vi.hoisted(() => ({
  allowance: vi.fn(),
  feed: vi.fn(),
  finish: vi.fn(),
  listen: vi.fn(),
  recording: vi.fn(),
  hasToken: true,
  open: vi.fn(),
  openLogin: vi.fn(),
  playCue: vi.fn(),
  preferences: {} as Record<string, unknown>,
  toast: { dismiss: vi.fn(), error: vi.fn(), info: vi.fn() },
  transcribe: vi.fn(),
}));

vi.mock(import("@/client/rpc/client"), () => ({
  // `as`: a stand-in for the slice of the generated client the hook calls.
  rpcClient: {
    auth: {
      live: {
        hasToken: {
          experimental_liveOptions: () => ({
            queryFn: () => Promise.resolve(mocks.hasToken),
            queryKey: ["hasToken"],
          }),
        },
      },
    },
    dictation: {
      allowance: { call: mocks.allowance },
      feed: { call: mocks.feed },
      finish: { call: mocks.finish },
      listen: { call: mocks.listen },
      recording: { call: mocks.recording },
      transcribe: { call: mocks.transcribe },
    },
    mac: {
      microphone: {
        openSettings: { call: vi.fn() },
        request: { call: vi.fn() },
        status: { call: () => Promise.resolve("granted") },
      },
    },
    preferences: {
      live: {
        get: {
          experimental_liveOptions: () => ({
            queryFn: () => Promise.resolve(mocks.preferences),
            queryKey: ["preferences"],
          }),
        },
      },
    },
  } as never,
}));
vi.mock(import("@/client/lib/toast"), () => ({
  // `as`: only the calls the hook makes.
  toast: mocks.toast as never,
}));
vi.mock(import("@/client/lib/dictation-sounds"), () => ({
  playDictationCue: mocks.playCue,
}));
vi.mock(import("@/client/atoms/login-modal"), () => ({
  openLogin: mocks.openLogin,
}));
vi.mock(import("@/client/lib/dictation-capture"), () => ({
  MicCapture: { open: mocks.open } as never,
  // `as`: the hook only checks `instanceof`.
  MicrophoneError: class extends Error {} as never,
}));

/** A toast call's options, which carry the action the test presses. */
function toastOptions(call: unknown[] | undefined) {
  // `as`: mock calls are untyped; these are the options the hook passes.
  return call?.[1] as { action: { label: string; onClick: () => void } };
}

/** A recording whose length and stop are the test's to decide. */
function fakeCapture(lengthMs = 3000) {
  let ended: (() => void) | undefined;
  let chunk: ((chunk: Blob) => void) | undefined;
  return {
    cancel: vi.fn(),
    /** Writes a chunk of the take, as the recorder does every quarter second. */
    chunk: (data = "audio") => chunk?.(new Blob([data])),
    elapsedMs: () => lengthMs,
    end: () => ended?.(),
    onChunk: (listener: (chunk: Blob) => void) => {
      chunk = listener;
    },
    onEnded: (callback: () => void) => {
      ended = callback;
    },
    stop: vi.fn(() => Promise.resolve(new Blob(["take"]))),
  };
}

/** A live stream whose events the test sends, one at a time. */
function fakeStream() {
  const queue: DictationStreamEvent[] = [];
  let wake: (() => void) | undefined;
  let closed = false;
  async function* events() {
    while (!closed || queue.length > 0) {
      const event = queue.shift();
      if (event) {
        yield event;
        continue;
      }
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
  }
  mocks.listen.mockResolvedValue(events());
  return {
    close: () => {
      closed = true;
      wake?.();
    },
    send: (event: DictationStreamEvent) => {
      queue.push(event);
      wake?.();
    },
  };
}

function setup({ finishOnUnmount = false } = {}) {
  const onText = vi.fn();
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(
    () => useDictation({ finishOnUnmount, onText, surface: "composer" }),
    { wrapper },
  );
  return { ...hook, client, onText };
}

async function startRecording(result: {
  current: ReturnType<typeof useDictation>;
}) {
  // Lets the signed-in query settle before the press reads it.
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
  act(() => {
    result.current.start();
  });
  await waitFor(() => {
    expect(result.current.phase.kind).toBe("recording");
  });
}

beforeEach(() => {
  mocks.hasToken = true;
  mocks.preferences = {};
  // No live stream unless a test opens one, so the take is uploaded at Stop.
  mocks.listen.mockImplementation(async function* () {
    yield { failure: { kind: "server" }, type: "unavailable" };
  });
  mocks.feed.mockResolvedValue(undefined);
  // Held open until the hook lets go, as the app's own call is.
  mocks.recording.mockImplementation(async function* (
    _input: unknown,
    { signal }: { signal: AbortSignal },
  ) {
    await new Promise((resolve) => {
      signal.addEventListener("abort", resolve, { once: true });
    });
    yield* [];
  });
  mocks.finish.mockResolvedValue(undefined);
  mocks.allowance.mockResolvedValue({ exhausted: false });
  mocks.transcribe.mockResolvedValue({
    durationSeconds: 3,
    ok: true,
    text: "Hello there.",
  });
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { enumerateDevices: () => Promise.resolve([]) },
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useDictation", () => {
  it("tells the app it is recording until Stop, so quitting can ask", async () => {
    mocks.open.mockResolvedValue(fakeCapture());
    const { result } = setup();
    await startRecording(result);
    const signal = (
      mocks.recording.mock.calls[0]?.[1] as { signal: AbortSignal } | undefined
    )?.signal;
    expect(signal?.aborted).toBe(false);

    act(() => {
      result.current.stop();
    });

    expect(signal?.aborted).toBe(true);
  });

  it("plays a sound as it starts listening and as it stops", async () => {
    mocks.open.mockResolvedValue(fakeCapture());
    const { result } = setup();
    await startRecording(result);
    act(() => {
      result.current.stop();
    });
    expect(mocks.playCue.mock.calls).toEqual([["start"], ["stop"]]);
  });

  it("plays no sounds when they are turned off", async () => {
    mocks.preferences = { dictationSounds: false };
    mocks.open.mockResolvedValue(fakeCapture());
    const { result } = setup();
    await startRecording(result);
    act(() => {
      result.current.stop();
    });
    expect(mocks.playCue).not.toHaveBeenCalled();
  });

  it("transcribes on Stop and hands over the words", async () => {
    const capture = fakeCapture();
    mocks.open.mockResolvedValue(capture);
    const { onText, result } = setup();
    await startRecording(result);

    act(() => {
      result.current.stop();
    });
    expect(result.current.phase).toEqual({
      kind: "transcribing",
      pressed: "stop",
    });
    await waitFor(() => {
      expect(onText).toHaveBeenCalledWith("Hello there.");
    });
    expect(result.current.phase.kind).toBe("idle");
    expect(mocks.transcribe).toHaveBeenCalledTimes(1);
  });

  it("sends after the words land when Send stopped it, and only then", async () => {
    mocks.open.mockResolvedValue(fakeCapture());
    const order: string[] = [];
    const { onText, result } = setup();
    onText.mockImplementation(() => order.push("words"));
    await startRecording(result);

    act(() => {
      result.current.stop({ onLanded: () => order.push("send") });
    });
    expect(result.current.phase).toEqual({
      kind: "transcribing",
      pressed: "send",
    });
    await waitFor(() => {
      expect(order).toEqual(["words", "send"]);
    });
  });

  it("does not send when nothing was heard", async () => {
    mocks.open.mockResolvedValue(fakeCapture());
    mocks.transcribe.mockResolvedValue({
      durationSeconds: 3,
      ok: true,
      text: "  ",
    });
    const onLanded = vi.fn();
    const { onText, result } = setup();
    await startRecording(result);

    act(() => {
      result.current.stop({ onLanded });
    });
    await waitFor(() => {
      expect(mocks.toast.info).toHaveBeenCalled();
    });
    expect(onText).not.toHaveBeenCalled();
    expect(onLanded).not.toHaveBeenCalled();
  });

  it("transcribes once when Stop and Send land together", async () => {
    mocks.open.mockResolvedValue(fakeCapture());
    const { result } = setup();
    await startRecording(result);

    act(() => {
      result.current.stop();
      result.current.stop({ onLanded: vi.fn() });
    });
    await waitFor(() => {
      expect(result.current.phase.kind).toBe("idle");
    });
    expect(mocks.transcribe).toHaveBeenCalledTimes(1);
  });

  it("throws the take away on Cancel", async () => {
    const capture = fakeCapture();
    mocks.open.mockResolvedValue(capture);
    const { onText, result } = setup();
    await startRecording(result);

    act(() => {
      result.current.cancel();
    });
    expect(result.current.phase.kind).toBe("idle");
    expect(capture.cancel).toHaveBeenCalled();
    expect(mocks.transcribe).not.toHaveBeenCalled();
    expect(onText).not.toHaveBeenCalled();
  });

  it("lets the mic go when Cancel comes while it is still opening", async () => {
    const capture = fakeCapture();
    let opened: (value: typeof capture) => void = () => undefined;
    mocks.open.mockReturnValue(
      new Promise((resolve) => {
        opened = resolve;
      }),
    );
    const { result } = setup();
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    act(() => {
      result.current.start();
    });
    await waitFor(() => {
      expect(mocks.open).toHaveBeenCalled();
    });

    act(() => {
      result.current.cancel();
    });
    await act(async () => {
      opened(capture);
      await Promise.resolve();
    });
    expect(capture.cancel).toHaveBeenCalled();
    expect(result.current.phase.kind).toBe("idle");
  });

  it("drops a take under a second without sending it", async () => {
    mocks.open.mockResolvedValue(fakeCapture(400));
    const { result } = setup();
    await startRecording(result);

    act(() => {
      result.current.stop();
    });
    await waitFor(() => {
      expect(mocks.toast.info).toHaveBeenCalledWith(
        "Didn't quite catch that",
        expect.anything(),
      );
    });
    expect(mocks.transcribe).not.toHaveBeenCalled();
  });

  it("keeps a take whose upload failed, and Try Again sends it", async () => {
    mocks.open.mockResolvedValue(fakeCapture());
    mocks.transcribe.mockResolvedValueOnce({
      failure: { kind: "connection" },
      ok: false,
    });
    const { onText, result } = setup();
    await startRecording(result);

    act(() => {
      result.current.stop();
    });
    await waitFor(() => {
      expect(mocks.toast.error).toHaveBeenCalled();
    });
    act(() => {
      toastOptions(mocks.toast.error.mock.calls[0]).action.onClick();
    });
    await waitFor(() => {
      expect(onText).toHaveBeenCalledWith("Hello there.");
    });
    const audio = (call: unknown[]) => (call[0] as { audio: Blob }).audio;
    expect(audio(mocks.transcribe.mock.calls[1] ?? [])).toBe(
      audio(mocks.transcribe.mock.calls[0] ?? []),
    );
  });

  it("still sends after Try Again when Send ended the take", async () => {
    mocks.open.mockResolvedValue(fakeCapture());
    mocks.transcribe.mockResolvedValueOnce({
      failure: { kind: "connection" },
      ok: false,
    });
    const sent = vi.fn();
    const { result } = setup();
    await startRecording(result);

    act(() => {
      result.current.stop({ onLanded: sent });
    });
    await waitFor(() => {
      expect(mocks.toast.error).toHaveBeenCalled();
    });
    expect(sent).not.toHaveBeenCalled();
    act(() => {
      toastOptions(mocks.toast.error.mock.calls[0]).action.onClick();
    });
    await waitFor(() => {
      expect(sent).toHaveBeenCalledTimes(1);
    });
  });

  it("opens no microphone for a start canceled while it was checking", async () => {
    let allow: (value: { exhausted: boolean }) => void = () => undefined;
    mocks.allowance.mockReturnValueOnce(
      new Promise((resolve) => {
        allow = resolve;
      }),
    );
    const { result } = setup();
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    act(() => {
      result.current.start();
    });
    act(() => {
      result.current.cancel();
    });
    await act(async () => {
      allow({ exhausted: false });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(mocks.open).not.toHaveBeenCalled();
    expect(result.current.phase.kind).toBe("idle");
  });

  it("keeps the take when the allowance runs out mid-day", async () => {
    mocks.open.mockResolvedValue(fakeCapture());
    mocks.transcribe.mockResolvedValueOnce({
      failure: {
        kind: "allowance-reached",
        remainingSeconds: 0,
        resetsAt: "2099-01-01T00:00:00.000Z",
      },
      ok: false,
    });
    const { result } = setup();
    await startRecording(result);

    act(() => {
      result.current.stop();
    });
    await waitFor(() => {
      expect(mocks.toast.info).toHaveBeenCalled();
    });
    expect(mocks.toast.info.mock.calls[0]?.[0]).toBe(
      "You've used today's dictation",
    );
    expect(toastOptions(mocks.toast.info.mock.calls[0]).action.label).toBe(
      "Try again",
    );
  });

  it("says the allowance is used up instead of recording", async () => {
    mocks.allowance.mockResolvedValue({
      exhausted: true,
      resetsAt: "2099-01-01T00:00:00.000Z",
    });
    const { result } = setup();
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    act(() => {
      result.current.start();
    });
    await waitFor(() => {
      expect(mocks.toast.info).toHaveBeenCalledWith(
        "You've used today's dictation",
        expect.anything(),
      );
    });
    expect(mocks.open).not.toHaveBeenCalled();
    expect(result.current.phase.kind).toBe("idle");
  });

  it("asks a signed-out person to log in instead of recording", async () => {
    mocks.hasToken = false;
    const { client, result } = setup();
    // The press reads whether someone is signed in, so that has to be known.
    await waitFor(() => {
      expect(client.getQueryData(["hasToken"])).toBe(false);
    });
    act(() => {
      result.current.start();
    });
    expect(mocks.openLogin).toHaveBeenCalledWith({
      instrumentOnly: true,
      reason: "dictation",
    });
    expect(mocks.open).not.toHaveBeenCalled();
  });

  it("finishes a take on unmount when its words have somewhere to go", async () => {
    mocks.open.mockResolvedValue(fakeCapture());
    const { onText, result, unmount } = setup({ finishOnUnmount: true });
    await startRecording(result);

    unmount();
    await waitFor(() => {
      expect(onText).toHaveBeenCalledWith("Hello there.");
    });
  });

  it("throws the take away on unmount otherwise", async () => {
    const capture = fakeCapture();
    mocks.open.mockResolvedValue(capture);
    const { result, unmount } = setup();
    await startRecording(result);

    unmount();
    expect(capture.cancel).toHaveBeenCalled();
    expect(mocks.transcribe).not.toHaveBeenCalled();
  });

  it("keeps what it heard when the mic goes away mid-take", async () => {
    const capture = fakeCapture();
    mocks.open.mockResolvedValue(capture);
    const { onText, result } = setup();
    await startRecording(result);

    act(() => {
      capture.end();
    });
    await waitFor(() => {
      expect(onText).toHaveBeenCalledWith("Hello there.");
    });
  });

  it("gives each box its own toast, so one never clears another's", async () => {
    mocks.open.mockResolvedValue(fakeCapture(400));
    const first = setup();
    const second = setup();
    for (const { result } of [first, second]) {
      await startRecording(result);
      act(() => {
        result.current.stop();
      });
    }
    await waitFor(() => {
      expect(mocks.toast.info).toHaveBeenCalledTimes(2);
    });
    const ids = mocks.toast.info.mock.calls.map(
      ([, options]) => (options as { id: string }).id,
    );
    expect(new Set(ids).size).toBe(2);
  });
});

describe("useDictation with a live stream", () => {
  /** Starts a take whose stream opens and has heard `words` settle. */
  async function startLive(words = ["Book a table", "for four."]) {
    const capture = fakeCapture();
    mocks.open.mockResolvedValue(capture);
    const stream = fakeStream();
    const hook = setup();
    await startRecording(hook.result);
    act(() => {
      capture.chunk("header");
      stream.send({ id: "s1", type: "open" });
    });
    await waitFor(() => {
      expect(hook.result.current.live?.status).toBe("live");
    });
    for (const text of words) {
      act(() => {
        stream.send({ final: false, text: text.slice(0, 4), type: "text" });
        stream.send({ final: true, text, type: "text" });
      });
    }
    await waitFor(() => {
      expect(hook.result.current.live?.settled).toBe(words.join(" "));
    });
    return { ...hook, capture, stream };
  }

  it("shows the words as they settle, and lands them at Stop without an upload", async () => {
    const { capture, onText, result, stream } = await startLive();
    act(() => {
      stream.send({ final: false, text: "at seven", type: "text" });
    });
    await waitFor(() => {
      expect(result.current.live).toEqual({
        interim: "at seven",
        settled: "Book a table for four.",
        status: "live",
      });
    });
    // What was recorded before the stream opened reaches it first.
    act(() => {
      capture.chunk("more");
    });
    await waitFor(() => {
      expect(mocks.feed).toHaveBeenCalledTimes(2);
    });

    act(() => {
      result.current.stop();
    });
    expect(result.current.phase).toEqual({
      kind: "transcribing",
      live: true,
      pressed: "stop",
    });
    await waitFor(() => {
      expect(mocks.finish).toHaveBeenCalledWith({ id: "s1" });
    });
    act(() => {
      stream.send({ final: true, text: "At seven.", type: "text" });
      stream.send({ complete: true, reason: "stopped", type: "end" });
      stream.close();
    });
    await waitFor(() => {
      expect(onText).toHaveBeenCalledWith("Book a table for four. At seven.");
    });
    expect(mocks.transcribe).not.toHaveBeenCalled();
    expect(result.current.phase.kind).toBe("idle");
    expect(result.current.live).toBeUndefined();
  });

  it("uploads the whole take when the stream missed some of it", async () => {
    const { onText, result, stream } = await startLive();

    act(() => {
      result.current.stop();
    });
    await waitFor(() => {
      expect(mocks.finish).toHaveBeenCalled();
    });
    act(() => {
      stream.send({ complete: false, reason: "stopped", type: "end" });
      stream.close();
    });

    await waitFor(() => {
      expect(onText).toHaveBeenCalledWith("Hello there.");
    });
    expect(mocks.transcribe).toHaveBeenCalledTimes(1);
  });

  it("keeps recording when the stream goes away, and uploads at Stop", async () => {
    const { onText, result, stream } = await startLive();

    act(() => {
      stream.send({ type: "lost" });
      stream.close();
    });
    await waitFor(() => {
      expect(result.current.live?.status).toBe("lost");
    });
    expect(result.current.phase.kind).toBe("recording");

    act(() => {
      result.current.stop();
    });
    await waitFor(() => {
      expect(onText).toHaveBeenCalledWith("Hello there.");
    });
    expect(mocks.finish).not.toHaveBeenCalled();
  });

  it("lands what was heard when the allowance runs out mid-take, and says so", async () => {
    const { onText, result, stream } = await startLive(["Book a table."]);

    act(() => {
      stream.send({
        complete: true,
        reason: "allowance",
        resetsAt: "2026-10-16T00:00:00.000Z",
        type: "end",
      });
      stream.close();
    });

    await waitFor(() => {
      expect(onText).toHaveBeenCalledWith("Book a table.");
    });
    expect(result.current.phase.kind).toBe("idle");
    expect(mocks.transcribe).not.toHaveBeenCalled();
    expect(mocks.toast.info.mock.calls.at(-1)?.[0]).toBe(
      "You've used today's dictation",
    );
  });

  it("throws the take away when the stream is refused for the allowance", async () => {
    const capture = fakeCapture();
    mocks.open.mockResolvedValue(capture);
    const stream = fakeStream();
    const { result } = setup();
    await startRecording(result);

    act(() => {
      stream.send({
        failure: { kind: "allowance-reached", resetsAt: undefined },
        type: "unavailable",
      });
      stream.close();
    });

    await waitFor(() => {
      expect(result.current.phase.kind).toBe("idle");
    });
    expect(capture.cancel).toHaveBeenCalled();
    expect(mocks.transcribe).not.toHaveBeenCalled();
  });
});

describe("sendDuringDictation", () => {
  it.each<[DictationPhase, ReturnType<typeof sendDuringDictation>]>([
    [{ kind: "idle" }, "send"],
    [{ kind: "recording" }, "stop-then-send"],
    [{ kind: "starting" }, "wait"],
    [{ kind: "transcribing", pressed: "stop" }, "wait"],
  ])("Enter or Send while %j does %s", (phase, action) => {
    expect(sendDuringDictation(phase)).toBe(action);
  });
});
