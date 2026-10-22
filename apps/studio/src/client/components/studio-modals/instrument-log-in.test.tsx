import { type RPCOutput } from "@/client/rpc/client";
import { renderWithProviders } from "@/tests/render";
import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  AfterInstrumentSignIn,
  InstrumentLogInPage,
  nextAfterInstrumentSignIn,
} from "./instrument-log-in";

type Status = RPCOutput["billing"]["status"];

const account = vi.hoisted(() => ({
  claude: { kind: "signed-out" },
  keys: [] as unknown[],
  status: undefined as unknown,
}));
const toastSuccess = vi.hoisted(() => vi.fn());

const live = vi.hoisted(() => (key: string, read: () => unknown) => ({
  experimental_liveOptions: () => ({
    queryFn: () => Promise.resolve(read()),
    queryKey: [key],
  }),
}));

vi.mock("@/client/rpc/client", () => ({
  rpcClient: {
    auth: { live: { hasToken: live("hasToken", () => true) } },
    billing: {
      openPortal: { mutationOptions: (options: object) => options },
      status: {
        queryOptions: (options: object) => ({
          ...options,
          queryFn: () => Promise.resolve(account.status),
          queryKey: ["status"],
        }),
      },
    },
    chatgptAccount: {
      live: { status: live("chatgpt", () => ({ accounts: [] })) },
    },
    claudeAccount: { live: { status: live("claude", () => account.claude) } },
    grokAccount: { live: { status: live("grok", () => ({ accounts: [] })) } },
    providerConfig: { live: { list: live("keys", () => account.keys) } },
  },
}));
vi.mock("@/client/components/billing/plan-pages", () => ({
  PlanPages: () => <p>Plan pages</p>,
}));
vi.mock("@/client/components/connect-button", () => ({
  ConnectButton: () => <button type="button">Continue with Google</button>,
}));
vi.mock("@/client/components/terms-footer", () => ({
  TermsFooter: () => null,
}));
vi.mock("@/client/lib/toast", () => ({
  toast: { error: vi.fn(), success: toastSuccess },
}));

const trialRunning: Status = {
  canSubscribe: true,
  plan: "trial",
  trial: { endsAt: "2099-01-01T00:00:00Z", percentUsed: 0, state: "active" },
  windows: [],
};
const noPlan: Status = {
  canSubscribe: true,
  plan: "free",
  trial: { state: "available" },
  windows: [],
};
const paymentFailed: Status = {
  canSubscribe: false,
  plan: "none",
  subscription: {
    cancelAtPeriodEnd: false,
    currentPeriodEnd: "2099-01-01T00:00:00Z",
    status: "past_due",
  },
  trial: { state: "ended" },
  windows: [],
};
const subscribed: Status = {
  ...paymentFailed,
  plan: "basic",
  subscription: {
    cancelAtPeriodEnd: false,
    currentPeriodEnd: "2099-01-01T00:00:00Z",
    status: "active",
  },
};

describe("nextAfterInstrumentSignIn", () => {
  it.each([
    {
      hasOwnAI: false,
      name: "a subscription",
      next: "finish",
      status: subscribed,
    },
    {
      hasOwnAI: false,
      name: "a running trial",
      next: "finish",
      status: trialRunning,
    },
    { hasOwnAI: true, name: "AI of its own", next: "finish", status: noPlan },
    { hasOwnAI: false, name: "no plan", next: "plans", status: noPlan },
    {
      hasOwnAI: false,
      name: "an unread status",
      next: "plans",
      status: undefined,
    },
    {
      hasOwnAI: true,
      name: "a failed payment",
      next: "payment-failed",
      status: paymentFailed,
    },
  ])("$name goes to $next", ({ hasOwnAI, next, status }) => {
    expect(nextAfterInstrumentSignIn({ hasOwnAI, status }).kind).toBe(next);
  });
});

describe("InstrumentLogInPage", () => {
  it("is a plain log-in with Google", () => {
    renderWithProviders(<InstrumentLogInPage onSignedIn={vi.fn()} />);
    expect(screen.getByRole("heading").textContent).toBe(
      "Log in to Instrument",
    );
    expect(
      screen.getByText(
        "Continue with Google to log in, or to make an account if you don't have one yet.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Continue with Google" }),
    ).toBeTruthy();
  });
});

describe("AfterInstrumentSignIn", () => {
  beforeEach(() => {
    account.claude = { kind: "signed-out" };
    account.keys = [];
    toastSuccess.mockClear();
  });

  const renderAfter = () => {
    const onFinish = vi.fn();
    renderWithProviders(
      <AfterInstrumentSignIn
        onFinish={onFinish}
        result={{ outcome: { kind: "ready" } }}
      />,
    );
    return onFinish;
  };

  it("finishes with the signed-in toast for an account with a trial running", async () => {
    account.status = trialRunning;
    const onFinish = renderAfter();
    await waitFor(() => {
      expect(onFinish).toHaveBeenCalledOnce();
    });
    expect(toastSuccess).toHaveBeenCalledWith(
      "Signed in to Instrument",
      expect.anything(),
    );
  });

  it("finishes for someone whose Claude plan already brings the AI", async () => {
    account.status = noPlan;
    account.claude = { kind: "signed-in" };
    const onFinish = renderAfter();
    await waitFor(() => {
      expect(onFinish).toHaveBeenCalledOnce();
    });
  });

  it("shows the plans to an account with no plan and no AI of its own", async () => {
    account.status = noPlan;
    const onFinish = renderAfter();
    expect(await screen.findByText("Plan pages")).toBeTruthy();
    expect(onFinish).not.toHaveBeenCalled();
  });

  it("shows billing's notice for a failed payment rather than the plans", async () => {
    account.status = paymentFailed;
    renderAfter();
    expect(
      await screen.findByRole("heading", {
        name: "Your payment didn't go through",
      }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Update card" })).toBeTruthy();
    expect(screen.queryByText("Plan pages")).toBeNull();
  });
});
