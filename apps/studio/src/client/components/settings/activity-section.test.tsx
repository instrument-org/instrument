import { renderWithProviders } from "@/tests/render";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { StoreId } from "@instrument-org/workspace/client";

import { ActivitySection } from "./activity-section";
import { TurnDetail } from "./activity-requests";

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
  it("turns off letting chats see the person's activity from the toolbar", async () => {
    const setShare = vi.fn(() => null);
    calls.set("preferences.setShareActionsWithChats", setShare);
    renderWithProviders(<ActivitySection />);
    const toggle = await screen.findByRole("switch", {
      name: "Chats can see this",
    });
    await waitFor(() => {
      expect(toggle.getAttribute("aria-checked")).toBe("true");
    });
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(setShare).toHaveBeenCalledWith({ enabled: false });
    });
  });

  it("says what a chat gets behind the switch's ⓘ", async () => {
    renderWithProviders(<ActivitySection />);
    fireEvent.click(await screen.findByRole("button", { name: "More info" }));
    expect(
      await screen.findByText(
        "Each message you send includes a short list of what you just did here, without names. A chat looks up a name when it needs one.",
      ),
    ).toBeTruthy();
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

  it("shows the message a turn answered and the activity sent with it", async () => {
    const sessionId = StoreId.newSessionId();
    const messageId = StoreId.newMessageId();
    const sent = new Date(2026, 10, 5, 14, 43);
    const metadata = {
      createdAt: sent,
      id: StoreId.newPartId(),
      messageId,
      sessionId,
    };
    data.set("workspace.message.list", [
      {
        id: messageId,
        metadata: { createdAt: sent, sessionId },
        parts: [
          { metadata, text: "Put those back where they were", type: "text" },
          {
            data: { rows: [{ count: 3, kind: "move", minutes: 2 }] },
            metadata,
            type: "data-actions",
          },
        ],
        role: "user",
      },
    ]);
    renderWithProviders(
      <TurnDetail
        onBack={() => {}}
        onOpen={() => {}}
        turn={{
          id: "req_1",
          requests: [
            {
              cacheReadTokens: null,
              cacheWriteTokens: null,
              chatId: "kitchen-remodel-quotes",
              chatTitle: "Kitchen remodel quotes",
              connectionName: null,
              connectionType: "anthropic",
              device: null,
              durationMs: 1200,
              error: null,
              finishReason: null,
              id: "req_1",
              imageQuality: null,
              inputTokens: null,
              kind: "language",
              modelRequested: "anthropic/claude-haiku-5.5",
              modelServed: null,
              outputTokens: null,
              purpose: "chat",
              reasoningTokens: null,
              responseId: null,
              sessionId,
              startedAt: sent.getTime() + 1000,
              status: "finished",
              surface: null,
              totalTokens: 1000,
            },
          ],
        }}
      />,
    );

    expect(await screen.findByText(/ · You wrote$/)).toBeTruthy();
    expect(screen.getByText("Put those back where they were")).toBeTruthy();
    expect(screen.getByText("Your activity sent with it")).toBeTruthy();
    expect(screen.getByText("2m ago · moved 3 files")).toBeTruthy();
    expect(screen.getByText("The chat didn't look up any names.")).toBeTruthy();
  });
});
