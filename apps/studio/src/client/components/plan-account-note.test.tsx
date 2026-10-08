import { renderWithProviders } from "@/tests/render";
import { APP_NAME } from "@instrument-org/shared";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PlanAccountNote } from "./plan-account-note";

vi.mock("@/client/rpc/client", () => ({
  rpcClient: {
    auth: {
      live: {
        hasToken: {
          experimental_liveOptions: () => ({
            queryFn: () => Promise.resolve(false),
            queryKey: ["auth", "hasToken"],
          }),
        },
      },
    },
    gateway: {
      models: {
        live: {
          list: {
            experimental_liveOptions: () => ({
              queryFn: () => Promise.resolve({ models: [] }),
              queryKey: ["gateway", "models"],
            }),
          },
        },
      },
    },
    utils: {
      openExternalLink: {
        mutationOptions: (options: object) => ({
          mutationFn: () => Promise.resolve(),
          ...options,
        }),
      },
    },
  },
}));

function renderNote(stop: Parameters<typeof PlanAccountNote>[0]["stop"]) {
  return renderWithProviders(
    <PlanAccountNote
      onContinue={vi.fn()}
      onKeepGoing={vi.fn()}
      onWait={vi.fn()}
      stop={stop}
    />,
  );
}

function openSwitchMenu() {
  fireEvent.keyDown(screen.getByRole("button", { name: /Switch AI/ }), {
    key: "Enter",
  });
}

describe("PlanAccountNote", () => {
  it("offers the other ways to keep going when ChatGPT is out of usage", () => {
    renderNote({ kind: "usage-limit", provider: "chatgpt-account" });
    expect(screen.getByText("ChatGPT is out of usage for now.")).toBeDefined();

    openSwitchMenu();

    for (const item of [
      `${APP_NAME}'s AI`,
      "Claude",
      "Your own API key",
      "See your usage in ChatGPT",
      "Wait for it to come back",
    ]) {
      expect(screen.getByRole("menuitem", { name: item })).toBeDefined();
    }
  });

  it("offers ChatGPT and the wait when Claude is out of usage", () => {
    const resetsAt = new Date(Date.now() + 3_600_000);
    renderNote({ kind: "usage-limit", provider: "claude-account", resetsAt });

    openSwitchMenu();

    expect(screen.getByRole("menuitem", { name: "ChatGPT" })).toBeDefined();
    expect(
      screen.getByRole("menuitem", { name: /^Wait until / }),
    ).toBeDefined();
  });

  it("offers another AI when the account can't be used here", () => {
    renderNote({ kind: "not-eligible", provider: "claude-account" });

    expect(
      screen.getByText(
        "This Claude account can't be used here. It needs a paid Claude plan.",
      ),
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Connect another AI" }),
    ).toBeDefined();
  });

  it("offers Continue once the usage is back", () => {
    renderNote({
      kind: "usage-limit",
      provider: "chatgpt-account",
      resetsAt: new Date(Date.now() - 60_000),
    });

    expect(screen.getByRole("button", { name: "Continue" })).toBeDefined();
  });
});
