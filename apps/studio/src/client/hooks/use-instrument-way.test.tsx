import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { instrumentWayCopy } from "../lib/connect-copy";
import { LOCAL_RPC_DEFAULTS } from "../lib/local-rpc-defaults";
import { OFFER_FROM_BUILD } from "../lib/offer-from-build";
import { useInstrumentWay } from "./use-instrument-way";

const read = vi.hoisted(() => vi.fn<() => Promise<unknown>>());
const OFFER_KEY = vi.hoisted(() => ["offer"]);

// The offer's real options (`rpc/client.ts`): a test of what shows before the
// answer has to start from the build's copy and go through the retries.
vi.mock("@/client/rpc/client", async () => {
  const { OFFER_FROM_BUILD: fromBuild } =
    await import("../lib/offer-from-build");
  return {
    rpcClient: {
      billing: {
        offer: {
          queryOptions: () => ({
            ...fromBuild,
            gcTime: Number.POSITIVE_INFINITY,
            networkMode: "online",
            queryFn: read,
            queryKey: OFFER_KEY,
            retry: 3,
            retryDelay: 1,
          }),
        },
      },
    },
  };
});

const FROM_BUILD = OFFER_FROM_BUILD.initialData;
const BUILD_WORDS = instrumentWayCopy(FROM_BUILD);
const FORTNIGHT = {
  ...FROM_BUILD,
  trial: { cardRequired: true, days: 14 },
};
const NO_TRIAL = { ...FROM_BUILD, trial: null };

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
  it("has the build's words from the first paint, while it asks the server", async () => {
    read.mockReturnValue(new Promise(() => {}));
    const { result } = renderWay();
    expect(result.current.title).toBe(BUILD_WORDS.title);
    expect(result.current.line).toBe(BUILD_WORDS.line);
    await waitFor(() => {
      expect(read).toHaveBeenCalledOnce();
    });
  });

  it("changes nothing when the server says what the build says", async () => {
    read.mockResolvedValue(structuredClone(FROM_BUILD));
    const client = appClient();
    let renders = 0;
    renderHook(
      () => {
        renders += 1;
        return useInstrumentWay();
      },
      {
        wrapper: ({ children }: { children: ReactNode }) => (
          <QueryClientProvider client={client}>{children}</QueryClientProvider>
        ),
      },
    );
    await waitFor(() => {
      expect(client.getQueryState(OFFER_KEY)?.dataUpdatedAt).toBeGreaterThan(0);
    });
    expect(client.getQueryData(OFFER_KEY)).toBe(FROM_BUILD);
    expect(renders).toBe(1);
  });

  it("takes the server's words when they differ", async () => {
    read.mockResolvedValue(FORTNIGHT);
    const { result } = renderWay();
    await waitFor(() => {
      expect(result.current.trialDays).toBe(14);
    });
    expect(result.current.line).toBe("Sign in with Google for 14 days free.");
  });

  it("takes the plain words when the server offers no trial", async () => {
    read.mockResolvedValue(NO_TRIAL);
    const { result } = renderWay();
    await waitFor(() => {
      expect(result.current.isTrial).toBe(false);
    });
    expect(result.current).toMatchObject({
      action: "Log in",
      line: "Sign in with Google and choose a plan.",
      title: "Instrument",
    });
    expect(result.current.trialDays).toBeUndefined();
  });

  it("keeps the build's words when the server can't be reached, and takes a later answer", async () => {
    read.mockRejectedValue(new Error("refused"));
    const client = appClient();
    const first = renderWay({ client });
    await waitFor(() => {
      expect(client.getQueryState(OFFER_KEY)?.status).toBe("error");
    });
    expect(first.result.current.title).toBe(BUILD_WORDS.title);
    first.unmount();

    read.mockResolvedValue(NO_TRIAL);
    const { result } = renderWay({ client });
    expect(result.current.title).toBe(BUILD_WORDS.title);
    await waitFor(() => {
      expect(result.current.isTrial).toBe(false);
    });
  });

  it("keeps a server's answer for the next reader rather than going back to the build's", async () => {
    read.mockResolvedValue(FORTNIGHT);
    const client = appClient();
    const first = renderWay({ client });
    await waitFor(() => {
      expect(first.result.current.trialDays).toBe(14);
    });
    first.unmount();

    read.mockReturnValue(new Promise(() => {}));
    const { result } = renderWay({ client });
    expect(result.current.trialDays).toBe(14);
    await waitFor(() => {
      expect(read).toHaveBeenCalledTimes(2);
    });
  });

  it("has the build's words offline, and asks once back online", async () => {
    onlineManager.setOnline(false);
    read.mockResolvedValue(NO_TRIAL);
    const { result } = renderWay();
    expect(read).not.toHaveBeenCalled();
    expect(result.current.title).toBe(BUILD_WORDS.title);

    onlineManager.setOnline(true);
    await waitFor(() => {
      expect(result.current.isTrial).toBe(false);
    });
  });

  it("asks nothing while it isn't enabled", () => {
    const { result } = renderWay({ enabled: false });
    expect(read).not.toHaveBeenCalled();
    expect(result.current.title).toBe(BUILD_WORDS.title);
  });
});
