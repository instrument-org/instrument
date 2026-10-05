import { type RPCOutput } from "@/client/rpc/client";
import { renderWithProviders } from "@/tests/render";
import { type SessionMessage } from "@instrument-org/workspace/client";
import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UsageAndBillingSection } from "../settings/usage-and-billing-section";
import { ChatBillingNotice } from "./chat-billing-notice";

type Offer = RPCOutput["billing"]["offer"];
type Status = RPCOutput["billing"]["status"];

// What the mocked platform answers, set per test.
const { mutation, platform, query } = vi.hoisted(() => {
  const answers: {
    offer: unknown;
    signedIn: boolean;
    status: unknown;
  } = { offer: null, signedIn: true, status: null };
  return {
    mutation: () => (options?: object) => ({
      mutationFn: () => Promise.resolve({ url: "" }),
      ...options,
    }),
    platform: answers,
    query: (key: string, read: () => unknown) => (options?: object) => ({
      queryFn: () => Promise.resolve(read()),
      queryKey: [key],
      ...options,
    }),
  };
});

vi.mock("@/client/rpc/client", () => ({
  rpcClient: {
    auth: {
      live: {
        hasToken: {
          experimental_liveOptions: query("hasToken", () => platform.signedIn),
        },
      },
    },
    billing: {
      changePlan: { mutationOptions: mutation() },
      offer: { queryOptions: query("offer", () => platform.offer) },
      openCheckout: { mutationOptions: mutation() },
      openPortal: { mutationOptions: mutation() },
      status: { queryOptions: query("status", () => platform.status) },
    },
    utils: {
      events: {
        windowFocusChanged: {
          experimental_liveOptions: query("focus", () => null),
        },
      },
    },
  },
}));

const windows = [{ anchor: "first_use", duration: "PT5H", key: "5h" }];
const OFFER: Offer = {
  offerVersion: "v",
  plans: [
    {
      allowance: { multiple: 1, windows },
      description: null,
      features: [],
      key: "basic",
      name: "Basic",
      price: { currency: "usd", interval: "month", unitAmount: 1000 },
    },
    {
      allowance: { multiple: 4, windows },
      description: null,
      features: [],
      key: "pro",
      name: "Pro",
      price: { currency: "usd", interval: "month", unitAmount: 4000 },
    },
  ],
  trial: { available: false, cardRequired: false, days: 7 },
};

const SOON = new Date(Date.now() + 3 * 3_600_000).toISOString();
const NEXT_MONTH = new Date(Date.now() + 30 * 86_400_000).toISOString();

const onBasic = (
  subscription: Partial<NonNullable<Status["subscription"]>> = {},
  percent = 30,
): Status => ({
  canSubscribe: false,
  plan: "basic",
  subscription: {
    cancelAtPeriodEnd: false,
    currentPeriodEnd: NEXT_MONTH,
    status: "active",
    ...subscription,
  },
  trial: { state: "ended" },
  windows: [{ key: "5h", percentUsed: percent, resetsAt: SOON }],
});

beforeEach(() => {
  platform.offer = OFFER;
  platform.signedIn = true;
  platform.status = null;
});

describe("Settings > Usage and billing", () => {
  it.each([
    {
      expected: [
        "Basic · $10 a month",
        "Change plan",
        "Manage billing",
        "30% used",
      ],
      name: "on a plan",
      status: onBasic(),
    },
    {
      expected: ["Ends", "Keep my plan"],
      name: "canceled",
      status: onBasic({ cancelAtPeriodEnd: true }),
    },
    {
      expected: ["Update card", "Your subscription"],
      name: "payment failed",
      status: { ...onBasic({ status: "past_due" }), plan: "none", windows: [] },
    },
    {
      expected: ["No plan", "Choose a plan"],
      name: "no plan",
      status: {
        canSubscribe: true,
        plan: "none",
        trial: { state: "ended" },
        windows: [],
      } satisfies Status,
    },
    {
      expected: ["Free trial", "Choose a plan", "45% used"],
      name: "on the trial",
      status: {
        canSubscribe: true,
        plan: "trial",
        trial: { endsAt: NEXT_MONTH, percentUsed: 45, state: "active" },
        windows: [],
      } satisfies Status,
    },
  ])("shows $name", async ({ expected, status }) => {
    platform.status = status;
    renderWithProviders(<UsageAndBillingSection />);

    for (const text of expected) {
      expect(
        await screen.findAllByText(
          new RegExp(text.replace("$", String.raw`\$`)),
        ),
      ).not.toHaveLength(0);
    }
  });

  it("offers no plan change while a payment is owed", async () => {
    platform.status = {
      ...onBasic({ status: "past_due" }),
      plan: "none",
      windows: [],
    };
    renderWithProviders(<UsageAndBillingSection />);

    await screen.findByText("Update card");
    expect(screen.queryByText("Change plan")).toBeNull();
  });
});

describe("the chat's billing notice", () => {
  const refusedTurn = (body: object, status = 429) =>
    [
      {
        id: "msg_user",
        metadata: { createdAt: new Date(Date.now() - 5000), sessionId: "s" },
        parts: [],
        role: "user",
      },
      {
        id: "msg_refused",
        metadata: {
          aiGatewayModel: { name: "Auto", params: { provider: "instrument" } },
          createdAt: new Date(Date.now() - 4000),
          error: {
            classification: "usage-limit",
            kind: "api-call",
            message: "Refused",
            name: "AI_APICallError",
            responseBody: JSON.stringify({ error: body }),
            statusCode: status,
            url: "http://localhost/gateway",
          },
          sessionId: "s",
        },
        parts: [],
        role: "assistant",
      },
      // Context the session records after a turn, which is no reply.
      { id: "msg_context", metadata: {}, parts: [], role: "session-context" },
    ] as unknown as SessionMessage.WithParts[];

  it("offers Upgrade, without naming a plan, at a limit on the lower plan", async () => {
    platform.status = onBasic({}, 100);
    renderWithProviders(
      <ChatBillingNotice
        isAgentRunning={false}
        messages={refusedTurn({
          code: "usage-limit-exceeded",
          resetsAt: SOON,
          window: "5h",
        })}
      />,
    );

    expect(
      await screen.findByRole("button", { name: "Upgrade" }),
    ).toBeDefined();
    expect(screen.getByText(/It resets/)).toBeDefined();
  });

  it("offers Continue once a plan has been bought", async () => {
    platform.status = onBasic();
    renderWithProviders(
      <ChatBillingNotice
        isAgentRunning={false}
        messages={refusedTurn(
          { code: "subscription-required", reason: "trial-ended" },
          402,
        )}
      />,
    );

    expect(
      await screen.findByRole("button", { name: "Continue" }),
    ).toBeDefined();
  });

  it("says nothing while the turn is still running", () => {
    platform.status = onBasic({}, 100);
    const { container } = renderWithProviders(
      <ChatBillingNotice
        isAgentRunning
        messages={refusedTurn({ code: "usage-limit-exceeded", window: "5h" })}
      />,
    );

    expect(container.innerHTML).toBe("");
  });

  it("warns quietly at 80% of a window", async () => {
    platform.status = onBasic({}, 86);
    renderWithProviders(
      <ChatBillingNotice isAgentRunning={false} messages={[]} />,
    );

    expect(
      await screen.findByText(/You've used 86% of your plan/),
    ).toBeDefined();
  });
});
