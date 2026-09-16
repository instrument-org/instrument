import { renderInBrowser } from "@/tests/render-browser";
import { StoreId, TaskIdSchema } from "@instrument-org/workspace/client";
import { describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { OrchestratorContext, type OrchestratorWindow } from "./context";
import { ThreadRow } from "./thread-row";
import { type Thread, type Topic } from "./threads";

const sessionId = StoreId.newSessionId();

/** A long ask, so the clamp has something to cut. */
const LONG_ASK =
  "Hey, I'm trying to set up an automation that uses some criteria to determine if the second floor nest thermostat goes into eco mode, and then it could either alert me or even turn it back off. But I need this to only happen if I'm at home at the time and it's earlier in the day than, like, let's say 5 p.m. or so. I think I already have an automation set up for this, but I don't know.";

/** The morning the fixture's thread began. */
const STARTED_AT = new Date(2026, 8, 16, 8, 46);

function thread(
  overrides: Partial<Thread> = {},
  ask = "Guard the Nest eco mode before 5 p.m.",
): Thread {
  const messageId = StoreId.newMessageId();
  return {
    createdAt: STARTED_AT.getTime(),
    holds: { apps: [], files: [], sites: [] },
    id: sessionId,
    lastReplyAt: new Date(2026, 8, 16, 9, 11).getTime(),
    latest: {
      at: new Date(2026, 8, 16, 9, 11).getTime(),
      kind: "reply",
      text: "Done: the automation now checks presence first.",
    },
    replyCount: 3,
    root: {
      id: messageId,
      metadata: { createdAt: STARTED_AT, sessionId },
      parts: [
        {
          metadata: {
            createdAt: STARTED_AT,
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
    titled: true,
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

const MONEY: Topic = {
  color: "#d4a017",
  createdAt: 2,
  emoji: "💸",
  id: "money",
  name: "Money",
};

/** The ask, which is the one line every row has. */
function askOf(row: HTMLElement) {
  const ask = row.querySelector<HTMLElement>(".line-clamp-2");
  if (!ask) {
    throw new Error("no ask");
  }
  return ask;
}

/** The gutter at the row's left, which is the thread's start time. */
function gutterOf(row: HTMLElement) {
  const gutter = row.firstElementChild;
  if (!(gutter instanceof HTMLElement)) {
    throw new TypeError("no gutter");
  }
  return gutter;
}

/** The lines hanging past the gutter, in order: the header when there is one, the ask, the replies line when there is one. */
function linesOf(row: HTMLElement) {
  return [...(row.children[1]?.children ?? [])].filter(
    (child): child is HTMLElement => child instanceof HTMLElement,
  );
}

/** The marks of what the thread holds, at the replies line's end. */
function marksOf(row: HTMLElement) {
  return [...repliesLineOf(row).querySelectorAll("button")];
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

/** What the replies line says, its parts in order. */
function partsOf(line: HTMLElement) {
  return [...line.querySelectorAll(":scope > span")]
    .filter((span) => span.getClientRects().length > 0)
    .map((span) => span.textContent);
}

async function renderRow(
  row: Thread,
  {
    onOpen = vi.fn(),
    onSetTopics = vi.fn(),
    openScreen = vi.fn(),
    width = 400,
  } = {},
) {
  const rendered = await renderInBrowser(
    <OrchestratorContext value={paneWindow(openScreen)}>
      <div style={{ width: `${width}px` }}>
        <ThreadRow
          appsBySlug={
            new Map([
              ["github", { name: "GitHub", site: "https://github.com" }],
            ])
          }
          onNewTopic={vi.fn()}
          onOpen={onOpen}
          onSetTopics={onSetTopics}
          thread={row}
          topics={[HOUSE, MONEY]}
        />
      </div>
    </OrchestratorContext>,
  );
  const rowElement =
    rendered.container.querySelector<HTMLElement>('[role="button"]');
  if (!rowElement) {
    throw new Error("no row");
  }
  return { ...rendered, onOpen, onSetTopics, openScreen, row: rowElement };
}

/** The replies line: the last line of a row that has one. */
function repliesLineOf(row: HTMLElement) {
  const line = linesOf(row).at(-1);
  if (!line || line.querySelector(".line-clamp-2")) {
    throw new Error("no replies line");
  }
  return line;
}

describe("ThreadRow", () => {
  it("starts with the time in a gutter and hangs every line off one edge past it", async () => {
    const { row } = await renderRow(thread({ topics: ["house"] }));
    const gutter = gutterOf(row);
    expect(gutter.textContent).toBe("8:46 AM");
    const lines = linesOf(row);
    const [header, ask, replies] = lines;
    if (!header || !ask || !replies || lines.length !== 3) {
      throw new Error("the row is short a line");
    }
    const edge = header.getBoundingClientRect().left;
    expect(edge).toBeGreaterThan(gutter.getBoundingClientRect().right);
    for (const line of lines) {
      expect(line.getBoundingClientRect().left).toBe(edge);
    }
    // The gutter's time shares the first line.
    expect(gutter.getBoundingClientRect().top).toBe(
      header.getBoundingClientRect().top,
    );
    expect(header.textContent).toContain("House");
    expect(header.textContent).toContain("·");
    expect(header.textContent).toContain("Second-floor Nest");
    expect(header.textContent).not.toContain("8:46 AM");
    expect(askOf(row).textContent).toBe(
      "Guard the Nest eco mode before 5 p.m.",
    );
    expect(row.textContent).not.toContain("View thread");
    expect(row.textContent).not.toContain("last reply");
  });

  it("leaves the title off until the agent has given the thread one", async () => {
    const { row } = await renderRow(thread({ titled: false }));
    const [first] = linesOf(row);
    expect(first?.textContent).toBe("Guard the Nest eco mode before 5 p.m.");
    expect(row.textContent).not.toContain("Second-floor Nest");
    expect(linesOf(row)).toHaveLength(2);
    // The ask is the first line, so the gutter shares its line and the tag
    // control keeps its end.
    expect(gutterOf(row).getBoundingClientRect().top).toBe(
      first?.getBoundingClientRect().top,
    );
    expect(first?.querySelector('[aria-label="Topics"]')).not.toBeNull();
  });

  it("keeps the pills alone on the header of an untitled thread, with no dot", async () => {
    const { row } = await renderRow(
      thread({ titled: false, topics: ["house"] }),
    );
    const [header] = linesOf(row);
    expect(header?.textContent).toBe("🏠House");
    expect(linesOf(row)).toHaveLength(3);
  });

  it("says the time of day whatever the day, since the head above carries the date", async () => {
    const { row } = await renderRow(
      thread({ createdAt: new Date(2026, 8, 10, 8, 46).getTime() }),
    );
    expect(gutterOf(row).textContent).toBe("8:46 AM");
  });

  it("leaves out the dot when the thread has no topic", async () => {
    const { row } = await renderRow(thread());
    const header = linesOf(row)[0];
    expect(header?.textContent).not.toContain("·");
    expect(header?.textContent).toContain("Second-floor Nest");
  });

  it("keeps a topic pill within the header line", async () => {
    const { row } = await renderRow(thread({ topics: ["house"] }));
    const header = linesOf(row)[0];
    const pill = header?.querySelector("button");
    expect(pill?.getBoundingClientRect().height).toBeLessThanOrEqual(20);
    expect(header?.getBoundingClientRect().height).toBeLessThanOrEqual(20);
  });

  it("clamps a long ask to two lines and fades it", async () => {
    const { row } = await renderRow(thread({}, LONG_ASK));
    const ask = askOf(row);
    expect(ask.scrollHeight).toBeGreaterThan(ask.clientHeight);
    await vi.waitFor(() => {
      expect(ask.className).toContain("mask-b-from");
    });
  });

  it("puts the count, how long ago the last reply landed, then the peek on one line", async () => {
    const { row } = await renderRow(thread());
    const line = repliesLineOf(row);
    const parts = partsOf(line);
    expect(parts[0]).toBe("3 replies");
    expect(parts[1]).toMatch(/^\d+[mhd] ago$/);
    expect(parts[2]).toBe("Done: the automation now checks presence first.");
    // Read, the count keeps the text's own color and only its weight.
    expect(line.querySelector(".text-brand-600")).toBeNull();
    expect(line.querySelector(".font-medium")?.textContent).toBe("3 replies");
  });

  it("colors the count in brand only while there are unseen replies", async () => {
    const { row } = await renderRow(thread({ unread: 1 }));
    expect(
      repliesLineOf(row).querySelector(".text-brand-600")?.textContent,
    ).toBe("3 replies");
  });

  it("says how long ago the last reply landed whatever day it was", async () => {
    const day = 24 * 60 * 60_000;
    const { row } = await renderRow(
      thread({
        createdAt: Date.now() - 6 * day,
        lastReplyAt: Date.now() - 3 * day,
      }),
    );
    expect(partsOf(repliesLineOf(row))[1]).toMatch(/^3d ago$/);
  });

  it("marks unseen replies with a dot before the count and never a number", async () => {
    const { row } = await renderRow(thread({ unread: 2 }));
    const line = repliesLineOf(row);
    expect(line.querySelector('[aria-label="Unread"]')?.className).toContain(
      "bg-brand-500",
    );
    expect(line.firstElementChild?.getAttribute("aria-label")).toBe("Unread");
    expect(line.textContent).not.toContain("new");
    expect(line.textContent).not.toContain("2");
  });

  it("has no dot while every reply has been seen", async () => {
    const { row } = await renderRow(thread());
    expect(
      repliesLineOf(row).querySelector('[aria-label="Unread"]'),
    ).toBeNull();
  });

  it("truncates the peek to what the line has left", async () => {
    const { row } = await renderRow(
      thread({ latest: { at: Date.now(), kind: "reply", text: LONG_ASK } }),
      { width: 320 },
    );
    const line = repliesLineOf(row);
    const peek = line.querySelector(".truncate");
    expect(peek?.scrollWidth).toBeGreaterThan(peek?.clientWidth ?? 0);
    expect(line.scrollWidth).toBe(line.clientWidth);
  });

  it("counts one reply in the singular", async () => {
    const { row } = await renderRow(thread({ replyCount: 1 }));
    expect(partsOf(repliesLineOf(row))[0]).toBe("1 reply");
  });

  it("has no replies line at all for an idle thread with nothing to say", async () => {
    const { row } = await renderRow(
      thread({ lastReplyAt: undefined, latest: undefined, replyCount: 0 }),
    );
    expect(row.textContent).not.toContain("No replies");
    expect(linesOf(row)).toHaveLength(2);
  });

  it("shows only the peek before the first reply of a working thread", async () => {
    const { row } = await renderRow(
      thread({
        lastReplyAt: undefined,
        latest: undefined,
        replyCount: 0,
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
    const line = repliesLineOf(row);
    expect(partsOf(line)).toEqual(["Reading the automation"]);
    expect(line.querySelector(".brand-shiny-text")).not.toBeNull();
  });

  it("peeks at the question behind the amber glyph while waiting", async () => {
    const { container, row } = await renderRow(
      thread({
        latest: {
          at: Date.now(),
          kind: "question",
          text: "Reuse the old CSR, or generate a new one?",
        },
        state: "waiting",
      }),
    );
    const line = repliesLineOf(row);
    expect(partsOf(line).at(-1)).toBe(
      "Reuse the old CSR, or generate a new one?",
    );
    expect(line.querySelector("svg.text-warning-700")).not.toBeNull();
    expect(container.querySelector(".bg-warning-500")).toBeNull();
  });

  it("opens the thread from a click anywhere on it, and from Enter", async () => {
    const { onOpen, openScreen, row } = await renderRow(
      thread({ topics: ["house"] }),
    );
    row.click();
    gutterOf(row).click();
    askOf(row).click();
    linesOf(row)[0]?.click();
    repliesLineOf(row).click();
    expect(onOpen).toHaveBeenCalledTimes(5);
    row.focus();
    await userEvent.keyboard("{Enter}");
    expect(onOpen).toHaveBeenCalledTimes(6);
    expect(openScreen).not.toHaveBeenCalled();
  });

  it("asks the window for a place of its own on a middle or a modified click", async () => {
    const { onOpen, openScreen, row } = await renderRow(thread());
    askOf(row).dispatchEvent(
      new MouseEvent("auxclick", { bubbles: true, button: 1 }),
    );
    expect(openScreen).toHaveBeenCalledWith(
      `/orchestrator/threads/${sessionId}`,
    );
    askOf(row).dispatchEvent(
      new MouseEvent("click", { bubbles: true, metaKey: true }),
    );
    expect(openScreen).toHaveBeenCalledTimes(2);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("wears the hover ground across the whole row, and puts the tag control in front then", async () => {
    const { row } = await renderRow(thread({ topics: ["house"] }));
    const control = row.querySelector<HTMLElement>('[aria-label="Topics"]');
    if (!control) {
      throw new Error("no tag control");
    }
    // Out of the flow at rest: it takes no room until the pointer arrives.
    expect(control.getClientRects().length).toBe(0);
    const marksBefore = repliesLineOf(row).getBoundingClientRect();
    const pillBefore = linesOf(row)[0]
      ?.querySelector("button:not([aria-label])")
      ?.getBoundingClientRect();
    await userEvent.hover(gutterOf(row));
    await vi.waitFor(() => {
      expect(control.getClientRects().length).toBeGreaterThan(0);
    });
    // In front of the pills, which move over to make room for it.
    const pillAfter = linesOf(row)[0]
      ?.querySelector("button:not([aria-label])")
      ?.getBoundingClientRect();
    expect(control.getBoundingClientRect().right).toBeLessThanOrEqual(
      pillAfter?.left ?? 0,
    );
    expect(pillAfter?.left ?? 0).toBeGreaterThan(pillBefore?.left ?? 0);
    expect(getComputedStyle(row).backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
    expect(row.getBoundingClientRect().left).toBeLessThan(
      gutterOf(row).getBoundingClientRect().left,
    );
    // Nothing on the replies line moves with the pointer.
    expect(repliesLineOf(row).getBoundingClientRect()).toEqual(marksBefore);
    // The pointer stays where it was left, and the next test's row renders
    // under it.
    await userEvent.unhover(gutterOf(row));
  });

  it("carries the holds as marks at the line's end, sites as favicons among them, the rest behind a count", async () => {
    const { row } = await renderRow(
      thread({
        holds: {
          apps: ["github"],
          files: ["/task/out/report.md", "/task/out/data.csv"],
          sites: ["wakatime.com", "example.com", "example.org", "example.net"],
        },
      }),
    );
    const marks = marksOf(row);
    // Five marks, then a count of the two that did not get one.
    expect(marks).toHaveLength(6);
    expect(marks.at(-1)?.textContent).toBe("+2");
    expect(
      marks.slice(3, 5).every((mark) => mark.querySelector("img, svg")),
    ).toBe(true);
    const line = repliesLineOf(row);
    expect(line.textContent).not.toContain("report.md");
    expect(line.textContent).not.toContain("wakatime.com");
    const peek = line.querySelector(".flex-1");
    expect(peek?.getBoundingClientRect().right).toBeLessThanOrEqual(
      marks[0]?.getBoundingClientRect().left ?? 0,
    );
  });

  it("names a mark by the file's name, never its path", async () => {
    const { row } = await renderRow(
      thread({
        holds: { apps: [], files: ["/task/out/report.md"], sites: [] },
      }),
    );
    const [file] = marksOf(row);
    if (!file) {
      throw new Error("no mark");
    }
    await userEvent.hover(file);
    await expect
      .element(page.getByRole("tooltip"))
      .toHaveTextContent("report.md");
    expect(page.getByRole("tooltip").element().textContent).not.toContain(
      "/task",
    );
    await userEvent.unhover(file);
  });

  it("lists every hold by name behind the count", async () => {
    const files = Array.from(
      { length: 6 },
      (_, index) => `/task/out/report-${index}.md`,
    );
    const { row } = await renderRow(
      thread({ holds: { apps: ["github"], files, sites: ["wakatime.com"] } }),
    );
    const count = marksOf(row).at(-1);
    if (!count) {
      throw new Error("no count");
    }
    await userEvent.click(count);
    const list = page.getByRole("dialog");
    await expect.element(list).toBeVisible();
    const names = [...list.element().querySelectorAll("button")].map(
      (entry) => entry.textContent,
    );
    // The app by its name and the files by theirs, newest first, never a
    // slug or a path.
    expect(names).toEqual([
      "GitHub",
      ...files.toReversed().map((path) => path.split("/").at(-1)),
      "wakatime.com",
    ]);
    await userEvent.keyboard("{Escape}");
  });

  it("opens a hold in place, or in a tab of its own on a middle click, never the thread", async () => {
    const { onOpen, openScreen, row } = await renderRow(
      thread({ holds: { apps: ["github"], files: [], sites: [] } }),
    );
    const [app] = marksOf(row);
    app?.click();
    expect(openScreen).toHaveBeenCalledWith("/orchestrator/apps/github");
    app?.dispatchEvent(
      new MouseEvent("auxclick", { bubbles: true, button: 1 }),
    );
    expect(openScreen).toHaveBeenCalledTimes(2);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("opens the thread's topic list from a pill, which files the thread rather than opening it", async () => {
    const { onOpen, onSetTopics, row } = await renderRow(
      thread({ topics: ["house"] }),
    );
    const pill = linesOf(row)[0]?.querySelector("button");
    if (!pill) {
      throw new Error("no pill");
    }
    await userEvent.click(pill);
    const list = page.getByRole("menu");
    await expect.element(list).toBeVisible();
    await userEvent.click(list.getByText("Money"));
    expect(onSetTopics).toHaveBeenCalledWith(["house", "money"]);
    expect(onOpen).not.toHaveBeenCalled();
    await userEvent.keyboard("{Escape}");
  });

  it("opens the same list from the tag control, without opening the thread", async () => {
    const { onOpen, onSetTopics, row } = await renderRow(thread());
    const control = row.querySelector<HTMLElement>('[aria-label="Topics"]');
    if (!control) {
      throw new Error("no tag control");
    }
    await userEvent.click(control);
    const list = page.getByRole("menu");
    await expect.element(list).toBeVisible();
    await userEvent.click(list.getByText("House"));
    expect(onSetTopics).toHaveBeenCalledWith(["house"]);
    expect(onOpen).not.toHaveBeenCalled();
    await userEvent.keyboard("{Escape}");
  });
});
