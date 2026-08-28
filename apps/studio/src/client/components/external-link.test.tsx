// Which of the two anchors a link becomes, which is a routing decision rather
// than a measured one -- the menu's own placement is asserted in
// `task-external-link.browser.test.tsx`, where there is a layout to measure.
import { TaskSessionProvider } from "@/client/hooks/use-task-session";
import { renderWithProviders } from "@/tests/render";
import { StoreId, TaskIdSchema } from "@instrument-org/workspace/client";
import { fireEvent, screen } from "@testing-library/react";
import { type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ExternalLink } from "./external-link";

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

const inTask = (children: ReactNode) => (
  <TaskSessionProvider sessionId={SESSION_ID} taskId={TASK_ID}>
    {children}
  </TaskSessionProvider>
);

beforeEach(() => {
  openInTaskBrowser.mockClear();
  openExternalLink.mockClear();
});

describe("ExternalLink", () => {
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
