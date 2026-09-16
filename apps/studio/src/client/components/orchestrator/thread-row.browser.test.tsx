import { renderInBrowser } from "@/tests/render-browser";
import { StoreId, TaskIdSchema } from "@instrument-org/workspace/client";
import { describe, expect, it, vi } from "vitest";

import { OrchestratorContext, type OrchestratorWindow } from "./context";
import { ThreadRow } from "./thread-row";
import { type Thread, type Topic } from "./threads";

const sessionId = StoreId.newSessionId();

/** A long ask, so the clamp has something to cut. */
const LONG_ASK =
  "Hey, I'm trying to set up an automation that uses some criteria to determine if the second floor nest thermostat goes into eco mode, and then it could either alert me or even turn it back off. But I need this to only happen if I'm at home at the time and it's earlier in the day than, like, let's say 5 p.m. or so. I think I already have an automation set up for this, but I don't know.";

function thread(
  overrides: Partial<Thread> = {},
  ask = "Guard the Nest eco mode before 5 p.m.",
): Thread {
  const messageId = StoreId.newMessageId();
  return {
    createdAt: new Date(2026, 8, 16, 8, 46).getTime(),
    holds: { apps: [], files: [], sites: [] },
    id: sessionId,
    replyCount: 3,
    root: {
      id: messageId,
      metadata: { createdAt: new Date(2026, 8, 16, 8, 46), sessionId },
      parts: [
        {
          metadata: {
            createdAt: new Date(2026, 8, 16, 8, 46),
            id: StoreId.newPartId(),
            messageId,
            sessionId,
          },
          text: ask,
          type: "text",
        },
      ],
      role: "user",
    },
    runningTasks: [],
    state: "idle",
    title: "Second-floor Nest eco mode guard before 5 p.m.",
    topics: [],
    unread: 0,
    updatedAt: new Date(2026, 8, 16, 9, 11).getTime(),
    ...overrides,
  };
}

const HOUSE: Topic = {
  color: "#0f9d6e",
  createdAt: 1,
  emoji: "🏠",
  id: "house",
  name: "House",
};

/** The row's lines, in order: the header, the ask, the latest, the foot. */
function linesOf(row: HTMLElement) {
  return [...row.children].filter(
    (child): child is HTMLElement =>
      child instanceof HTMLElement && !child.className.includes("absolute"),
  );
}

/** The window the pane sits in, as far as a row can tell: every opener lands in a tab of its own. */
function paneWindow(openScreen = vi.fn()): OrchestratorWindow {
  return {
    ask: vi.fn(),
    browser: null,
    focusComposer: vi.fn(),
    openPage: vi.fn(),
    openScreen,
    opensNewTab: true,
    taskId: TaskIdSchema.parse("orchestrator"),
  };
}

async function renderRow(
  row: Thread,
  { onOpen = vi.fn(), openScreen = vi.fn(), width = 400 } = {},
) {
  const rendered = await renderInBrowser(
    <OrchestratorContext value={paneWindow(openScreen)}>
      <div style={{ width: `${width}px` }}>
        <ThreadRow
          appsBySlug={new Map()}
          onNewTopic={vi.fn()}
          onOpen={onOpen}
          onSetTopics={vi.fn()}
          thread={row}
          topics={[HOUSE]}
        />
      </div>
    </OrchestratorContext>,
  );
  const rowElement =
    rendered.container.querySelector<HTMLElement>('[role="button"]');
  if (!rowElement) {
    throw new Error("no row");
  }
  return { ...rendered, onOpen, openScreen, row: rowElement };
}

