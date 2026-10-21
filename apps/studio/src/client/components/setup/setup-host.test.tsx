import { windowHoldsAtom } from "@/client/atoms/tab-navigation-block";
import { type SetupState } from "@/shared/setup";
import { renderWithDefaultStore } from "@/tests/render";
import { fireEvent, screen } from "@testing-library/react";
import { getDefaultStore } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SetupHost } from "./setup-host";

// Setup's toaster reads the theme, which is not under test.
vi.mock("@/client/components/ui/sonner", () => ({ Toaster: () => null }));

const rpc = vi.hoisted(() => ({ answer: vi.fn(), finish: vi.fn() }));

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
        finish: mutation(rpc.finish),
        live: { state: live("setup") },
      },
      utils: {
        closeWindow: mutation(() => {}),
        live: { windowState: live("windowState", { maximized: false }) },
        minimizeWindow: mutation(() => {}),
        toggleMaximizeWindow: mutation(() => {}),
      },
    },
  };
});

function loadedWith(step: SetupState["step"]) {
  window.api.initialSetupState = {
    facts: {
      folderSettled: true,
      hasInstrumentAccount: false,
      hasInstrumentPlan: false,
      hasUsableAI: false,
      notificationsAskable: false,
      usedBefore: false,
    },
    isNewStepOnly: false,
    step,
  };
}

afterEach(() => {
  window.api.initialSetupState = undefined;
  rpc.answer.mockClear();
  rpc.finish.mockClear();
});

describe("SetupHost", () => {
  it("draws the step it loaded on, and holds the window with no close", () => {
    loadedWith("way-in");
    renderWithDefaultStore(<SetupHost />);
    expect(screen.getByRole("heading").textContent).toBe("way-in");
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

  it("finishes on the last step", async () => {
    loadedWith("look");
    renderWithDefaultStore(<SetupHost />);
    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
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
