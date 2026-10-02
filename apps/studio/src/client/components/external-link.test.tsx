// Where each gesture over a link sends the page.
import { TaskSessionProvider } from "@/client/hooks/use-task-session";
import { renderWithProviders } from "@/tests/render";
import { installWindowStubs } from "@/tests/window-stubs";
import { StoreId, TaskIdSchema } from "@instrument-org/workspace/client";
import { fireEvent, screen } from "@testing-library/react";
import { type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ExternalLink } from "./external-link";
import { WindowContext, type WindowContextValue } from "./window/context";

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

function inTask(children: ReactNode) {
  return (
    <TaskSessionProvider sessionId={SESSION_ID} taskId={TASK_ID}>
      {children}
    </TaskSessionProvider>
  );
}

function inWindow(children: ReactNode, surface?: Partial<WindowContextValue>) {
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
      navigateTab: vi.fn(),
      open: browserOpen,
      openBehind: vi.fn(),
      openOrFocus: vi.fn(),
      pageInPlaceOf: vi.fn(),
      readPage: vi.fn(),
      restore: vi.fn(),
    },
    focusComposer: vi.fn(),
    openPage,
    openPath: vi.fn(),
    openScreen: vi.fn(),
    sessionId: SESSION_ID,
    taskId: TASK_ID,
    ...surface,
  } satisfies WindowContextValue;
  return {
    browserOpen,
    element: <WindowContext value={context}>{inTask(children)}</WindowContext>,
    openPage,
  };
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
  // No question in between: the click is the answer, and the app's own place
  // for the page is the one it gives.
  it("opens the page through the surface's opener on a plain click", () => {
    const { browserOpen, element } = inWindow(
      <ExternalLink href="https://example.com/page">A page</ExternalLink>,
    );
    renderWithProviders(element);
    fireEvent.click(screen.getByText("A page"));
    expect(openInTaskBrowser).toHaveBeenCalledWith("https://example.com/page");
    expect(browserOpen).not.toHaveBeenCalled();
    expect(openExternalLink).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  // One modifier, the one the platform means a tab by.
  it.each([
    { modifier: "metaKey", platform: "darwin" },
    { modifier: "ctrlKey", platform: "win32" },
  ])("opens a separate tab on $modifier click on $platform", (each) => {
    onPlatform(each.platform);
    const { element, openPage } = inWindow(
      <ExternalLink href="https://example.com/page">A page</ExternalLink>,
    );
    renderWithProviders(element);
    fireEvent.click(screen.getByText("A page"), { [each.modifier]: true });
    expect(openPage).toHaveBeenCalledWith("https://example.com/page", {
      behind: true,
      newTab: true,
    });
    expect(openInTaskBrowser).not.toHaveBeenCalled();
  });

  // On macOS that chord is the secondary click, so it is not asking for a tab.
  it("opens no tab on a ctrl click on macOS", () => {
    onPlatform("darwin");
    const { element, openPage } = inWindow(
      <ExternalLink href="https://example.com/page">A page</ExternalLink>,
    );
    renderWithProviders(element);
    fireEvent.click(screen.getByText("A page"), { ctrlKey: true });
    expect(openPage).not.toHaveBeenCalled();
  });

  // Left alone, Chromium answers this one by handing the address to the
  // window, which sends it out to the OS browser.
  it("opens a separate tab on a middle click", () => {
    const { element, openPage } = inWindow(
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
      behind: true,
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

  it("leaves for the OS browser outside a task, where there is nowhere else", () => {
    renderWithProviders(
      <ExternalLink href="https://example.com/page">A page</ExternalLink>,
    );

    fireEvent.click(screen.getByText("A page"));

    expect(openExternalLink).toHaveBeenCalledWith("https://example.com/page", {
      addReferral: true,
    });
  });

  it("keeps the page in the app inside a task", () => {
    renderWithProviders(
      inTask(
        <ExternalLink href="https://example.com/page">A page</ExternalLink>,
      ),
    );

    fireEvent.click(screen.getByText("A page"));

    expect(openInTaskBrowser).toHaveBeenCalledWith("https://example.com/page");
    expect(openExternalLink).not.toHaveBeenCalled();
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
