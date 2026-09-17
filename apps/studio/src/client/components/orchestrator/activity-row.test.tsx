// Which gesture opens where: the row is a door that opens in place, and only
// a modified or middle click asks for a tab of its own.
import { renderWithProviders } from "@/tests/render";
import { StoreId, TaskIdSchema } from "@instrument-org/workspace/client";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { type ActivityRow as Row, type Visit } from "./activity";
import { ActivityRow, ThreadHeadRow } from "./activity-row";
import { OrchestratorContext, type OrchestratorWindow } from "./context";
import { type Topic } from "./threads";

vi.mock("@/client/hooks/use-open-in-task-browser", () => ({
  useOpenInTaskBrowser: () => vi.fn(),
}));

vi.mock("@/client/hooks/use-open-external-link", () => ({
  useOpenExternalLink: () => vi.fn(),
}));

const THREAD = StoreId.SessionSchema.parse("ses_01ARZ3NDEKTSV4RRFFQ69G5FAV");
const THREAD_HREF = `/orchestrator/threads/${THREAD}`;
const NOON = Date.UTC(2026, 8, 16, 12, 0);

const REPLIED: Row = {
  at: NOON,
  entry: {
    at: NOON,
    id: `${THREAD}:msg:replied`,
    kind: "replied",
    text: "Done",
    thread: { id: THREAD, title: "Groceries", topics: [] },
  },
  id: "r",
  kind: "entry",
};

function file(name: string): Visit {
  return {
    at: NOON,
    kind: "file",
    target: { href: fileHref(name), kind: "screen" },
    title: name,
  };
}

function fileHref(name: string) {
  return `/orchestrator/computer?file=/Users/sam/${name}`;
}

const HOME: Topic = {
  createdAt: NOON,
  emoji: "🏠",
  id: "top_home",
  name: "Home",
};

function renderInWindow(ui: React.ReactNode) {
  const openScreen = vi.fn();
  const context = {
    ask: vi.fn(),
    browser: null,
    focusComposer: vi.fn(),
    openPage: vi.fn(),
    openPath: vi.fn(),
    openScreen,
    taskId: TaskIdSchema.parse("orchestrator"),
  } satisfies OrchestratorWindow;
  renderWithProviders(
    <OrchestratorContext value={context}>{ui}</OrchestratorContext>,
  );
  return { openScreen };
}

function renderRow(row: Row, onOpened?: () => void) {
  return renderInWindow(
    <ActivityRow
      appsBySlug={new Map()}
      {...(onOpened ? { onOpened } : {})}
      row={row}
    />,
  );
}

describe("ActivityRow", () => {
  it("opens its thread in place on a plain click, and says so", () => {
    const onOpened = vi.fn();
    const { openScreen } = renderRow(REPLIED, onOpened);
    fireEvent.click(screen.getByRole("button", { name: /Replied/ }));
    expect(openScreen).toHaveBeenCalledWith(THREAD_HREF);
    expect(onOpened).toHaveBeenCalledOnce();
  });

  it("asks for a tab of its own on a command click", () => {
    const { openScreen } = renderRow(REPLIED);
    fireEvent.click(screen.getByRole("button", { name: /Replied/ }), {
      metaKey: true,
    });
    expect(openScreen).toHaveBeenCalledWith(THREAD_HREF, { newTab: true });
  });

  it("asks for a tab of its own on a middle click", () => {
    const onOpened = vi.fn();
    const { openScreen } = renderRow(REPLIED, onOpened);
    fireEvent(
      screen.getByRole("button", { name: /Replied/ }),
      new MouseEvent("auxclick", {
        bubbles: true,
        button: 1,
        cancelable: true,
      }),
    );
    expect(openScreen).toHaveBeenCalledWith(THREAD_HREF, { newTab: true });
    expect(onOpened).toHaveBeenCalledOnce();
  });

  it("opens a named visit from its chip, and the row's newest visit from the rest of the row", () => {
    const { openScreen } = renderRow({
      at: NOON,
      id: "l",
      kind: "looked",
      visits: [file("a.md"), file("b.md")],
    });
    fireEvent.click(screen.getByRole("button", { name: "b.md" }));
    expect(openScreen).toHaveBeenCalledExactlyOnceWith(fileHref("b.md"));
    fireEvent.click(screen.getByRole("button", { name: /You looked at/ }));
    expect(openScreen).toHaveBeenLastCalledWith(fileHref("a.md"));
  });
});

describe("ThreadHeadRow", () => {
  function renderHead(onOpened?: () => void) {
    return renderInWindow(
      <ThreadHeadRow
        at={NOON}
        {...(onOpened ? { onOpened } : {})}
        thread={{ id: THREAD, title: "Groceries", topics: [HOME.id] }}
        topicsById={new Map([[HOME.id, HOME]])}
      />,
    );
  }

  it("names the thread with its topics as readable pills", () => {
    renderHead();
    const head = screen.getByRole("button", { name: /Groceries/ });
    expect(head.textContent).toContain("🏠Home");
  });

  it("opens the thread in place on a plain click, and says so", () => {
    const onOpened = vi.fn();
    const { openScreen } = renderHead(onOpened);
    fireEvent.click(screen.getByRole("button", { name: /Groceries/ }));
    expect(openScreen).toHaveBeenCalledExactlyOnceWith(THREAD_HREF);
    expect(onOpened).toHaveBeenCalledOnce();
  });

  it("asks for a tab of its own on a command click", () => {
    const { openScreen } = renderHead();
    fireEvent.click(screen.getByRole("button", { name: /Groceries/ }), {
      metaKey: true,
    });
    expect(openScreen).toHaveBeenCalledWith(THREAD_HREF, { newTab: true });
  });
});
