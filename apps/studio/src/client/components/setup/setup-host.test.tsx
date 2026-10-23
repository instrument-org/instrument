import { windowHoldsAtom } from "@/client/atoms/tab-navigation-block";
import { type SetupState } from "@/shared/setup";
import { renderWithDefaultStore } from "@/tests/render";
import { fireEvent, screen } from "@testing-library/react";
import { getDefaultStore } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SetupHost } from "./setup-host";

// Setup's toaster reads the theme, which is not under test.
vi.mock("@/client/components/ui/sonner", () => ({ Toaster: () => null }));
vi.mock("@/client/components/theme-provider", () => ({
  useTheme: () => ({ setTheme: () => {}, theme: "light" }),
}));
vi.mock("@/client/components/network-status/network-status-pill", () => ({
  SetupNetworkStatusPill: () => null,
}));

// The host under test, not the choose-AI, plan and free-account pages, which
// sign in and read billing: each draws its name and the host's ways on.
vi.mock("./step-pages", async (importOriginal) => {
  const { SETUP_PAGES } = await importOriginal<typeof import("./step-pages")>();
  const { SetupFooter, SetupPage } = await import("./kit/setup-page");
  const Page = ({
    isLast,
    onBack,
    onContinue,
    onFinish,
    step,
  }: import("./step-props").SetupStepProps) => (
    <SetupPage
      footer={
        <SetupFooter
          label={isLast ? "Finish" : "Continue"}
          onBack={onBack}
          onContinue={isLast ? onFinish : onContinue}
        />
      }
      title={step}
    />
  );
  return {
    SETUP_PAGES: {
      ...SETUP_PAGES,
      "free-account": Page,
      plan: Page,
      "choose-ai": Page,
    },
  };
});

const rpc = vi.hoisted(() => ({
  answer: vi.fn(),
  back: vi.fn(),
  finish: vi.fn(),
}));

// The live state never answers here, so whatever setup draws comes from the
// preload's read as the window loaded: what keeps a first launch from showing
// the inbox for a frame before setup covers it.
vi.mock("@/client/rpc/client", () => {
  const live = (key: string, data?: unknown) => ({
    experimental_liveOptions: () => ({
      queryFn: () => (data === undefined ? new Promise(() => {}) : data),
      queryKey: [key],
    }),
  });
  const mutation = (fn: (input: unknown) => void) => ({
    mutationOptions: () => ({ mutationFn: fn }),
  });
  return {
    rpcClient: {
      preferences: { live: { get: live("preferences", {}) } },
      setup: {
        answer: mutation(rpc.answer),
        back: mutation(rpc.back),
        finish: mutation(rpc.finish),
        live: { state: live("setup") },
      },
      user: { live: { me: live("me") } },
      utils: {
        closeWindow: mutation(() => {}),
        events: { windowFocusChanged: live("windowFocusChanged") },
        live: { windowState: live("windowState", { maximized: false }) },
        minimizeWindow: mutation(() => {}),
        toggleMaximizeWindow: mutation(() => {}),
      },
    },
  };
});

function loadedWith(step: SetupState["step"], back: SetupState["back"] = null) {
  window.api.initialSetupState = {
    back,
    facts: {
      folderSettled: true,
      hasInstrumentAccount: false,
      hasInstrumentPlan: false,
      hasOwnAI: false,
      hasUsableAI: false,
      hasWorkspace: true,
      lostFolder: null,
      isCheckingPlan: false,
      notificationsAskable: false,
      hasChats: false,
      testedBefore: false,
    },
    isNewStepOnly: false,
    step,
  };
}

afterEach(() => {
  window.api.initialSetupState = undefined;
  rpc.answer.mockClear();
  rpc.back.mockClear();
  rpc.finish.mockClear();
});

describe("SetupHost", () => {
  it("draws the step it loaded on, and holds the window with no close", () => {
    loadedWith("choose-ai");
    renderWithDefaultStore(<SetupHost />);
    expect(screen.getByRole("heading").textContent).toBe("choose-ai");
    const holds = getDefaultStore().get(windowHoldsAtom);
    expect(holds).toHaveLength(1);
    expect(holds[0]?.close).toBeUndefined();
  });

  it("answers the step on Continue", async () => {
    loadedWith("plan");
    renderWithDefaultStore(<SetupHost />);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await vi.waitFor(() => {
      expect(rpc.answer.mock.calls[0]?.[0]).toEqual({ step: "plan" });
    });
  });

  it("offers Back only where there is a step to go back to", async () => {
    loadedWith("plan");
    const { unmount } = renderWithDefaultStore(<SetupHost />);
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    unmount();
    loadedWith("plan", "welcome-back");
    renderWithDefaultStore(<SetupHost />);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await vi.waitFor(() => {
      expect(rpc.back.mock.calls[0]?.[0]).toEqual({ step: "plan" });
    });
  });

  it("finishes from All set after the last step, never only answering it", async () => {
    loadedWith("look");
    renderWithDefaultStore(<SetupHost />);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Open Instrument" }));
    await vi.waitFor(() => {
      expect(rpc.finish).toHaveBeenCalled();
    });
    expect(rpc.answer).not.toHaveBeenCalled();
  });

  it("finishes from the only step an update added", async () => {
    loadedWith("plan");
    const loaded = window.api.initialSetupState;
    if (!loaded) {
      throw new Error("loadedWith sets the state");
    }
    window.api.initialSetupState = { ...loaded, isNewStepOnly: true };
    renderWithDefaultStore(<SetupHost />);
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    await vi.waitFor(() => {
      expect(rpc.finish).toHaveBeenCalled();
    });
  });

  it("draws nothing and holds nothing when setup is down", () => {
    loadedWith(null);
    const { container } = renderWithDefaultStore(<SetupHost />);
    expect(container.textContent).toBe("");
    expect(getDefaultStore().get(windowHoldsAtom)).toHaveLength(0);
  });
});
