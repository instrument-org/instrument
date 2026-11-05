import { renderWithProviders } from "@/tests/render";
import { fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AddProviderSheet } from "./add-provider-sheet";

const phases = vi.hoisted(() => ({
  chatgpt: "idle",
  claude: "idle",
  grok: "idle",
  instrument: "idle",
}));
const cancel = vi.hoisted(() => vi.fn());

const flow = (provider: keyof typeof phases) => ({
  cancel,
  modelName: undefined,
  outcome: undefined,
  phase: phases[provider],
  reset: vi.fn(),
  start: vi.fn(() => new Promise(() => {})),
  waiting: phases[provider] !== "idle",
});

vi.mock("@/client/hooks/use-connect", () => ({
  useChatGPTConnect: () => flow("chatgpt"),
  useClaudeConnect: () => ({ ...flow("claude"), status: undefined }),
  useGrokConnect: () => ({ ...flow("grok"), userCode: undefined }),
  useInstrumentConnect: () => flow("instrument"),
}));
const plans = vi.hoisted(() => ({
  chatgpt: false,
  claude: false,
  grok: false,
}));
vi.mock("@/client/hooks/use-connected-plans", () => ({
  useConnectedPlans: () => plans,
}));

const live = vi.hoisted(() => (key: string, value: unknown) => ({
  experimental_liveOptions: () => ({
    queryFn: () => Promise.resolve(value),
    queryKey: [key],
  }),
}));
const account = vi.hoisted(() => ({
  hasToken: true,
  offerSnapshot: undefined as unknown,
  readOffer: (): Promise<unknown> => Promise.resolve(null),
}));
vi.mock("@/client/rpc/client", () => ({
  rpcClient: {
    auth: {
      live: {
        hasToken: {
          experimental_liveOptions: () => ({
            queryFn: () => Promise.resolve(account.hasToken),
            queryKey: ["hasToken"],
          }),
        },
      },
    },
    billing: {
      offer: {
        queryOptions: () => ({
          initialData: account.offerSnapshot,
          initialDataUpdatedAt: 0,
          queryFn: () => account.readOffer(),
          queryKey: ["offer"],
        }),
      },
    },
    chatgptAccount: {
      live: {
        status: live("chatgpt", {
          accounts: [
            {
              email: "sam@example.com",
              id: "a1",
              label: "Sam",
              state: "signed-in",
            },
          ],
        }),
      },
    },
    claudeAccount: { live: { status: live("claude", { kind: "signed-out" }) } },
    grokAccount: { live: { status: live("grok", { accounts: [] }) } },
    providerConfig: {
      live: {
        list: live("keys", [
          {
            id: "k1",
            maskedApiKey: "sk-o····4f2a",
            type: "openrouter",
          },
        ]),
      },
    },
  },
}));

const sheet = (
  <AddProviderSheet
    onComplete={vi.fn()}
    onDone={vi.fn()}
    onInstrumentSignedIn={vi.fn()}
  />
);

describe("AddProviderSheet", () => {
  it("lists what is connected and offers only the rest", async () => {
    plans.chatgpt = true;
    phases.chatgpt = "idle";
    renderWithProviders(sheet);
    expect(await screen.findByText("sam@example.com")).toBeTruthy();
    expect(screen.getByText("Key ending in 4f2a")).toBeTruthy();
    expect(document.querySelector('[data-connect-row="chatgpt"]')).toBeNull();
    expect(
      document.querySelector('[data-connect-row="claude"]'),
    ).not.toBeNull();
    plans.chatgpt = false;
  });

  it("lists the providers while nothing is being checked", () => {
    phases.chatgpt = "signing-in";
    renderWithProviders(sheet);
    expect(screen.getByText("Add an AI provider")).toBeTruthy();
  });

  it("waits on a page of its own once back from the browser", () => {
    phases.chatgpt = "checking";
    renderWithProviders(sheet);
    expect(screen.getByText("You're signed in to ChatGPT")).toBeTruthy();
    expect(screen.queryByText("Add an AI provider")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  describe("signed out", () => {
    const row = (provider: string) =>
      document.querySelector(`[data-connect-row="${provider}"]`);

    beforeEach(() => {
      account.hasToken = false;
      account.offerSnapshot = {
        plans: [],
        trial: { cardRequired: false, days: 7 },
      };
      phases.chatgpt = "idle";
    });
    afterEach(() => {
      account.hasToken = true;
      account.offerSnapshot = undefined;
      account.readOffer = () => Promise.resolve(null);
    });

    it("shows every provider and the snapshot's trial while the offer is unanswered", async () => {
      account.readOffer = () => new Promise(() => {});
      renderWithProviders(sheet);
      expect(await screen.findByText("An API key")).toBeTruthy();
      for (const provider of ["chatgpt", "claude", "grok"]) {
        expect(row(provider)).not.toBeNull();
      }
      expect(screen.getByText("Try Instrument free")).toBeTruthy();
      expect(
        screen.getByText(
          "Sign in with Google for 7 days free. No card needed.",
        ),
      ).toBeTruthy();
      const signIn = row("instrument")?.querySelector("button");
      expect(signIn?.textContent).toBe("Continue");
      expect(signIn?.disabled).toBe(false);
    });

    it("takes the server's copy when it differs from the snapshot's", async () => {
      account.readOffer = () => Promise.resolve({ plans: [], trial: null });
      renderWithProviders(sheet);
      expect(
        await screen.findByText("Sign in with Google and choose a plan."),
      ).toBeTruthy();
      expect(screen.queryByText("Try Instrument free")).toBeNull();
    });

    it("keeps the snapshot's copy when the offer can't be read", async () => {
      account.readOffer = () => Promise.reject(new Error("refused"));
      renderWithProviders(sheet);
      expect(await screen.findByText("Try Instrument free")).toBeTruthy();
      await new Promise((resolve) => {
        setTimeout(resolve, 10);
      });
      expect(screen.getByText("Try Instrument free")).toBeTruthy();
    });
  });
});
