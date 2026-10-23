import { planSheetAtom } from "@/client/atoms/plan-sheet";
import { type RPCInput, type RPCOutput } from "@/client/rpc/client";
import { renderWithProviders } from "@/tests/render";
import { type AIGatewayModelURI } from "@instrument-org/ai-gateway/client";
import { type SessionMessage } from "@instrument-org/workspace/client";
import { ORPCError } from "@orpc/client";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AccountSection } from "../settings/account-section";
import { PlanStep } from "../setup/steps/plan";
import { useChatNote } from "./chat-note";
import { PlanSheet } from "./plan-sheet";

type ChangePlan = RPCOutput["billing"]["changePlan"];

const OURS =
  "instrument/auto?provider=instrument&providerConfigId=instrument" as AIGatewayModelURI.Type;
const CLAUDE =
  "anthropic/claude-sonnet-5-5?provider=claude-account&providerConfigId=claude" as AIGatewayModelURI.Type;

/** The chat's note as the reply box draws it. */
function ChatNoteHarness({
  isAgentRunning,
  messages,
  modelURI = OURS,
}: {
  isAgentRunning: boolean;
  messages: SessionMessage.WithParts[];
  modelURI?: AIGatewayModelURI.Type;
}) {
  const note = useChatNote({ isAgentRunning, messages, modelURI });
  return note ? (
    <div data-holds-send={String(note.holdsSend)}>
      {note.render({ nudge: 0, openModelPicker: vi.fn() })}
    </div>
  ) : null;
}
type Offer = RPCOutput["billing"]["offer"];
type Status = RPCOutput["billing"]["status"];

// What the mocked platform answers, set per test.
const { mutation, platform, query, toastError } = vi.hoisted(() => {
  const answers: {
    changePlan: (input: RPCInput["billing"]["changePlan"]) => Promise<unknown>;
    models: unknown[];
    offer: unknown;
    signedIn: boolean;
    startTrial: () => Promise<unknown>;
    status: unknown;
  } = {
    changePlan: () => Promise.resolve(null),
    models: [],
    offer: null,
    signedIn: true,
    startTrial: () => Promise.resolve(null),
    status: null,
  };
  return {
    mutation:
      (
        answer: (input: never) => Promise<unknown> = () =>
          Promise.resolve({ url: "" }),
      ) =>
      (options?: object) => ({
        mutationFn: answer,
        ...options,
      }),
    platform: answers,
    query: (key: string, read: () => unknown) => (options?: object) => ({
      queryFn: () => Promise.resolve(read()),
      queryKey: [key],
      ...options,
    }),
    toastError: vi.fn(),
  };
});

vi.mock("@/client/lib/toast", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  toast: { error: toastError },
}));

// The other AI choices, as the plan step opens them: the page it starts on,
// and a sign-in that connects.
// Setup's state says the plan is known, so the plan step draws its cards.
vi.mock("@/client/components/setup/use-setup-state", () => ({
  useSetupState: () => null,
}));
vi.mock("../setup/steps/choose-ai", () => ({
  ChooseAI: ({
    initial,
    onDone,
  }: {
    initial: { kind: string };
    onDone: () => void;
  }) => (
    <div data-choose-ai={initial.kind}>
      <button onClick={onDone} type="button">
        Connected
      </button>
    </div>
  ),
}));

