import { act, renderHook } from "@testing-library/react";
import ms from "ms";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useRetryWhenOnline } from "./use-retry-when-online";

const network = vi.hoisted(() => ({
  status: "offline" as "instrument-unreachable" | "offline" | "online",
}));
vi.mock("@/client/hooks/use-network-status", () => ({
  useNetworkStatus: () => ({ status: network.status }),
}));

const ago = (duration: number) => new Date(Date.now() - duration);

interface Props {
  isRetryable: boolean;
  isRunning: boolean;
  run: () => void;
}

function renderRetry({
  failedAt = ago(ms("5 seconds")),
  isConnectionFailure = true,
  isRetryable = true,
  isRunning = false,
}: {
  failedAt?: Date;
  isConnectionFailure?: boolean;
  isRetryable?: boolean;
  isRunning?: boolean;
} = {}) {
  const run = vi.fn();
  const view = renderHook(
    (props: Props) =>
      useRetryWhenOnline({ failedAt, isConnectionFailure, ...props }),
    { initialProps: { isRetryable, isRunning, run } },
  );
  return { run, ...view };
}

beforeEach(() => {
  network.status = "offline";
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("useRetryWhenOnline", () => {
  it("waits while offline, then runs a stopped turn once on coming back", () => {
    const { rerender, result, run } = renderRetry();
    expect(result.current).toBe("offline");
    expect(run).not.toHaveBeenCalled();

    network.status = "online";
    rerender({ isRetryable: true, isRunning: false, run });
    expect(result.current).toBe("trying-again");
    expect(run).toHaveBeenCalledOnce();

    rerender({ isRetryable: true, isRunning: true, run });
    rerender({ isRetryable: true, isRunning: false, run });
    expect(run).toHaveBeenCalledOnce();
  });

  it("stays out of the way once the reply takes over", () => {
    const { rerender, result, run } = renderRetry();
    network.status = "online";
    rerender({ isRetryable: true, isRunning: true, run });
    act(() => {
      vi.advanceTimersByTime(ms("1 minute"));
    });
    expect(result.current).toBe("trying-again");

    rerender({ isRetryable: false, isRunning: true, run });
    expect(result.current).toBeUndefined();
  });

  it("hands back to the card when the run it asked for never starts", () => {
    const { rerender, result, run } = renderRetry();
    network.status = "online";
    rerender({ isRetryable: true, isRunning: false, run });
    act(() => {
      vi.advanceTimersByTime(ms("3 seconds"));
    });
    expect(result.current).toBeUndefined();
  });

  it("covers the attempts still under way, which go on by themselves", () => {
    const { rerender, result, run } = renderRetry({ isRunning: true });
    expect(result.current).toBe("offline");

    network.status = "online";
    rerender({ isRetryable: true, isRunning: true, run });
    expect(result.current).toBe("trying-again");
    expect(run).not.toHaveBeenCalled();
  });

  it("doesn't run again because a parent handed it a new function", () => {
    const { rerender, run } = renderRetry();
    rerender({ isRetryable: true, isRunning: false, run: vi.fn() });
    network.status = "online";
    const latest = vi.fn();
    rerender({ isRetryable: true, isRunning: false, run: latest });
    rerender({ isRetryable: true, isRunning: false, run: vi.fn() });
    expect(run).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledOnce();
  });

  it("runs the turn when only Instrument's servers are still down", () => {
    const { rerender, run } = renderRetry();
    network.status = "instrument-unreachable";
    rerender({ isRetryable: true, isRunning: false, run });
    expect(run).toHaveBeenCalledOnce();
  });

  it("leaves alone a failure from before the computer went offline", () => {
    network.status = "online";
    const { rerender, result, run } = renderRetry({
      failedAt: ago(ms("1 hour")),
    });
    network.status = "offline";
    rerender({ isRetryable: true, isRunning: false, run });
    expect(result.current).toBeUndefined();

    network.status = "online";
    rerender({ isRetryable: true, isRunning: false, run });
    expect(run).not.toHaveBeenCalled();
  });

  it("leaves alone a provider's own problem that arrived while online", () => {
    network.status = "online";
    const { rerender, result, run } = renderRetry({
      isConnectionFailure: false,
    });
    network.status = "offline";
    rerender({ isRetryable: true, isRunning: false, run });
    expect(result.current).toBeUndefined();

    network.status = "online";
    rerender({ isRetryable: true, isRunning: false, run });
    expect(run).not.toHaveBeenCalled();
  });

  it("waits for a failed connection that arrived just before the computer was seen offline", () => {
    network.status = "online";
    const { rerender, result, run } = renderRetry();
    network.status = "offline";
    rerender({ isRetryable: true, isRunning: false, run });
    expect(result.current).toBe("offline");
  });

  it("waits for any failure that arrives while offline, whatever it says", () => {
    const { result } = renderRetry({ isConnectionFailure: false });
    expect(result.current).toBe("offline");
  });

  it("drops the promise and the run when the failure stops counting, as a Stop makes it", () => {
    const { rerender, result, run } = renderRetry();
    expect(result.current).toBe("offline");
    rerender({ isRetryable: false, isRunning: false, run });
    expect(result.current).toBeUndefined();

    network.status = "online";
    rerender({ isRetryable: false, isRunning: false, run });
    expect(run).not.toHaveBeenCalled();
  });

  it("waits for a failure that arrives once the computer is already offline", () => {
    const { rerender, result, run } = renderRetry({ isRetryable: false });
    expect(result.current).toBeUndefined();
    rerender({ isRetryable: true, isRunning: false, run });
    expect(result.current).toBe("offline");
  });

  it("does nothing while online", () => {
    network.status = "online";
    const { result, run } = renderRetry();
    expect(result.current).toBeUndefined();
    expect(run).not.toHaveBeenCalled();
  });
});
