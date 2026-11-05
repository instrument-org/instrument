import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LOCAL_RPC_DEFAULTS } from "../lib/local-rpc-defaults";
import { useInstrumentWay } from "./use-instrument-way";

const read = vi.hoisted(() => vi.fn<() => Promise<unknown>>());
const OFFER_KEY = vi.hoisted(() => ["offer"]);

// The offer's real options (`rpc/client.ts`): a test of when the wait ends has
// to see that it ends ahead of the retries, and how it reads offline.
vi.mock("@/client/rpc/client", () => ({
  rpcClient: {
    billing: {
      offer: {
        queryOptions: () => ({
          networkMode: "online",
          queryFn: read,
          queryKey: OFFER_KEY,
          retry: 3,
          retryDelay: 1,
        }),
      },
    },
  },
}));

const TRIAL = { plans: [], trial: { cardRequired: false, days: 7 } };

const appClient = () => new QueryClient({ defaultOptions: LOCAL_RPC_DEFAULTS });

function renderWay({
  client = appClient(),
  enabled,
}: { client?: QueryClient; enabled?: boolean } = {}) {
  return renderHook(() => useInstrumentWay({ enabled }), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
}

afterEach(() => {
  read.mockReset();
  onlineManager.setOnline(true);
});

describe("useInstrumentWay", () => {
  it("waits while the offer is on its way, then draws the server's words", async () => {
    let answer: (offer: unknown) => void = () => {};
    read.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const { result } = renderWay();
    expect(result.current.isWaiting).toBe(true);
    expect(result.current.title).not.toBe("Instrument");

    answer(TRIAL);
    await waitFor(() => {
      expect(result.current.title).toBe("Try Instrument free");
    });
    expect(result.current).toMatchObject({
      action: "Start free trial",
      isTrial: true,
      isWaiting: false,
      line: "Sign in with Google for 7 days free. No card needed.",
      trialDays: 7,
    });
  });

  it("stops waiting at the first failed attempt, and takes the answer a retry brings", async () => {
    let answer: (offer: unknown) => void = () => {};
    read.mockRejectedValueOnce(new Error("refused")).mockReturnValueOnce(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const { result } = renderWay();
    await waitFor(() => {
      expect(result.current.isWaiting).toBe(false);
    });
    expect(result.current.title).toBe("Instrument");
    expect(result.current.trialDays).toBeUndefined();

    await waitFor(() => {
      expect(read).toHaveBeenCalledTimes(2);
    });
    answer(TRIAL);
    await waitFor(() => {
      expect(result.current.title).toBe("Try Instrument free");
    });
  });

  it("waits again when opened after the offer failed, so a server back since never shows the wrong words", async () => {
    read.mockRejectedValue(new Error("refused"));
    const client = appClient();
    const first = renderWay({ client });
    await waitFor(() => {
      expect(client.getQueryState(OFFER_KEY)?.status).toBe("error");
    });
    first.unmount();

    let answer: (offer: unknown) => void = () => {};
    read.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const { result } = renderWay({ client });
    expect(result.current.isWaiting).toBe(true);

    answer(TRIAL);
    await waitFor(() => {
      expect(result.current.title).toBe("Try Instrument free");
    });
  });

  it("draws a cached answer at once, while it asks again", async () => {
    read.mockReturnValue(new Promise(() => {}));
    const client = appClient();
    client.setQueryData(OFFER_KEY, TRIAL);
    const { result } = renderWay({ client });
    expect(result.current.isWaiting).toBe(false);
    expect(result.current.title).toBe("Try Instrument free");
    await waitFor(() => {
      expect(read).toHaveBeenCalledOnce();
    });
  });

  it("doesn't wait on an offer it can't ask for while offline, and asks once back online", async () => {
    onlineManager.setOnline(false);
    read.mockResolvedValue(TRIAL);
    const { result } = renderWay();
    expect(read).not.toHaveBeenCalled();
    expect(result.current.isWaiting).toBe(false);
    expect(result.current.title).toBe("Instrument");

    onlineManager.setOnline(true);
    await waitFor(() => {
      expect(result.current.title).toBe("Try Instrument free");
    });
  });

  it("asks nothing and doesn't wait while it isn't enabled", () => {
    const { result } = renderWay({ enabled: false });
    expect(read).not.toHaveBeenCalled();
    expect(result.current.isWaiting).toBe(false);
  });
});
