import { SetupContext } from "@/client/components/onboarding/setup/context";
import {
  initialSetupState,
  type SetupStep,
} from "@/client/components/onboarding/setup/flow";
import { type RPCOutput } from "@/client/rpc/client";
import { renderWithProviders } from "@/tests/render";
import { screen } from "@testing-library/react";
import { type ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BetaOfferPage, PlansPage } from "./plans";

type Offer = RPCOutput["billing"]["offer"];
type Status = RPCOutput["billing"]["status"];

// What the mocked platform answers, set per test.
const { mutation, platform, query } = vi.hoisted(() => {
  const answers: { offer: unknown; signedIn: boolean; status: unknown } = {
    offer: null,
    signedIn: true,
    status: null,
  };
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
      offer: { queryOptions: query("offer", () => platform.offer) },
      openCheckout: { mutationOptions: mutation() },
      status: { queryOptions: query("status", () => platform.status) },
    },
    user: {
      live: {
        me: {
          experimental_liveOptions: query("me", () => ({
            email: "jamie.rivera@gmail.com",
            name: "Jamie",
          })),
        },
      },
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

// The ChatGPT and Claude ways in are their own pages' concern.
vi.mock("@/client/components/onboarding/setup/way-in-sign-in", () => ({
  useChatGPTWayIn: () => ({ start: () => {}, waiting: false }),
  useClaudeWayIn: () => ({ connecting: false, start: () => {} }),
}));

const windows = [{ anchor: "first_use", duration: "PT5H", key: "5h" }];
const OFFER = {
  offerVersion: "v",
  plans: [
    {
      allowance: { multiple: 1, windows },
      description: null,
      features: [],
      key: "standard",
      name: "Instrument",
      price: { currency: "usd", interval: "month", unitAmount: 1000 },
    },
    {
      allowance: { multiple: 4, windows },
      description: null,
      features: [],
      key: "plus",
      name: "Instrument Plus",
      price: { currency: "usd", interval: "month", unitAmount: 4000 },
    },
  ],
  trial: { available: true, cardRequired: false, days: 7 },
} satisfies Offer;

const NO_PLAN = {
  canSubscribe: true,
  plan: "none",
  trial: { state: "available" },
  windows: [],
} satisfies Status;

const dispatch = vi.fn();

function renderPage(page: ReactElement, step: SetupStep) {
  renderWithProviders(
    <SetupContext
      value={{
        dispatch,
        finish: () => {},
        returning: false,
        state: { ...initialSetupState({ returning: false }), step },
      }}
    >
      {page}
    </SetupContext>,
  );
}

beforeEach(() => {
  dispatch.mockReset();
  platform.offer = OFFER;
  platform.signedIn = true;
  platform.status = NO_PLAN;
});

describe("Choose a plan", () => {
  it("offers a free trial on every plan", async () => {
    renderPage(<PlansPage />, "plans");

    expect(
      await screen.findByText("Try Instrument free for 7 days"),
    ).toBeDefined();
    expect(screen.getAllByText("Start free trial")).toHaveLength(2);
    expect(screen.getByText("For heavy use")).toBeDefined();
    expect(screen.getByText("4× Standard")).toBeDefined();
    expect(screen.queryByText(/Subscribe/)).toBeNull();
  });

  it("subscribes instead with no trial left", async () => {
    platform.offer = { ...OFFER, trial: null };
    renderPage(<PlansPage />, "plans");

    expect(await screen.findByText("Choose a plan")).toBeDefined();
    expect(screen.getAllByText("Subscribe")).toHaveLength(2);
  });

  it("goes on with a subscription already", async () => {
    platform.status = {
      ...NO_PLAN,
      canSubscribe: false,
      plan: "standard",
      subscription: { cancelAtPeriodEnd: false, status: "active" },
    } satisfies Status;
    renderPage(<PlansPage />, "plans");

    await vi.waitFor(() => {
      expect(dispatch).toHaveBeenCalledWith({
        step: "memories",
        type: "replace",
      });
    });
  });
});

describe("Beta tester plan", () => {
  it("shows the offer the API makes", async () => {
    platform.offer = { ...OFFER, beta: { months: 3, plan: "plus" } };
    renderPage(<BetaOfferPage />, "beta-offer");

    expect(
      await screen.findByText("Instrument Plus is on us for 3 months"),
    ).toBeDefined();
    expect(screen.getByText("$0")).toBeDefined();
    expect(screen.getByText("Accept")).toBeDefined();
  });

  it("leaves for the plans without one", async () => {
    renderPage(<BetaOfferPage />, "beta-offer");

    await vi.waitFor(() => {
      expect(dispatch).toHaveBeenCalledWith({ step: "plans", type: "replace" });
    });
  });
});
