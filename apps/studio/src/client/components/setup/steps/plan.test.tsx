import { renderWithProviders } from "@/tests/render";
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PlanStep } from "./plan";

const setup = vi.hoisted(() => ({ isCheckingPlan: false }));

vi.mock("../use-setup-state", () => ({
  useSetupState: () => ({ facts: { isCheckingPlan: setup.isCheckingPlan } }),
}));
// The plans themselves are not under test: the offer never answers, so the
// cards page shows its own spinner under its title.
vi.mock("@/client/rpc/client", () => ({
  rpcClient: {
    billing: {
      offer: {
        queryOptions: () => ({
          queryFn: () => new Promise(() => {}),
          queryKey: ["offer"],
        }),
      },
    },
  },
}));
vi.mock("@/client/hooks/use-billing-status", () => ({
  useBillingStatus: () => ({ data: undefined }),
}));
vi.mock("@/client/components/billing/use-plan-checkout", () => ({
  usePlanCheckout: () => ({}),
}));
vi.mock("@/client/components/billing/use-start-trial", () => ({
  useStartTrial: () => ({}),
}));

function renderStep() {
  renderWithProviders(
    <PlanStep
      hold={() => {}}
      isLast={false}
      isNewStepOnly={false}
      onContinue={() => {}}
      onFinish={() => {}}
      step="plan"
    />,
  );
}

describe("PlanStep", () => {
  it("checks the account rather than showing plans while the plan status is unknown", () => {
    setup.isCheckingPlan = true;
    renderStep();
    expect(screen.getByRole("heading").textContent).toBe(
      "Checking your account…",
    );
  });

  it("shows the plans once the status says they're needed", () => {
    setup.isCheckingPlan = false;
    renderStep();
    expect(screen.getByRole("heading").textContent).not.toBe(
      "Checking your account…",
    );
  });
});
