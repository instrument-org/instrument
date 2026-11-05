import { renderWithProviders } from "@/tests/render";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ActivitySection } from "./activity-section";

const { calls, data } = vi.hoisted(() => ({
  calls: new Map<string, (input: unknown) => unknown>(),
  data: new Map<string, unknown>(),
}));

/**
 * Every route as a query whose data is `data`'s entry for it, and as a call
 * or a mutation answered by `calls`' entry, so the section reads and asks
 * what each test sets.
 */
vi.mock("@/client/rpc/client", () => {
  const route = (path: string[]): unknown =>
    new Proxy(() => {}, {
      get: (_target, name: string) => {
        const key = path.join(".");
        switch (name) {
          case "call":
            return async (input: unknown) => calls.get(key)?.(input) ?? null;
          case "key":
          case "queryKey":
            return () => [key];
          case "mutationOptions":
            return (options: object = {}) => ({
              ...options,
              mutationFn: async (input: unknown) =>
                calls.get(key)?.(input) ?? null,
            });
          case "experimental_liveOptions":
          case "queryOptions":
            return ({ input }: { input?: unknown } = {}) => ({
              queryFn: () => data.get(key) ?? null,
              queryKey: [key, input],
            });
          default:
            return route([...path, name]);
        }
      },
    });
  return { rpcClient: route([]) };
});

beforeEach(() => {
  calls.clear();
  data.clear();
  data.set("preferences.live.get", { shareActionsWithChats: true });
  data.set("gateway.models.live.list", { models: [] });
  calls.set("actions.list", () => ({ actions: [], next: null, until: 0 }));
  calls.set("workspace.activity.list", () => []);
});

describe("ActivitySection", () => {
  it("turns off letting chats use the person's activity", async () => {
    const setShare = vi.fn(() => null);
    calls.set("preferences.setShareActionsWithChats", setShare);
    renderWithProviders(<ActivitySection />);
    const toggle = await screen.findByRole("switch", {
      name: /^Let chats use your activity/,
    });
    await waitFor(() => {
      expect(toggle.getAttribute("aria-checked")).toBe("true");
    });
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(setShare).toHaveBeenCalledWith({ enabled: false });
    });
  });

  it("clears what the person picks from the last hour, saying how much is there", async () => {
    const clear = vi.fn(() => null);
    calls.set("activity.clear", clear);
    data.set("activity.summary", { actions: 14, requests: 1 });
    renderWithProviders(<ActivitySection />);
    expect(await screen.findByText("No activity yet.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear activity…" }));
    expect(await screen.findByText("14 things")).toBeTruthy();
    expect(screen.getByText("1 request made on this computer")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "AI requests" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    await waitFor(() => {
      expect(clear).toHaveBeenCalledWith({
        actions: true,
        requests: true,
        since: expect.any(Number),
      });
    });
  });
});