describe("ThreadRow", () => {
  it("gives the title the header line and puts the count and the holds at the foot", async () => {
    const { row } = await renderRow(
      thread({
        holds: {
          apps: ["github", "wakatime"],
          files: ["/task/out/report.md", "/task/out/data.csv", "/task/a.json"],
          sites: ["github.com", "wakatime.com"],
        },
        topics: ["house"],
      }),
    );
    const lines = linesOf(row);
    const header = lines[0];
    const foot = lines[3];
    if (!header || !foot) {
      throw new Error("the row is short a line");
    }
    const title = header.querySelector("span.truncate");
    // The title has the line to itself but the time and the marks, so it is
    // most of the row rather than a few letters before an ellipsis.
    expect(title?.getBoundingClientRect().width).toBeGreaterThan(
      row.clientWidth / 2,
    );
    expect(header.textContent).not.toContain("replies");
    expect(header.textContent).not.toContain("report.md");
    expect(foot.textContent).toContain("3 replies");
    expect(foot.textContent).toContain("report.md");
    expect(row.textContent).not.toContain("last reply");
  });

  it("clips the holds at the edge and counts the rest", async () => {
    const files = Array.from(
      { length: 12 },
      (_, index) => `/task/out/a-long-report-name-${index}.md`,
    );
    const { row } = await renderRow(
      thread({ holds: { apps: [], files, sites: [] } }),
      { width: 320 },
    );
    const foot = linesOf(row).at(-1);
    await vi.waitFor(() => {
      // The visible count, not the widest one the measuring row lays out.
      const more = [...(foot?.querySelectorAll("button") ?? [])].find(
        (button) =>
          !button.closest("[aria-hidden]") &&
          /^\+\d+$/.test(button.textContent),
      );
      expect(more).toBeDefined();
      const shown = files.length - Number(more?.textContent.slice(1));
      expect(shown).toBeGreaterThan(0);
      expect(shown).toBeLessThan(files.length);
    });
  });

  it("clamps a long ask to two lines and fades it", async () => {
    const { container } = await renderRow(thread({}, LONG_ASK));
    const ask = container.querySelector(".line-clamp-2");
    if (!ask) {
      throw new Error("no ask");
    }
    expect(ask.scrollHeight).toBeGreaterThan(ask.clientHeight);
    await vi.waitFor(() => {
      expect(ask.className).toContain("mask-b-from");
    });
  });

  it("says where a waiting thread stands in warning, with the question as its peer line", async () => {
    const { container } = await renderRow(
      thread({
        latest: {
          at: Date.now(),
          kind: "question",
          text: "Reuse the old CSR, or generate a new one?",
        },
        state: "waiting",
      }),
    );
    expect(container.textContent).toContain("Needs you");
    expect(container.textContent).toContain("Reuse the old CSR");
    expect(container.querySelector(".bg-warning-500")).not.toBeNull();
    expect(container.querySelector(".bg-brand-500")).toBeNull();
  });

  it("counts unseen replies in brand and marks the row with a dot", async () => {
    const { container } = await renderRow(thread({ unread: 2 }));
    expect(container.textContent).toContain("2 new");
    expect(container.querySelector(".bg-brand-500")).not.toBeNull();
  });

  it("writes a working thread's step with the traveling highlight", async () => {
    const { container } = await renderRow(
      thread({
        runningTasks: [
          {
            id: TaskIdSchema.parse("nest-guard"),
            step: "Reading the automation",
            title: "Nest guard",
          },
        ],
        state: "working",
      }),
    );
    expect(container.querySelector(".brand-shiny-text")?.textContent).toBe(
      "Reading the automation",
    );
  });

  it("opens in place on a plain click anywhere but the control at its edge", async () => {
    const { container, onOpen, openScreen } = await renderRow(thread());
    const ask = container.querySelector<HTMLElement>(".line-clamp-2");
    ask?.click();
    expect(onOpen).toHaveBeenCalledTimes(1);
    container.querySelector<HTMLElement>('[aria-label="Topics"]')?.click();
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[aria-label="Open thread"]')).toBeNull();
    expect(openScreen).not.toHaveBeenCalled();
  });

  it("asks the window for a place of its own on a middle or a modified click", async () => {
    const { onOpen, openScreen, row } = await renderRow(thread());
    row.dispatchEvent(new MouseEvent("auxclick", { bubbles: true, button: 1 }));
    expect(openScreen).toHaveBeenCalledWith(
      `/orchestrator/threads/${sessionId}`,
    );
    row.dispatchEvent(
      new MouseEvent("click", { bubbles: true, metaKey: true }),
    );
    expect(openScreen).toHaveBeenCalledTimes(2);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("keeps a click on a hold from opening the thread", async () => {
    const { onOpen, row } = await renderRow(
      thread({
        holds: { apps: [], files: ["/task/out/report.md"], sites: [] },
      }),
    );
    const tile = [...row.querySelectorAll("button")].find((button) =>
      button.textContent.includes("report.md"),
    );
    tile?.click();
    expect(onOpen).not.toHaveBeenCalled();
  });
});
