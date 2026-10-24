import { type ConnectResult } from "@/client/hooks/use-connect-flow";
import { renderWithProviders } from "@/tests/render";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ChooseAI } from "./choose-ai";

const instrument = vi.hoisted(() => ({
  signedIn: false,
  start: vi.fn<(input?: unknown) => Promise<ConnectResult | undefined>>(),
}));

// Each way in as a flow at rest; Instrument's start is the one under test.
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
          queryFn: () => Promise.resolve(null),
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
  instrument.start.mockReset();
});

describe("ChooseAI", () => {
  it("offers Google while signed out", async () => {
    instrument.signedIn = false;
    instrument.start.mockResolvedValue({ outcome: { kind: "canceled" } });
    renderChoices();
    fireEvent.click(
      await screen.findByRole("button", { name: "Continue with Google" }),
    );
    expect(instrument.start).toHaveBeenCalledWith(undefined);
  });

  it("offers See plans in Google's place to an account signed in with no plan, and stays signed in after Cancel", async () => {
    instrument.signedIn = true;
    instrument.start.mockResolvedValue({ outcome: { kind: "canceled" } });
    const onDone = renderChoices();
    expect(
      await screen.findByText(
        "You're signed in to Instrument. Choose a plan, or use a subscription or key you already pay for.",
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "See plans" }));
    expect(instrument.start).toHaveBeenCalledWith({ plans: true });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "See plans" })).toBeTruthy();
    });
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
    await waitFor(() => {
      expect(onDone).toHaveBeenCalledOnce();
    });
  });
});
