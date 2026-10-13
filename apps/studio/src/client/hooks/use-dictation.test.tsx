import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type DictationPhase,
  sendDuringDictation,
  useDictation,
} from "./use-dictation";

const mocks = vi.hoisted(() => ({
  allowance: vi.fn(),
  hasToken: true,
  open: vi.fn(),
  openLogin: vi.fn(),
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
            queryFn: () => Promise.resolve({}),
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
  return {
    cancel: vi.fn(),
    elapsedMs: () => lengthMs,
    end: () => ended?.(),
    level: () => 0,
    onEnded: (callback: () => void) => {
      ended = callback;
    },
    stop: vi.fn(() => Promise.resolve(new Blob(["take"]))),
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
  return { ...hook, onText };
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
    const { result } = setup();
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
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