vi.mock("@/client/rpc/client", () => ({
  rpcClient: {
    auth: {
      live: {
        hasToken: {
          experimental_liveOptions: query("hasToken", () => platform.signedIn),
        },
      },
    },
    gateway: {
      models: {
        live: {
          list: {
            experimental_liveOptions: query("models", () => ({
              models: platform.models,
            })),
          },
        },
      },
    },
    billing: {
      changePlan: {
        mutationOptions: mutation((input: RPCInput["billing"]["changePlan"]) =>
          platform.changePlan(input),
        ),
      },
      offer: { queryOptions: query("offer", () => platform.offer) },
      openCheckout: { mutationOptions: mutation() },
      openPortal: { mutationOptions: mutation() },
      startTrial: {
        mutationOptions: mutation(() => platform.startTrial()),
      },
      status: {
        key: () => ["status"],
        queryOptions: query("status", () => platform.status),
      },
    },
    user: {
      live: {
        me: {
          experimental_liveOptions: query("me", () =>
            platform.signedIn
              ? { email: "dana@example.com", id: "u1", name: "Dana Ortiz" }
              : null,
          ),
        },
      },
    },
    workspace: {
      decision: { available: { queryKey: () => ["decision-available"] } },
    },
    utils: {
      events: {
        windowFocusChanged: {
          experimental_liveOptions: query("focus", () => null),
        },
      },
      openExternalLink: { mutationOptions: mutation() },
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

// Pro, with a downgrade to Basic waiting for the end of the period.
const onProSwitchingToBasic = (): Status => ({
  ...onBasic({
    plan: "pro",
    scheduledChange: { at: NEXT_MONTH, plan: "basic" },
  }),
  plan: "pro",
});

const periodEnd = new Date(NEXT_MONTH).toLocaleDateString("en-US", {
  day: "numeric",
  month: "long",
  ...(new Date(NEXT_MONTH).getFullYear() === new Date().getFullYear()
    ? {}
    : { year: "numeric" }),
});

/** The free allowance, for an account that has never started its trial. */
const onFree = (paused?: { resetsAt: string }): Status => ({
  canSubscribe: true,
  features: {
    decisions: paused
      ? { available: false, code: "usage-limit-exceeded", ...paused }
      : { available: true },
    models: {
      available: false,
      code: "subscription-required",
      reason: "trial-available",
    },
    search: paused
      ? { available: false, code: "usage-limit-exceeded", ...paused }
      : { available: true },
  },
  plan: "free",
  trial: { state: "available" },
  windows: [{ key: "free", percentUsed: paused ? 100 : 10 }],
});

const OFFER_WITH_TRIAL: Offer = {
  ...OFFER,
  trial: { available: true, cardRequired: false, days: 7 },
};

const onTrial = (): Status => ({
  canSubscribe: true,
  features: {
    decisions: { available: true },
    models: { available: true },
    search: { available: true },
  },
  plan: "trial",
  trial: { endsAt: NEXT_MONTH, percentUsed: 0, state: "active" },
  windows: [],
});

beforeEach(() => {
  platform.changePlan = () => Promise.resolve(null);
  platform.startTrial = () => Promise.resolve(onTrial());
  toastError.mockClear();
  platform.models = [];
  platform.offer = OFFER;
  platform.signedIn = true;
  platform.status = null;
});

describe("Settings > Account", () => {
  it.each([
    {
      expected: [
        "Dana Ortiz",
        "Log out",
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
    renderWithProviders(<AccountSection />);

    for (const text of expected) {
      expect(
        await screen.findAllByText(
          new RegExp(text.replace("$", String.raw`\$`)),
        ),
      ).not.toHaveLength(0);
    }
  });

  it("says when a scheduled downgrade starts, and keeps the plan on request", async () => {
    platform.status = onProSwitchingToBasic();
    const changePlan = vi.fn(() =>
      Promise.resolve({ plan: "pro", status: "applied" } satisfies ChangePlan),
    );
    platform.changePlan = changePlan;
    renderWithProviders(<AccountSection />);

    expect(
      await screen.findByText(
        `Switches to Basic on ${periodEnd}. You keep Pro until then.`,
      ),
    ).toBeDefined();
    expect(screen.getByText(/Pro · \$40 a month/)).toBeDefined();
    expect(screen.queryByText("Change plan")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Keep my plan" }));
    await vi.waitFor(() => {
      expect(changePlan).toHaveBeenCalledWith({ plan: "pro" });
    });
  });

  // The status still calls the trial available; the offer has dropped it.
  it("offers a plan rather than the trial while trials can't start", async () => {
    platform.offer = { ...OFFER, trial: null };
    platform.status = {
      canSubscribe: true,
      plan: "trial",
      trial: { state: "available" },
      windows: [],
    };
    renderWithProviders(<AccountSection />);

    expect(await screen.findByText("No plan")).toBeDefined();
    expect(screen.queryByText(/Free trials/)).toBeNull();
    expect(screen.getByRole("button", { name: "Choose a plan" })).toBeDefined();
  });

  it("offers the free trial beside the plans on the free allowance, and starts it", async () => {
    platform.offer = OFFER_WITH_TRIAL;
    platform.status = onFree();
    const startTrial = vi.fn(() => Promise.resolve(onTrial()));
    platform.startTrial = startTrial;
    renderWithProviders(<AccountSection />);

    expect(
      await screen.findByText(/Your free trial gives you 7 days/),
    ).toBeDefined();
    expect(screen.queryByText(/free web search/)).toBeNull();
    // The free window is not a plan's limit, so it gets no meter.
    expect(screen.queryByText(/% used/)).toBeNull();
    expect(screen.getByRole("button", { name: "Choose a plan" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Start free trial" }));
    await vi.waitFor(() => {
      expect(startTrial).toHaveBeenCalled();
    });
    expect(await screen.findAllByText("Free trial")).not.toHaveLength(0);
  });

  it("says when free search and suggestions come back once the allowance is spent", async () => {
    platform.offer = OFFER_WITH_TRIAL;
    platform.status = onFree({ resetsAt: NEXT_MONTH });
    renderWithProviders(<AccountSection />);

    expect(
      await screen.findByText(
        `You've used your free web search, images and suggestions until ${periodEnd}.`,
      ),
    ).toBeDefined();
    expect(
      await screen.findByRole("button", { name: "Start free trial" }),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "Choose a plan" })).toBeDefined();
  });

  it("offers only a way to log in while logged out", async () => {
    platform.signedIn = false;
    renderWithProviders(<AccountSection />);

    expect(await screen.findByText("Log in to Instrument")).toBeDefined();
    expect(screen.getByRole("button", { name: "Log in" })).toBeDefined();
    expect(screen.queryByText("Plan")).toBeNull();
  });

  it("names the plan a failed payment is for", async () => {
    platform.status = {
      ...onBasic({ plan: "basic", status: "past_due" }),
      plan: "none",
      windows: [],
    };
    renderWithProviders(<AccountSection />);

    expect(await screen.findByText(/Basic · \$10 a month/)).toBeDefined();
  });

  it("offers no plan change while a payment is owed", async () => {
    platform.status = {
      ...onBasic({ status: "past_due" }),
      plan: "none",
      windows: [],
    };
    renderWithProviders(<AccountSection />);

    await screen.findByText("Update card");
    expect(screen.queryByText("Change plan")).toBeNull();
  });

  it("offers nothing to buy on a paid subscription whose access was revoked", async () => {
    platform.status = { ...onBasic(), plan: "none", windows: [] };
    renderWithProviders(<AccountSection />);

    await screen.findByText("Instrument isn't available on this account");
    expect(screen.queryByText("Change plan")).toBeNull();
    expect(screen.queryByText("Choose a plan")).toBeNull();
    expect(screen.queryByText("Keep my plan")).toBeNull();
  });
});

describe("the plan cards", () => {
  const cards = async () => {
    platform.status = {
      canSubscribe: true,
      plan: "none",
      trial: { state: "ended" },
      windows: [],
    } satisfies Status;
    const { store } = renderWithProviders(<PlanSheet />);
    act(() => {
      store.set(planSheetAtom, {});
    });
    await screen.findByText("Choose a plan");
    await vi.waitFor(() => {
      expect(document.querySelector('[data-plan-card="pro"]')).not.toBe(null);
    });
    const of = (plan: string) =>
      document.querySelector<HTMLElement>(`[data-plan-card="${plan}"]`);
    return of;
  };

  it("fills the meter by share of the biggest plan, and tints the biggest", async () => {
    const of = await cards();
    expect(
      ["basic", "pro"].map((plan) => [
        of(plan)?.querySelector("[data-allowance]")?.textContent,
        of(plan)
          ?.querySelector("[data-allowance-meter]")
          ?.getAttribute("data-allowance-meter"),
        of(plan)?.hasAttribute("data-heaviest"),
      ]),
    ).toEqual([
      ["Standard", "1/4", false],
      ["4× Standard", "4/4", true],
    ]);
  });

  it("lists the offer's features on each card", async () => {
    platform.offer = {
      ...OFFER,
      plans: OFFER.plans.map((plan) => ({
        ...plan,
        features: [`${plan.name} search`, `${plan.name} images`],
      })),
    } satisfies Offer;
    const of = await cards();
    expect(
      [...(of("pro")?.querySelectorAll("li") ?? [])].map(
        (item) => item.textContent,
      ),
    ).toEqual(["Pro search", "Pro images"]);
  });

  it.each([
    {
      expected: 0,
      models: undefined,
      name: "no models row when the offer names none",
    },
    {
      expected: 2,
      models: [
        { maker: "anthropic", name: "Claude Haiku 5.5" },
        { maker: "xai", name: "Grok 5" },
        { maker: "x-ai", name: "Grok 5 Fast" },
        { name: "Auto" },
      ],
      name: "the makers of the plan's own models",
    },
  ])("shows $name", async ({ expected, models }) => {
    platform.offer = {
      ...OFFER,
      plans: OFFER.plans.map((plan) => ({ ...plan, models })),
    } satisfies Offer;
    const of = await cards();
    await vi.waitFor(() => {
      expect(
        of("basic")?.querySelector("[data-plan-makers]")?.children.length ?? 0,
      ).toBe(expected);
    });
  });
});

describe("setup's plan step", () => {
  const renderStep = () => {
    const onContinue = vi.fn();
    renderWithProviders(
      <PlanStep
        hold={vi.fn()}
        isLast={false}
        isNewStepOnly={false}
        onContinue={onContinue}
        onFinish={vi.fn()}
        step="plan"
      />,
    );
    return onContinue;
  };
  const neverTrialed = (): Status => ({
    canSubscribe: true,
    plan: "free",
    trial: { state: "available" },
    windows: [],
  });

  it.each([
    { name: "trials held back", offer: { ...OFFER, trial: null } },
    {
      name: "an intro price",
      offer: {
        ...OFFER,
        trial: {
          available: true,
          cardRequired: true,
          days: 7,
          intro: { months: 1, price: { currency: "usd", unitAmount: 100 } },
          mode: "intro" as const,
        },
      },
    },
  ])(
    "offers a plan or another way in with $name, and connecting answers it",
    async ({ offer }) => {
      platform.offer = offer;
      platform.status = neverTrialed();
      const onContinue = renderStep();

      expect(await screen.findByText("Choose a plan")).toBeDefined();
      expect(screen.queryByText(/paused|aren't available/)).toBeNull();
      fireEvent.click(
        await screen.findByRole("button", {
          name: "Use your existing subscriptions",
        }),
      );
      expect(
        document
          .querySelector("[data-choose-ai]")
          ?.getAttribute("data-choose-ai"),
      ).toBe("subscriptions");
      fireEvent.click(screen.getByRole("button", { name: "Connected" }));
      expect(onContinue).toHaveBeenCalledOnce();
    },
  );

  it("opens the key page from the same line", async () => {
    platform.offer = { ...OFFER, trial: null };
    platform.status = neverTrialed();
    renderStep();
    fireEvent.click(
      await screen.findByRole("button", { name: "add an API key" }),
    );
    expect(
      document
        .querySelector("[data-choose-ai]")
        ?.getAttribute("data-choose-ai"),
    ).toBe("key");
  });

  it.each([
    {
      button: "Claim 3 free months",
      months: 3,
      title: "Pro is on us for 3 months",
    },
    {
      button: "Claim your free month",
      months: 1,
      title: "Pro is on us for a month",
    },
  ])(
    "shows the beta offer as Pro's card alone, free for $months month(s)",
    async ({ button, months, title }) => {
      platform.offer = { ...OFFER_WITH_TRIAL, beta: { months, plan: "pro" } };
      platform.status = onFree();
      renderStep();
      expect(await screen.findByRole("heading", { name: title })).toBeDefined();
      const cards = document.querySelectorAll("[data-plan-card]");
      expect(
        [...cards].map((card) => card.getAttribute("data-plan-card")),
      ).toEqual(["pro"]);
      expect(cards[0]?.querySelector("[data-plan-price]")?.textContent).toBe(
        `$0for ${months === 1 ? "1 month" : `${String(months)} months`}then $40/month`,
      );
      expect(screen.getByRole("button", { name: button })).toBeDefined();
      expect(
        screen.getByRole("button", { name: "Use your existing subscriptions" }),
      ).toBeDefined();
    },
  );

  it("offers a subscription but no key while a trial can start", async () => {
    platform.offer = OFFER_WITH_TRIAL;
    platform.status = onFree();
    renderStep();
    expect(
      await screen.findByRole("heading", {
        name: "Try Instrument free for 7 days",
      }),
    ).toBeDefined();
    expect(screen.queryByRole("button", { name: "add an API key" })).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Use your existing subscriptions" }),
    );
    expect(
      document
        .querySelector("[data-choose-ai]")
        ?.getAttribute("data-choose-ai"),
    ).toBe("subscriptions");
  });
});

describe("the plan sheet", () => {
  const openSheet = async (status: Status) => {
    platform.status = status;
    const { store } = renderWithProviders(<PlanSheet />);
    act(() => {
      store.set(planSheetAtom, {});
    });
    await screen.findByText("Change your plan");
  };
  const card = async (plan: string) => {
    await vi.waitFor(() => {
      expect(document.querySelector(`[data-plan-card="${plan}"]`)).not.toBe(
        null,
      );
    });
    const element = document.querySelector<HTMLElement>(
      `[data-plan-card="${plan}"]`,
    );
    return within(element ?? document.body);
  };

  // Checkout is handed off the way a sign-in is: a spinner and Cancel while
  // the browser has it, then Try again, and a payment made after the cancel
  // still closes the sheet.
  it("waits on Checkout with Cancel, then offers Try again", async () => {
    platform.status = {
      canSubscribe: true,
      plan: "none",
      trial: { state: "ended" },
      windows: [],
    } satisfies Status;
    const { queryClient, store } = renderWithProviders(<PlanSheet />);
    act(() => {
      store.set(planSheetAtom, {});
    });
    fireEvent.click(
      (await card("basic")).getByRole("button", { name: "Subscribe for $10" }),
    );

    expect(await screen.findByText("Finish in your browser")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
    fireEvent.click(screen.getByText("Cancel"));

    expect(await screen.findByText("No payment yet")).toBeDefined();
    expect(screen.getByRole("button", { name: "Try again" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Close" })).toBeDefined();

    platform.status = onBasic();
    await act(() => queryClient.refetchQueries({ queryKey: ["status"] }));
    await vi.waitFor(() => {
      expect(store.get(planSheetAtom)).toBeNull();
    });
  });

  it("says a smaller plan starts when the period ends, before it is chosen", async () => {
    await openSheet({ ...onBasic({ plan: "pro" }), plan: "pro" });

    expect(
      screen.getByText(
        `A smaller plan starts on ${periodEnd}, and you keep Pro until then.`,
      ),
    ).toBeDefined();
    const basic = await card("basic");
    expect(basic.getByText(`Starts ${periodEnd}`)).toBeDefined();
    expect(
      basic.getByRole("button", { name: "Switch to Basic" }),
    ).toBeDefined();
  });

  it("says when a scheduled downgrade starts once it is chosen", async () => {
    await openSheet({ ...onBasic({ plan: "pro" }), plan: "pro" });
    platform.changePlan = () =>
      Promise.resolve({
        effectiveAt: NEXT_MONTH,
        plan: "pro",
        status: "scheduled",
      } satisfies ChangePlan);

    fireEvent.click(
      (await card("basic")).getByRole("button", { name: "Switch to Basic" }),
    );

    expect(
      await screen.findByText(`Switching to Basic on ${periodEnd}`),
    ).toBeDefined();
    expect(
      screen.getByText("You keep Pro and its limits until then."),
    ).toBeDefined();
  });

  it("offers to keep the plan while a downgrade waits", async () => {
    const changePlan = vi.fn(() =>
      Promise.resolve({ plan: "pro", status: "applied" } satisfies ChangePlan),
    );
    platform.changePlan = changePlan;
    await openSheet(onProSwitchingToBasic());

    expect(
      screen.getByText(
        `Your plan switches to Basic on ${periodEnd}, and you keep Pro until then.`,
      ),
    ).toBeDefined();
    const basic = await card("basic");
    expect(basic.getByText(`Starts ${periodEnd}`)).toBeDefined();
    expect(basic.queryByRole("button")).toBeNull();
    const pro = await card("pro");
    expect(pro.getByText(`Until ${periodEnd}`)).toBeDefined();

    fireEvent.click(pro.getByRole("button", { name: "Keep Pro" }));
    await vi.waitFor(() => {
      expect(changePlan).toHaveBeenCalledWith({ plan: "pro" });
    });
  });

  it("says why a plan set to end can't switch, with the way to resume it", async () => {
    const message =
      "Your plan is set to end. Resume it in billing settings to switch plans.";
    platform.changePlan = () =>
      Promise.reject(
        new ORPCError("CONFLICT", {
          data: { code: "cancel-scheduled" },
          message,
        }),
      );
    await openSheet({ ...onBasic({ plan: "pro" }), plan: "pro" });

    fireEvent.click(
      (await card("basic")).getByRole("button", { name: "Switch to Basic" }),
    );

    await vi.waitFor(() => {
      expect(toastError).toHaveBeenCalledWith("Couldn't change your plan", {
        action: { label: "Manage billing", onClick: expect.any(Function) },
        description: message,
      });
    });
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
      <ChatNoteHarness
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
      <ChatNoteHarness
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
      <ChatNoteHarness
        isAgentRunning
        messages={refusedTurn({ code: "usage-limit-exceeded", window: "5h" })}
      />,
    );

    expect(container.innerHTML).toBe("");
  });

  it("warns quietly at 80% of a window", async () => {
    platform.status = onBasic({}, 86);
    renderWithProviders(
      <ChatNoteHarness isAgentRunning={false} messages={[]} />,
    );

    expect(
      await screen.findByText(/You've used 86% of your plan/),
    ).toBeDefined();
  });

  it("offers Change model beside the fix while the chat can't run", async () => {
    platform.status = onBasic({}, 100);
    platform.models = [{ params: { provider: "claude-account" } }];
    renderWithProviders(
      <ChatNoteHarness
        isAgentRunning={false}
        messages={refusedTurn({ code: "usage-limit-exceeded", window: "5h" })}
      />,
    );

    expect(
      await screen.findByRole("button", { name: "Change model" }),
    ).toBeDefined();
    // The status confirms the window is spent, so a send waits for it.
    await vi.waitFor(() => {
      expect(
        document
          .querySelector("[data-holds-send]")
          ?.getAttribute("data-holds-send"),
      ).toBe("true");
    });
  });

  it("leaves Change model out when Instrument's models are all there is", async () => {
    platform.status = onBasic({}, 100);
    renderWithProviders(
      <ChatNoteHarness
        isAgentRunning={false}
        messages={refusedTurn({ code: "usage-limit-exceeded", window: "5h" })}
      />,
    );

    expect(await screen.findByRole("alert")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Change model" })).toBeNull();
  });

  /** A turn in a Claude chat whose image call ran into `output`. */
  const imageTurn = (output: object) =>
    [
      {
        id: "msg_user",
        metadata: { createdAt: new Date(Date.now() - 5000), sessionId: "s" },
        parts: [],
        role: "user",
      },
      {
        id: "msg_image",
        metadata: { createdAt: new Date(Date.now() - 4000), sessionId: "s" },
        parts: [
          {
            input: { filePath: "header", prompt: "A help desk team" },
            output: { errorMessage: "", state: "failure", ...output },
            state: "output-available",
            type: "tool-generate_image",
          },
        ],
        role: "assistant",
      },
      {
        id: "msg_reply",
        metadata: { createdAt: new Date(Date.now() - 3000), sessionId: "s" },
        parts: [{ text: "I couldn't make it.", type: "text" }],
        role: "assistant",
      },
    ] as unknown as SessionMessage.WithParts[];

  it("offers the free account in a Claude chat that couldn't make an image", async () => {
    platform.signedIn = false;
    platform.models = [{ params: { provider: "claude-account" } }];
    renderWithProviders(
      <ChatNoteHarness
        isAgentRunning={false}
        messages={imageTurn({ errorType: "no-image-model" })}
        modelURI={CLAUDE}
      />,
    );

    expect(
      await screen.findByText("Make images with a free Instrument account."),
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Continue with Google" }),
    ).toBeDefined();
    expect(screen.queryByRole("button", { name: "Change model" })).toBeNull();
    expect(
      document
        .querySelector("[data-holds-send]")
        ?.getAttribute("data-holds-send"),
    ).toBe("false");
  });

  it("keeps a dismissed image offer away in other chats until the week is out", async () => {
    platform.signedIn = false;
    const turn = imageTurn({ errorType: "no-image-model" });
    const first = renderWithProviders(
      <ChatNoteHarness
        isAgentRunning={false}
        messages={turn}
        modelURI={CLAUDE}
      />,
    );
    await screen.findByText("Make images with a free Instrument account.");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    first.unmount();

    renderWithProviders(
      <ChatNoteHarness
        isAgentRunning={false}
        messages={turn}
        modelURI={CLAUDE}
      />,
    );
    // Long enough for the sign-in answer that drew it the first time.
    await act(() => new Promise((resolve) => setTimeout(resolve, 100)));
    expect(
      screen.queryByText("Make images with a free Instrument account."),
    ).toBeNull();
  });

  it("shows a spent free account's limit in a Claude chat, with its trial and no Change model", async () => {
    platform.offer = OFFER_WITH_TRIAL;
    platform.status = onFree({ resetsAt: SOON });
    platform.models = [{ params: { provider: "claude-account" } }];
    renderWithProviders(
      <ChatNoteHarness
        isAgentRunning={false}
        messages={imageTurn({
          errorType: "refused",
          refusal: { code: "usage-limit-exceeded", resetsAt: SOON },
        })}
        modelURI={CLAUDE}
      />,
    );

    expect(await screen.findByText(/^Images are paused until /)).toBeDefined();
    await vi.waitFor(() => {
      expect(
        document.querySelector("[data-slot=reply-note]")?.textContent,
      ).toContain("Your free Instrument usage ran out.");
    });
    // The chat goes on with the person's own AI, so nothing reads as stopped.
    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      await screen.findByRole("button", { name: "Start free trial" }),
    ).toBeDefined();
    expect(screen.queryByRole("button", { name: "Change model" })).toBeNull();
  });

  it("offers Start free trial for a model refused with trial-available, then Continue", async () => {
    platform.offer = OFFER_WITH_TRIAL;
    platform.status = onFree();
    // Reads after the start find the trial running, as the API would.
    const startTrial = vi.fn(() => {
      platform.status = onTrial();
      return Promise.resolve(onTrial());
    });
    platform.startTrial = startTrial;
    renderWithProviders(
      <ChatNoteHarness
        isAgentRunning={false}
        messages={refusedTurn(
          { code: "subscription-required", reason: "trial-available" },
          402,
        )}
      />,
    );

    expect(
      await screen.findByText(
        "Start your free trial to use Instrument's models.",
      ),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "Choose a plan" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Start free trial" }));

    expect(
      await screen.findByRole("button", { name: "Continue" }),
    ).toBeDefined();
    expect(screen.getByText("Your free trial has started.")).toBeDefined();
    expect(startTrial).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await vi.waitFor(() => {
      expect(screen.queryByText("Your free trial has started.")).toBeNull();
    });
  });

  it("holds a send on Instrument's models on the free allowance before any refusal", async () => {
    platform.offer = OFFER_WITH_TRIAL;
    platform.status = onFree();
    renderWithProviders(
      <ChatNoteHarness isAgentRunning={false} messages={[]} />,
    );

    expect(
      await screen.findByRole("button", { name: "Start free trial" }),
    ).toBeDefined();
    await vi.waitFor(() => {
      expect(
        document
          .querySelector("[data-holds-send]")
          ?.getAttribute("data-holds-send"),
      ).toBe("true");
    });
  });

  it("says quietly that advanced web search is paused after a search fell back", async () => {
    platform.offer = OFFER_WITH_TRIAL;
    platform.status = onFree({ resetsAt: NEXT_MONTH });
    const searched = [
      {
        id: "msg_searched",
        metadata: { createdAt: new Date(), sessionId: "s" },
        parts: [
          {
            input: { query: "weather" },
            output: {
              platformRefusal: {
                code: "usage-limit-exceeded",
                resetsAt: NEXT_MONTH,
              },
              results: { kind: "excerpts", sources: [] },
              state: "success",
            },
            state: "output-available",
            toolCallId: "t1",
            type: "tool-web_search",
          },
        ],
        role: "assistant",
      },
      // The reply comes in a step after the search.
      {
        id: "msg_reply",
        metadata: { createdAt: new Date(), sessionId: "s" },
        parts: [{ text: "Here is the forecast.", type: "text" }],
        role: "assistant",
      },
    ] as unknown as SessionMessage.WithParts[];
    renderWithProviders(
      <ChatNoteHarness
        isAgentRunning={false}
        messages={searched}
        modelURI={CLAUDE}
      />,
    );

    expect(
      await screen.findByText(
        `Web search through Instrument is paused until ${periodEnd}.`,
      ),
    ).toBeDefined();
    expect(
      await screen.findByRole("button", { name: "Start free trial" }),
    ).toBeDefined();
    expect(
      document
        .querySelector("[data-holds-send]")
        ?.getAttribute("data-holds-send"),
    ).toBe("false");
  });

  it("says nothing about Instrument's plan in a chat on another model", () => {
    platform.status = onBasic({}, 100);
    const { container } = renderWithProviders(
      <ChatNoteHarness
        isAgentRunning={false}
        messages={refusedTurn({ code: "usage-limit-exceeded", window: "5h" })}
        modelURI={CLAUDE}
      />,
    );

    expect(container.innerHTML).toBe("");
  });
});
