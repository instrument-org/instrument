import { type ConnectResult } from "@/client/hooks/use-connect-flow";
import { renderWithDefaultStore } from "@/tests/render";
import { AIProviderConfigIdSchema } from "@instrument-org/shared";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { type LastConnection, noteConnection } from "../last-connection";
import { FreeAccountPage, FreeAccountStep } from "./free-account";

const calls = vi.hoisted(() => [] as string[]);

// Google's sign-in, as a button that answers with what the test names.
vi.mock("@/client/components/connect-button", () => ({
  ConnectButton: ({
    onResult,
  }: {
    onResult: (result: ConnectResult) => void;
  }) => (
    <>
      <button
        onClick={() => {
          onResult({ outcome: { kind: "ready" } });
        }}
        type="button"
      >
        Google ready
      </button>
      <button
        onClick={() => {
          onResult({ outcome: { kind: "sign-up-refused" } });
        }}
        type="button"
      >
        Google refused
      </button>
    </>
  ),
}));

function renderStep() {
  calls.length = 0;
  renderWithDefaultStore(
    <FreeAccountStep
      hold={() => {}}
      isLast={false}
      isNewStepOnly={false}
      onContinue={() => calls.push("continue")}
      onFinish={() => {}}
      step="free-account"
    />,
  );
}

describe("FreeAccountStep", () => {
  it("goes on once Google signs in", () => {
    renderStep();
    fireEvent.click(screen.getByRole("button", { name: "Google ready" }));
    expect(calls).toEqual(["continue"]);
  });

  it("stays put when the account isn't made", () => {
    renderStep();
    fireEvent.click(screen.getByRole("button", { name: "Google refused" }));
    expect(calls).toEqual([]);
  });

  it("goes on with Not now", () => {
    renderStep();
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(calls).toEqual(["continue"]);
  });

  it.each<[LastConnection, string]>([
    [
      { kind: "sign-in", provider: "chatgpt" },
      "doesn't count against your ChatGPT plan",
    ],
    [
      {
        kind: "key",
        providerConfigId: AIProviderConfigIdSchema.parse("openai"),
      },
      "doesn't use your plan or your key",
    ],
  ])("says what a free account leaves alone after %o", (connection, line) => {
    noteConnection(connection);
    renderStep();
    expect(screen.getByText(line, { exact: false })).toBeDefined();
  });
});

describe("FreeAccountPage", () => {
  it("calls out the perk a feature opened it for, and only that one", () => {
    renderWithDefaultStore(
      <FreeAccountPage
        calledOut="Dictation"
        footer={null}
        onSignedIn={vi.fn()}
      />,
    );

    const called = document.querySelectorAll("[data-called-out]");
    expect(called).toHaveLength(1);
    expect(called[0]?.textContent).toContain("Dictation");
  });
});
