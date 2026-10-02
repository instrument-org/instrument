// What a skill's link becomes: a screen of the window's pane where the window
// can open one, and the name alone everywhere else.
import { renderWithProviders } from "@/tests/render";
import { installWindowStubs } from "@/tests/window-stubs";
import { StoreId } from "@instrument-org/workspace/client";
import { fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SkillLink } from "./skill-link";
import { WindowContext, type WindowContextValue } from "./window/context";

vi.mock("@/client/hooks/use-open-external-link", () => ({
  useOpenExternalLink: () => vi.fn(),
}));

const link = <SkillLink name="create-page">create-page</SkillLink>;

describe("SkillLink", () => {
  beforeEach(() => {
    installWindowStubs();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("opens the skill as a screen of the pane inside the app window", () => {
    const openScreen = vi.fn();
    const context = {
      ask: vi.fn(),
      browser: null,
      focusComposer: vi.fn(),
      openPage: vi.fn(),
      openPath: vi.fn(),
      openScreen,
      sessionId: StoreId.newSessionId(),
    } satisfies WindowContextValue;
    renderWithProviders(<WindowContext value={context}>{link}</WindowContext>);
    const button = screen.getByRole("button", { name: "create-page" });
    fireEvent.click(button);
    expect(openScreen).toHaveBeenCalledWith("/skills/create-page");
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("is the name alone where no screen can be opened", () => {
    renderWithProviders(link);
    expect(screen.getByText("create-page").tagName).toBe("SPAN");
    expect(screen.queryByRole("button")).toBeNull();
  });
});
