// Which of the two a skill's link becomes, which is a routing decision: a
// screen of the 2.0 window's pane where the window can open one, and the
// classic window's route everywhere else.
import { renderWithProviders } from "@/tests/render";
import { installWindowStubs } from "@/tests/window-stubs";
import { StoreId, TaskIdSchema } from "@instrument-org/workspace/client";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from "@tanstack/react-router";
import { fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  OrchestratorContext,
  type OrchestratorWindow,
} from "./orchestrator/context";
import { SkillLink } from "./skill-link";

vi.mock("@/client/hooks/use-open-in-task-browser", () => ({
  useOpenInTaskBrowser: () => vi.fn(),
}));

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

  it("opens the skill as a screen of the pane inside the 2.0 window", () => {
    const openScreen = vi.fn();
    const context = {
      ask: vi.fn(),
      browser: null,
      focusComposer: vi.fn(),
      openPage: vi.fn(),
      openPath: vi.fn(),
      openScreen,
      sessionId: StoreId.newSessionId(),
      taskId: TaskIdSchema.parse("orchestrator"),
    } satisfies OrchestratorWindow;
    renderWithProviders(
      <OrchestratorContext value={context}>{link}</OrchestratorContext>,
    );
    const button = screen.getByRole("button", { name: "create-page" });
    fireEvent.click(button);
    expect(openScreen).toHaveBeenCalledWith("/orchestrator/skills/create-page");
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("is the classic window's route outside it", () => {
    // The classic link reads the router off context; one that routes nothing
    // is enough for the href it draws.
    const router = createRouter({
      history: createMemoryHistory({ initialEntries: ["/"] }),
      routeTree: createRootRoute(),
    });
    renderWithProviders(
      <RouterContextProvider router={router}>{link}</RouterContextProvider>,
    );
    expect(
      screen.getByRole("link", { name: "create-page" }).getAttribute("href"),
    ).toBe("/skills/create-page");
  });
});
