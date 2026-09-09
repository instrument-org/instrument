// Which of the two anchors a link becomes, which is a routing decision rather
// than a measured one -- the menu's own placement is asserted in
// `task-external-link.browser.test.tsx`, where there is a layout to measure.
import { TaskSessionProvider } from "@/client/hooks/use-task-session";
import { renderWithProviders } from "@/tests/render";
import { installWindowStubs } from "@/tests/window-stubs";
import { StoreId, TaskIdSchema } from "@instrument-org/workspace/client";
import { fireEvent, screen } from "@testing-library/react";
import { type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ExternalLink } from "./external-link";
import {
  OrchestratorContext,
  type OrchestratorWindow,
} from "./orchestrator/context";

const openInTaskBrowser = vi.fn();
const openExternalLink = vi.fn();

vi.mock("@/client/hooks/use-open-in-task-browser", () => ({
  useOpenInTaskBrowser: () => openInTaskBrowser,
}));

vi.mock("@/client/hooks/use-open-external-link", () => ({
  useOpenExternalLink: () => openExternalLink,
}));

const TASK_ID = TaskIdSchema.parse("a-task");
const SESSION_ID = StoreId.newSessionId();

function inOrchestrator(
  children: ReactNode,
  surface?: Partial<OrchestratorWindow>,
) {
  const openPage = vi.fn();
  const browserOpen = vi.fn();
  const context = {
    ask: vi.fn(),
    browser: {
      canGoBack: false,
      canGoForward: false,
      goBack: vi.fn(),
      goForward: vi.fn(),
      navigate: vi.fn(),
      open: browserOpen,
      openOrFocus: vi.fn(),
      readPage: vi.fn(),
    },
    focusComposer: vi.fn(),
    openPage,
    openScreen: vi.fn(),
    sessionId: SESSION_ID,
    taskId: TASK_ID,
    ...surface,
  } satisfies OrchestratorWindow;
  return {
    browserOpen,
    element: (
      <OrchestratorContext value={context}>
        {inTask(children)}
      </OrchestratorContext>
    ),
    openPage,
  };
}

function inTask(children: ReactNode) {
  return (
    <TaskSessionProvider sessionId={SESSION_ID} taskId={TASK_ID}>
      {children}
    </TaskSessionProvider>
  );
}

/** The platform the link reads its modifier off, for the length of one test. */
function onPlatform(platform: string) {
  Object.defineProperty(window, "electron", {
    configurable: true,
    value: { process: { platform } },
  });
}

beforeEach(() => {
  openInTaskBrowser.mockClear();
  openExternalLink.mockClear();
});

// Back to the machine the suite says it is on, for whatever a test set it to.
afterEach(installWindowStubs);

