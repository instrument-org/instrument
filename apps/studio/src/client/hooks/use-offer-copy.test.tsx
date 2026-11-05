import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { offerCopy } from "../lib/connect-copy";
import { LOCAL_RPC_DEFAULTS } from "../lib/local-rpc-defaults";
import { OFFER_SNAPSHOT_OPTIONS } from "../lib/billing-offer-snapshot";
import { useOfferCopy } from "./use-offer-copy";

const read = vi.hoisted(() => vi.fn<() => Promise<unknown>>());
const OFFER_KEY = vi.hoisted(() => ["offer"]);

// The offer's real options (`rpc/client.ts`): a test of what shows before the
// answer has to start from the snapshot and go through the retries.
vi.mock("@/client/rpc/client", async () => {
  const { OFFER_SNAPSHOT_OPTIONS: snapshotOptions } =
    await import("../lib/billing-offer-snapshot");
  return {
    rpcClient: {
      billing: {
        offer: {
          queryOptions: () => ({
            ...snapshotOptions,
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

const SNAPSHOT = OFFER_SNAPSHOT_OPTIONS.initialData;
const SNAPSHOT_COPY = offerCopy(SNAPSHOT);
const LONGER_TRIAL = {
  ...SNAPSHOT,
  trial: { cardRequired: true, days: 14 },
};
const NO_TRIAL = { ...SNAPSHOT, trial: null };

const appClient = () => new QueryClient({ defaultOptions: LOCAL_RPC_DEFAULTS });

function renderOfferCopy({
  client = appClient(),
  enabled,
}: { client?: QueryClient; enabled?: boolean } = {}) {
  return renderHook(() => useOfferCopy({ enabled }), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
}

afterEach(() => {
  read.mockReset();
  onlineManager.setOnline(true);
});

describe("useOfferCopy", () => {
  it("has the snapshot's copy from the first paint, while it asks the server", async () => {
    read.mockReturnValue(new Promise(() => {}));
    const { result } = renderOfferCopy();
    expect(result.current.title).toBe(SNAPSHOT_COPY.title);
    expect(result.current.line).toBe(SNAPSHOT_COPY.line);
    await waitFor(() => {
      expect(read).toHaveBeenCalledOnce();
    });
  });

  it("changes nothing when the server says what the snapshot says", async () => {
    read.mockResolvedValue(structuredClone(SNAPSHOT));
    const client = appClient();
    let renders = 0;
    renderHook(
      () => {
        renders += 1;
        return useOfferCopy();
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
    expect(client.getQueryData(OFFER_KEY)).toBe(SNAPSHOT);
    expect(renders).toBe(1);
  });

  it("takes the server's copy when it differs", async () => {
    read.mockResolvedValue(LONGER_TRIAL);
    const { result } = renderOfferCopy();
    await waitFor(() => {
      expect(result.current.trialDays).toBe(14);
    });
    expect(result.current.line).toBe("Sign in with Google for 14 days free.");
  });

  it("takes the plain copy when the server offers no trial", async () => {
    read.mockResolvedValue(NO_TRIAL);
    const { result } = renderOfferCopy();
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

  it("keeps the snapshot's copy when the server can't be reached, and takes a later answer", async () => {
    read.mockRejectedValue(new Error("refused"));
    const client = appClient();
    const first = renderOfferCopy({ client });
    await waitFor(() => {
      expect(client.getQueryState(OFFER_KEY)?.status).toBe("error");
    });
    expect(first.result.current.title).toBe(SNAPSHOT_COPY.title);
    first.unmount();

    read.mockResolvedValue(NO_TRIAL);
    const { result } = renderOfferCopy({ client });
    expect(result.current.title).toBe(SNAPSHOT_COPY.title);
    await waitFor(() => {
      expect(result.current.isTrial).toBe(false);
    });
  });

  it("keeps a server's answer for the next reader rather than going back to the snapshot", async () => {
    read.mockResolvedValue(LONGER_TRIAL);
    const client = appClient();
    const first = renderOfferCopy({ client });
    await waitFor(() => {
      expect(first.result.current.trialDays).toBe(14);
    });
    first.unmount();

    read.mockReturnValue(new Promise(() => {}));
    const { result } = renderOfferCopy({ client });
    expect(result.current.trialDays).toBe(14);
    await waitFor(() => {
      expect(read).toHaveBeenCalledTimes(2);
    });
  });

  it("has the snapshot's copy offline, and asks once back online", async () => {
    onlineManager.setOnline(false);
    read.mockResolvedValue(NO_TRIAL);
    const { result } = renderOfferCopy();
    expect(read).not.toHaveBeenCalled();
    expect(result.current.title).toBe(SNAPSHOT_COPY.title);

    onlineManager.setOnline(true);
    await waitFor(() => {
      expect(result.current.isTrial).toBe(false);
    });
  });

  it("asks nothing while it isn't enabled", () => {
    const { result } = renderOfferCopy({ enabled: false });
    expect(read).not.toHaveBeenCalled();
    expect(result.current.title).toBe(SNAPSHOT_COPY.title);
  });
});
