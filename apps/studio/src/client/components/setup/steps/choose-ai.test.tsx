import { type ConnectResult } from "@/client/hooks/use-connect-flow";
import { renderWithProviders } from "@/tests/render";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ChooseAI } from "./choose-ai";

const instrument = vi.hoisted(() => ({
  offer: null as null | {
    plans: never[];
    trial: { cardRequired: boolean; days: number };
  },
  offerSnapshot: undefined as
    | undefined
    | { plans: never[]; trial: { cardRequired: boolean; days: number } },
  offerWaits: false,
  signedIn: false,
  start: vi.fn<(input?: unknown) => Promise<ConnectResult | undefined>>(),
}));

// Each provider as a flow at rest; Instrument's start is the one under test.
vi.mock("@/client/hooks/use-connect", () => {
  const flow = (
    start: (input?: unknown) => Promise<ConnectResult | undefined> = () =>
      Promise.resolve(undefined),
  ) => ({
    cancel: () => {},
    modelName: undefined,
    outcome: undefined,
    phase: "idle",
    reset: () => {},
    start,
    waiting: false,
  });
  return {
    useChatGPTConnect: () => flow(),
    useClaudeConnect: () => ({ ...flow(), status: undefined }),
    useGrokConnect: () => ({ ...flow(), userCode: undefined }),
    useInstrumentConnect: () => flow(instrument.start),
  };
});
vi.mock("@/client/components/terms-footer", () => ({
  TermsFooter: () => null,
}));
vi.mock("@/client/rpc/client", () => ({
  rpcClient: {
    auth: {
      live: {
        hasToken: {
          experimental_liveOptions: () => ({
            queryFn: () => Promise.resolve(instrument.signedIn),
            queryKey: ["hasToken"],
          }),
        },
      },
    },
    billing: {
      offer: {
        queryOptions: () => ({
          initialData: instrument.offerSnapshot,
          initialDataUpdatedAt: 0,
          queryFn: () =>
            instrument.offerWaits
              ? new Promise(() => {})
              : Promise.resolve(instrument.offer),
          queryKey: ["offer"],
        }),
      },
    },
  },
}));

function renderChoices() {
  const onDone = vi.fn();
  renderWithProviders(
    <ChooseAI hold={() => {}} initial={{ kind: "choices" }} onDone={onDone} />,
  );
  return onDone;
}

beforeEach(() => {
  instrument.offer = null;
  instrument.offerSnapshot = undefined;
  instrument.offerWaits = false;
  instrument.start.mockReset();
});

describe("ChooseAI", () => {
  it("offers Instrument AI while signed out", async () => {
    instrument.signedIn = false;
    instrument.start.mockResolvedValue({ outcome: { kind: "canceled" } });
    renderChoices();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Sign in to use Instrument AI",
      }),
    );
    expect(instrument.start).toHaveBeenCalledWith(undefined);
  });

  it("offers the server's trial while signed out", async () => {
    instrument.signedIn = false;
    instrument.offer = {
      plans: [],
      trial: { cardRequired: false, days: 7 },
    };
    renderChoices();
    expect(
      await screen.findByRole("button", {
        name: "Sign in to try Instrument AI free",
      }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Pick your AI provider to begin. An Instrument plan lets you pick models from OpenAI, Anthropic and more, at one affordable price. Try it free for 7 days.",
      ),
    ).toBeTruthy();
  });

  it("shows the snapshot's trial while the offer is unanswered", async () => {
    instrument.signedIn = false;
    instrument.offerWaits = true;
    instrument.offerSnapshot = {
      plans: [],
      trial: { cardRequired: false, days: 7 },
    };
    instrument.start.mockResolvedValue({ outcome: { kind: "canceled" } });
    renderChoices();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Sign in to try Instrument AI free",
      }),
    );
    expect(screen.getByText(/Try it free for 7 days\./)).toBeTruthy();
    expect(instrument.start).toHaveBeenCalledOnce();
  });

  it("offers See plans in Google's place to an account signed in with no plan, and stays signed in after Cancel", async () => {
    instrument.signedIn = true;
    instrument.start.mockResolvedValue({ outcome: { kind: "canceled" } });
    const onDone = renderChoices();
    fireEvent.click(await screen.findByRole("button", { name: "See plans" }));
    expect(instrument.start).toHaveBeenCalledWith({ plans: true });
    await waitFor(
      () => {
        expect(screen.getByRole("button", { name: "See plans" })).toBeTruthy();
      },
      { interval: 1 },
    );
    expect(
      screen.getByRole("button", { name: /Use an existing subscription/ }),
    ).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("goes on once a plan bought on the website lands", async () => {
    instrument.signedIn = true;
    instrument.start.mockResolvedValue({ outcome: { kind: "ready" } });
    const onDone = renderChoices();
    fireEvent.click(await screen.findByRole("button", { name: "See plans" }));
    await waitFor(
      () => {
        expect(onDone).toHaveBeenCalledOnce();
      },
      { interval: 1 },
    );
  });
});