describe("ExternalLink", () => {
  it("uses the surface opener for Open in Instrument instead of bypassing it", () => {
    const { browserOpen, element } = inOrchestrator(
      <ExternalLink href="https://example.com/page">A page</ExternalLink>,
    );
    renderWithProviders(element);
    fireEvent.click(screen.getByText("A page"));
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Open in Instrument" }),
    );
    expect(openInTaskBrowser).toHaveBeenCalledWith("https://example.com/page");
    expect(browserOpen).not.toHaveBeenCalled();
  });

  // One modifier, the one the platform means a tab by.
  it.each([
    { modifier: "metaKey", platform: "darwin" },
    { modifier: "ctrlKey", platform: "win32" },
  ])("opens a separate tab on $modifier click on $platform", (each) => {
    onPlatform(each.platform);
    const { element, openPage } = inOrchestrator(
      <ExternalLink href="https://example.com/page">A page</ExternalLink>,
    );
    renderWithProviders(element);
    fireEvent.click(screen.getByText("A page"), { [each.modifier]: true });
    expect(openPage).toHaveBeenCalledWith("https://example.com/page", {
      newTab: true,
    });
    expect(openInTaskBrowser).not.toHaveBeenCalled();
  });

  // On macOS that chord is the secondary click, so it belongs to the menu.
  it("still asks on a ctrl click on macOS", () => {
    onPlatform("darwin");
    const { element, openPage } = inOrchestrator(
      <ExternalLink href="https://example.com/page">A page</ExternalLink>,
    );
    renderWithProviders(element);
    fireEvent.click(screen.getByText("A page"), { ctrlKey: true });
    expect(openPage).not.toHaveBeenCalled();
    expect(
      screen.getByRole("menuitem", { name: "Open in Instrument" }),
    ).toBeTruthy();
  });

  // Left alone, Chromium answers this one by handing the address to the
  // window, which sends it out to the OS browser.
  it("opens a separate tab on a middle click", () => {
    const { element, openPage } = inOrchestrator(
      <ExternalLink href="https://example.com/page">A page</ExternalLink>,
    );
    renderWithProviders(element);
    fireEvent(
      screen.getByText("A page"),
      new MouseEvent("auxclick", {
        bubbles: true,
        button: 1,
        cancelable: true,
      }),
    );
    expect(openPage).toHaveBeenCalledWith("https://example.com/page", {
      newTab: true,
    });
  });

  // Refusing the gesture and answering nothing would be a dead click where it
  // used to at least reach the OS browser.
  it("sends a middle click to the task's browser where there are no window tabs", () => {
    renderWithProviders(
      inTask(
        <ExternalLink href="https://example.com/page">A page</ExternalLink>,
      ),
    );
    const event = new MouseEvent("auxclick", {
      bubbles: true,
      button: 1,
      cancelable: true,
    });
    fireEvent(screen.getByText("A page"), event);
    expect(openInTaskBrowser).toHaveBeenCalledWith("https://example.com/page");
    expect(event.defaultPrevented).toBe(true);
  });

  it("offers an explicit new-tab action", () => {
    const { element, openPage } = inOrchestrator(
      <ExternalLink href="https://example.com/page">A page</ExternalLink>,
    );
    renderWithProviders(element);
    fireEvent.click(screen.getByText("A page"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Open in New Tab" }));
    expect(openPage).toHaveBeenCalledWith("https://example.com/page", {
      newTab: true,
    });
  });

  // Where the first row already makes a tab, a second one offering a tab is
  // the same destination written twice.
  it("offers no new-tab action where the surface opens one anyway", () => {
    const { element } = inOrchestrator(
      <ExternalLink href="https://example.com/page">A page</ExternalLink>,
      { opensNewTab: true },
    );
    renderWithProviders(element);
    fireEvent.click(screen.getByText("A page"));
    expect(
      screen.getByRole("menuitem", { name: "Open in Instrument" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("menuitem", { name: "Open in New Tab" }),
    ).toBeNull();
  });
  it("leaves for the OS browser outside a task, where there is nowhere else", () => {
    renderWithProviders(
      <ExternalLink href="https://example.com/page">A page</ExternalLink>,
    );

    fireEvent.click(screen.getByText("A page"));

    expect(openExternalLink).toHaveBeenCalledWith("https://example.com/page", {
      addReferral: true,
    });
  });

  // The click raises the menu instead of answering it, so nothing has been sent
  // anywhere by the time it returns. That is the whole behavior: a destination
  // chosen for the user is exactly what this replaces.
  it("asks rather than answers inside a task", () => {
    renderWithProviders(
      inTask(
        <ExternalLink href="https://example.com/page">A page</ExternalLink>,
      ),
    );

    fireEvent.click(screen.getByText("A page"));

    expect(openExternalLink).not.toHaveBeenCalled();
    expect(openInTaskBrowser).not.toHaveBeenCalled();
  });

  // A scheme the OS hands to an application has one destination wherever it is
  // clicked. Offering the task's browser for a `mailto:` would be offering to
  // open a page that does not exist.
  it("leaves for the OS handler inside a task when the link is not a web page", () => {
    renderWithProviders(
      inTask(
        <ExternalLink addReferral={false} href="mailto:someone@example.com">
          Email
        </ExternalLink>,
      ),
    );

    fireEvent.click(screen.getByText("Email"));

    expect(openExternalLink).toHaveBeenCalledWith(
      "mailto:someone@example.com",
      { addReferral: false },
    );
  });
});
