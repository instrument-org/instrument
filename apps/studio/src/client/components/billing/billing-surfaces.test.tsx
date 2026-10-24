import { type RPCInput, type RPCOutput } from "@/client/rpc/client";
import { renderWithProviders } from "@/tests/render";
import { type AIGatewayModelURI } from "@instrument-org/ai-gateway/client";
import { type SessionMessage } from "@instrument-org/workspace/client";
import { act, fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AccountSection } from "../settings/account-section";
import { useChatNote } from "./chat-note";

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
const { mutation, openWebsite, platform, query, toastError } = vi.hoisted(
  () => {
    const answers: {
      models: unknown[];
      offer: unknown;
      signedIn: boolean;
      status: unknown;
    } = {
      models: [],
      offer: null,
      signedIn: true,
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
      openWebsite: vi.fn((_input: RPCInput["billing"]["openWebsite"]) =>
        Promise.resolve(),
      ),
      platform: answers,
      query: (key: string, read: () => unknown) => (options?: object) => ({
        queryFn: () => Promise.resolve(read()),
        queryKey: [key],
        ...options,
      }),
      toastError: vi.fn(),
    };
  },
);

vi.mock("@/client/lib/toast", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  toast: { error: toastError },
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
      offer: { queryOptions: query("offer", () => platform.offer) },
      openWebsite: { call: openWebsite },
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
  openWebsite.mockClear();
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

  it("says when a scheduled downgrade starts, and keeps the plan on the website", async () => {
    platform.status = onProSwitchingToBasic();
    renderWithProviders(<AccountSection />);

    expect(
      await screen.findByText(
        `Switches to Basic on ${periodEnd}. You keep Pro until then.`,
      ),
    ).toBeDefined();
    expect(screen.getByText(/Pro · \$40 a month/)).toBeDefined();
    expect(screen.queryByText("Change plan")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Keep my plan" }));
    expect(openWebsite).toHaveBeenCalledWith({ page: "account" });
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

  it("offers the free trial on the free allowance, on the website", async () => {
    platform.offer = OFFER_WITH_TRIAL;
    platform.status = onFree();
    renderWithProviders(<AccountSection />);

    expect(
      await screen.findByText(/Your free trial gives you 7 days/),
    ).toBeDefined();
    expect(screen.queryByText(/free web search/)).toBeNull();
    // The free window is not a plan's limit, so it gets no meter.
    expect(screen.queryByText(/% used/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Start free trial" }));
    expect(openWebsite).toHaveBeenCalledWith({ page: "plans" });
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

  it("offers Upgrade at a limit on the lower plan, leading with the next plan", async () => {
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

    fireEvent.click(await screen.findByRole("button", { name: "Upgrade" }));
    expect(screen.getByText(/It resets/)).toBeDefined();
    expect(openWebsite).toHaveBeenCalledWith({ page: "plans", plan: "pro" });
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
    const { queryClient } = renderWithProviders(
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
    fireEvent.click(screen.getByRole("button", { name: "Start free trial" }));
    expect(openWebsite).toHaveBeenCalledWith({ page: "plans" });

    // The trial starts on the website, and coming back to the window reads
    // it running.
    platform.status = onTrial();
    act(() => {
      queryClient.setQueryData(["focus"], 1);
    });
    expect(
      await screen.findByRole("button", { name: "Continue" }),
    ).toBeDefined();
    expect(screen.getByText("Your free trial has started.")).toBeDefined();
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
