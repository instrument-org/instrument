import {
  onlineManager,
  QueryClient,
  QueryObserver,
} from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LOCAL_RPC_DEFAULTS } from "./local-rpc-defaults";

const client = () => new QueryClient({ defaultOptions: LOCAL_RPC_DEFAULTS });

afterEach(() => {
  onlineManager.setOnline(true);
});

describe("LOCAL_RPC_DEFAULTS", () => {
  it("answers a read while offline", { timeout: 1000 }, async () => {
    onlineManager.setOnline(false);
    await expect(
      client().fetchQuery({
        queryFn: () => "from this computer",
        queryKey: ["read"],
      }),
    ).resolves.toBe("from this computer");
  });

  it("runs a write while offline", { timeout: 1000 }, async () => {
    onlineManager.setOnline(false);
    const queryClient = client();
    await expect(
      queryClient
        .getMutationCache()
        .build(queryClient, { mutationFn: () => Promise.resolve("saved") })
        .execute(undefined),
    ).resolves.toBe("saved");
  });

  it("reads a stale query again on coming back online", async () => {
    const queryClient = client();
    queryClient.mount();
    const read = vi.fn(() => Promise.resolve("answer"));
    const observer = new QueryObserver(queryClient, {
      queryFn: read,
      queryKey: ["read"],
    });
    const stop = observer.subscribe(() => {});
    await vi.waitFor(() => {
      expect(read).toHaveBeenCalledOnce();
    });

    onlineManager.setOnline(false);
    onlineManager.setOnline(true);
    await vi.waitFor(() => {
      expect(read).toHaveBeenCalledTimes(2);
    });
    stop();
    queryClient.unmount();
  });
});
