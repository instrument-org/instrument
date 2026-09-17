import { renderInBrowser } from "@/tests/render-browser";
import { StoreId, TaskIdSchema } from "@instrument-org/workspace/client";
import { describe, expect, it, type Mock, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { OrchestratorContext, type OrchestratorWindow } from "./context";
import { type RowDensity, ThreadRow } from "./thread-row";
import { type Thread, type Topic } from "./threads";

const sessionId = StoreId.newSessionId();

/** The moment every row is read at: a Wednesday afternoon. */
const NOW = new Date(2026, 8, 16, 14, 30);

/** When the fixture's thread last moved, earlier the same day. */
const MOVED_AT = new Date(2026, 8, 16, 9, 11);

/** The morning the fixture's thread began. */
const STARTED_AT = new Date(2026, 8, 16, 8, 46);

const ASK = "Guard the Nest eco mode before 5 p.m.";

const TITLE = "Second-floor Nest eco mode guard before 5 p.m.";

const REPLY = "Done: the automation now checks presence first.";

/** A long reply, so a clamp has something to cut. */
const LONG_REPLY =
  "Done: the automation now checks presence first, then the hour, then the thermostat's own schedule, and only then trips eco mode, which it also undoes on the way back before five so the second floor is warm when anyone comes up.";

function thread(overrides: Partial<Thread> = {}): Thread {
  const messageId = StoreId.newMessageId();
  return {
    createdAt: STARTED_AT.getTime(),
    holds: { apps: [], files: [], sites: [] },
    id: sessionId,
    lastReplyAt: MOVED_AT.getTime(),
    latest: { at: MOVED_AT.getTime(), kind: "reply", text: REPLY },
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
          text: ASK,
          type: "text",
        },
      ],
      role: "user",
    },
    runningTasks: [],
    state: "idle",
    title: TITLE,
    titled: true,
    topics: [],
    unread: 0,
    updatedAt: MOVED_AT.getTime(),
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

/** The state dot in the gutter, if the thread wears one. */
function dotOf(row: HTMLElement) {
  return gutterOf(row).querySelector<HTMLElement>("[aria-label]");
}

/** The first line of a tall row: the pill, the title, its count, and the time. */
function firstLineOf(row: HTMLElement) {
  const line = row.children[1]?.firstElementChild;
  if (!(line instanceof HTMLElement)) {
    throw new TypeError("no first line");
  }
  return line;
}

/** The gutter at the row's left, which holds the state. */
function gutterOf(row: HTMLElement) {
  const gutter = row.firstElementChild;
  if (!(gutter instanceof HTMLElement)) {
    throw new TypeError("no gutter");
  }
  return gutter;
}

/** The marks of what the thread holds: every button that is not a control of the row's own. */
function marksOf(row: HTMLElement) {
  return [...row.querySelectorAll("button")].filter(
    (button) =>
      !button.hasAttribute("aria-label") &&
      !button.classList.contains("rounded-full"),
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

/** The agent's latest line, the one thing on the row set in the smaller size. */
function peekOf(row: HTMLElement) {
  return row.querySelector<HTMLElement>('[class*="text-[12px]"]');
}

/** The pill of the topic the thread is filed under. */
function pillOf(row: HTMLElement) {
  return row.querySelector<HTMLButtonElement>("button.rounded-full");
}

async function renderRow(
  row: Thread,
  {
    density = "tall",
    onOpen = vi.fn(),
    onSetTopics = vi.fn(),
    openScreen = vi.fn(),
  }: {
    density?: RowDensity;
    onOpen?: Mock<() => void>;
    onSetTopics?: Mock<(topics: string[]) => void>;
    openScreen?: Mock<(href: string) => void>;
  } = {},
) {
  const { rows, ...rest } = await renderRows([{ density, thread: row }], {
    onOpen,
    onSetTopics,
    openScreen,
  });
  const [element] = rows;
  if (!element) {
    throw new Error("no row");
  }
  return { ...rest, onOpen, onSetTopics, openScreen, row: element };
}

/**
 * Several rows at once, each in a box of its density's width, so one test
 * can hold two shapes side by side without a second render.
 */
async function renderRows(
  specs: { density: RowDensity; thread: Thread }[],
  {
    onOpen = vi.fn(),
    onSetTopics = vi.fn(),
    openScreen = vi.fn(),
  }: {
    onOpen?: Mock<() => void>;
    onSetTopics?: Mock<(topics: string[]) => void>;
    openScreen?: Mock<(href: string) => void>;
  } = {},
) {
  const rendered = await renderInBrowser(
    <OrchestratorContext value={paneWindow(openScreen)}>
      {specs.map((spec, index) => (
        <div
          key={index}
          style={{ width: spec.density === "slim" ? "800px" : "400px" }}
        >
          <ThreadRow
            appsBySlug={
              new Map([
                ["github", { name: "GitHub", site: "https://github.com" }],
              ])
            }
            density={spec.density}
            isOpen={false}
            now={NOW}
            onNewTopic={vi.fn()}
            onOpen={onOpen}
            onSetTopics={onSetTopics}
            thread={spec.thread}
            topics={[HOUSE, MONEY]}
          />
        </div>
      ))}
    </OrchestratorContext>,
  );
  const rows = [
    ...rendered.container.querySelectorAll<HTMLElement>('[role="button"]'),
  ];
  return { ...rendered, onOpen, onSetTopics, openScreen, rows };
}

/** The time at the row's end. */
function timeOf(row: HTMLElement) {
  const time = row.querySelector<HTMLElement>(".text-right");
  if (!time) {
    throw new Error("no time");
  }
  return time;
}

/** The title, which is the one line of words every row has. */
function titleOf(row: HTMLElement) {
  const title = [...row.querySelectorAll("span")].find(
    (span) => span.textContent === TITLE,
  );
  if (!title) {
    throw new Error("no title");
  }
  return title;
}

describe("ThreadRow", () => {
  it("lies down to one line across a wide list, the time at the far right and no ask on it", async () => {
    const { row } = await renderRow(thread({ topics: ["house"] }), {
      density: "slim",
    });
    expect(row.getBoundingClientRect().height).toBeLessThanOrEqual(40);
    expect(row.textContent).toContain(TITLE);
    expect(row.textContent).toContain("9:11 AM");
    expect(row.textContent).not.toContain(ASK);
    expect(row.textContent).not.toContain("replies");
    const time = timeOf(row).getBoundingClientRect();
    for (const child of row.children) {
      expect(child.getBoundingClientRect().right).toBeLessThanOrEqual(
        time.right,
      );
    }
    // The latest line starts past the title's column, never under it.
    expect(peekOf(row)?.getBoundingClientRect().left).toBeGreaterThan(
      titleOf(row).getBoundingClientRect().right,
    );
  });

  it("stacks when the list is narrow: the title and the time on one line, the latest under it, the files under that", async () => {
    const { row } = await renderRow(
      thread({
        holds: { apps: [], files: ["/task/out/report.md"], sites: [] },
        topics: ["house"],
      }),
    );
    expect(row.getBoundingClientRect().height).toBeGreaterThan(40);
    const first = firstLineOf(row);
    expect(first.textContent).toContain("House");
    expect(first.textContent).toContain(TITLE);
    expect(first.textContent).toContain("9:11 AM");
    expect(row.textContent).not.toContain(ASK);
    const peek = peekOf(row);
    expect(peek?.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      first.getBoundingClientRect().bottom,
    );
    const [chip] = marksOf(row);
    expect(chip?.textContent).toBe("report.md");
    expect(chip?.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      peek?.getBoundingClientRect().bottom ?? 0,
    );
  });

  it("gives the latest line two lines when tall and one when slim", async () => {
    const long = thread({
      latest: { at: MOVED_AT.getTime(), kind: "reply", text: LONG_REPLY },
    });
    const { rows } = await renderRows([
      { density: "tall", thread: long },
      { density: "slim", thread: long },
    ]);
    const [tall, slim] = rows;
    if (!tall || !slim) {
      throw new Error("no rows");
    }
    const tallPeek = peekOf(tall);
    expect(tallPeek?.querySelector(".line-clamp-2")).not.toBeNull();
    expect(tallPeek?.getBoundingClientRect().height).toBeGreaterThan(30);
    expect(peekOf(slim)?.getBoundingClientRect().height).toBeLessThanOrEqual(
      24,
    );
    expect(slim.scrollWidth).toBe(slim.clientWidth);
  });

  it("counts the replies at the row's right, under the time when tall and before it when slim, once there is a conversation", async () => {
    const { rows } = await renderRows([
      { density: "tall", thread: thread({ replyCount: 3 }) },
      { density: "tall", thread: thread({ replyCount: 1 }) },
      { density: "slim", thread: thread({ replyCount: 3 }) },
    ]);
    const [three, one, slim] = rows;
    if (!three || !one || !slim) {
      throw new Error("no rows");
    }
    const countOf = (row: HTMLElement) =>
      row.querySelector<HTMLElement>('[aria-label="3 replies"]');
    // The first line carries the title, the time, and the count under it;
    // the count is no part of the title's line.
    expect(firstLineOf(three).textContent).toBe(`${TITLE}9:11 AM3`);
    const tallCount = countOf(three);
    expect(tallCount?.textContent).toBe("3");
    const time = timeOf(three).getBoundingClientRect();
    expect(tallCount?.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      time.bottom,
    );
    expect(tallCount?.getBoundingClientRect().right).toBeLessThanOrEqual(
      time.right + 1,
    );
    expect(countOf(one)).toBeNull();
    expect(firstLineOf(one).textContent).toBe(`${TITLE}9:11 AM`);
    const slimCount = countOf(slim);
    expect(slimCount?.getBoundingClientRect().right).toBeLessThanOrEqual(
      timeOf(slim).getBoundingClientRect().left,
    );
    expect(slim.textContent).toBe(`${TITLE}${REPLY}39:11 AM`);
  });

  it.each<[string, Partial<Thread>, null | { color: string; label: string }]>([
    ["quiet", {}, null],
    ["unseen", { unread: 2 }, { color: "bg-brand-500", label: "Unread" }],
    [
      "working",
      { state: "working" },
      { color: "bg-brand-500", label: "Working" },
    ],
    [
      "waiting",
      { state: "waiting" },
      { color: "bg-warning-500", label: "Needs you" },
    ],
    [
      "waiting with unseen replies",
      { state: "waiting", unread: 2 },
      { color: "bg-warning-500", label: "Needs you" },
    ],
  ])("wears the state as a dot when %s", async (_, overrides, dot) => {
    const { row } = await renderRow(thread(overrides));
    const worn = dotOf(row);
    if (dot === null) {
      expect(worn).toBeNull();
      return;
    }
    expect(worn?.getAttribute("aria-label")).toBe(dot.label);
    expect(worn?.className).toContain(dot.color);
  });

  it("sets the title in semibold only while something in it is unseen", async () => {
    const { rows } = await renderRows([
      { density: "tall", thread: thread({ unread: 1 }) },
      { density: "tall", thread: thread() },
    ]);
    const [unseen, seen] = rows;
    if (!unseen || !seen) {
      throw new Error("no rows");
    }
    expect(titleOf(unseen).className).toContain("font-semibold");
    expect(timeOf(unseen).className).toContain("text-foreground");
    expect(titleOf(seen).className).not.toContain("font-semibold");
    expect(timeOf(seen).className).toContain("text-muted-foreground");
  });

  it("wears one pill, the first topic it is filed under", async () => {
    const { row } = await renderRow(thread({ topics: ["money", "house"] }));
    expect(row.querySelectorAll("button.rounded-full")).toHaveLength(1);
    expect(pillOf(row)?.textContent).toBe("💸Money");
  });

  it.each([
    ["the clock while it is today", MOVED_AT, "9:11 AM"],
    ["the weekday within the week", new Date(2026, 8, 13, 9, 11), "Sun"],
    ["the date past that", new Date(2026, 8, 6, 9, 11), "Sep 6"],
  ])("says when anything last happened as %s", async (_, at, label) => {
    const { row } = await renderRow(thread({ updatedAt: at.getTime() }));
    expect(timeOf(row).textContent).toBe(label);
  });

  it("shows the step in brand while working, and the question behind the amber glyph while waiting", async () => {
    const { rows } = await renderRows([
      {
        density: "tall",
        thread: thread({
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
      },
      {
        density: "tall",
        thread: thread({
          latest: {
            at: MOVED_AT.getTime(),
            kind: "question",
            text: "Reuse the old CSR, or generate a new one?",
          },
          state: "waiting",
        }),
      },
    ]);
    const [working, waiting] = rows;
    if (!working || !waiting) {
      throw new Error("no rows");
    }
    expect(working.querySelector(".brand-shiny-text")?.textContent).toBe(
      "Reading the automation",
    );
    const peek = peekOf(waiting);
    expect(peek?.textContent).toBe("Reuse the old CSR, or generate a new one?");
    expect(peek?.querySelector("svg.text-warning-700")).not.toBeNull();
  });

  it("has no latest line for an idle thread with nothing to say", async () => {
    const { row } = await renderRow(
      thread({ lastReplyAt: undefined, latest: undefined, replyCount: 0 }),
    );
    expect(peekOf(row)).toBeNull();
    expect(row.textContent).toBe(`${TITLE}9:11 AM`);
  });

  it("opens the thread from a click anywhere on it, and from Enter", async () => {
    const { onOpen, openScreen, row } = await renderRow(
      thread({ topics: ["house"] }),
    );
    row.click();
    gutterOf(row).click();
    titleOf(row).click();
    peekOf(row)?.click();
    expect(onOpen).toHaveBeenCalledTimes(4);
    row.focus();
    await userEvent.keyboard("{Enter}");
    expect(onOpen).toHaveBeenCalledTimes(5);
    expect(openScreen).not.toHaveBeenCalled();
  });

  it("asks the window for a place of its own on a middle or a modified click", async () => {
    const { onOpen, openScreen, row } = await renderRow(thread());
    titleOf(row).dispatchEvent(
      new MouseEvent("auxclick", { bubbles: true, button: 1 }),
    );
    expect(openScreen).toHaveBeenCalledWith(
      `/orchestrator/threads/${sessionId}`,
    );
    titleOf(row).dispatchEvent(
      new MouseEvent("click", { bubbles: true, metaKey: true }),
    );
    expect(openScreen).toHaveBeenCalledTimes(2);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("wears the hover ground across the whole row, and puts the tag control in front of the pill then", async () => {
    const { row } = await renderRow(
      thread({
        holds: { apps: [], files: ["/task/out/report.md"], sites: [] },
        topics: ["house"],
      }),
    );
    const control = row.querySelector<HTMLElement>('[aria-label="Topics"]');
    if (!control) {
      throw new Error("no tag control");
    }
    // Out of the flow at rest: it takes no room until the pointer arrives.
    expect(control.getClientRects().length).toBe(0);
    const chipBefore = marksOf(row)[0]?.getBoundingClientRect();
    const pillBefore = pillOf(row)?.getBoundingClientRect();
    await userEvent.hover(gutterOf(row));
    await vi.waitFor(() => {
      expect(control.getClientRects().length).toBeGreaterThan(0);
    });
    const pillAfter = pillOf(row)?.getBoundingClientRect();
    expect(control.getBoundingClientRect().right).toBeLessThanOrEqual(
      pillAfter?.left ?? 0,
    );
    expect(pillAfter?.left ?? 0).toBeGreaterThan(pillBefore?.left ?? 0);
    expect(getComputedStyle(row).backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
    // Nothing under the first line moves with the pointer.
    expect(marksOf(row)[0]?.getBoundingClientRect()).toEqual(chipBefore);
    await userEvent.unhover(gutterOf(row));
  });

  it("carries what it holds as chips named for the files and bare marks for the rest, behind a count past a few", async () => {
    const holds = {
      apps: ["github"],
      files: ["/task/out/report.md", "/task/out/data.csv"],
      sites: ["wakatime.com", "example.com", "example.org", "example.net"],
    };
    const { rows } = await renderRows([
      { density: "tall", thread: thread({ holds }) },
      { density: "slim", thread: thread({ holds }) },
    ]);
    for (const row of rows) {
      const marks = marksOf(row);
      // Five marks, then a count of the two that did not get one.
      expect(marks).toHaveLength(6);
      expect(marks.at(-1)?.textContent).toBe("+2");
      // The files first, newest first, each named; the app and the sites bare.
      expect(marks.slice(0, 2).map((mark) => mark.textContent)).toEqual([
        "data.csv",
        "report.md",
      ]);
      expect(marks.slice(2, 5).every((mark) => mark.textContent === "")).toBe(
        true,
      );
      expect(row.textContent).not.toContain("/task");
      expect(row.textContent).not.toContain("wakatime.com");
    }
  });

  it("names a bare mark in its tooltip", async () => {
    const { row } = await renderRow(
      thread({ holds: { apps: [], files: [], sites: ["wakatime.com"] } }),
      { density: "slim" },
    );
    const [site] = marksOf(row);
    if (!site) {
      throw new Error("no mark");
    }
    await userEvent.hover(site);
    // The tooltip and the announcement it carries for the screen reader are
    // two elements with the role; either says the name.
    await expect
      .element(page.getByRole("tooltip").first())
      .toHaveTextContent("wakatime.com");
    await userEvent.unhover(site);
  });

  it("lists every hold by name behind the count, never a slug or a path", async () => {
    const files = Array.from(
      { length: 6 },
      (_, index) => `/task/out/report-${index}.md`,
    );
    const { row } = await renderRow(
      thread({ holds: { apps: ["github"], files, sites: ["wakatime.com"] } }),
      { density: "slim" },
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
    expect(names).toEqual([
      ...files.toReversed().map((path) => path.split("/").at(-1)),
      "GitHub",
      "wakatime.com",
    ]);
    await userEvent.keyboard("{Escape}");
  });

  it("opens a hold inside its thread: the thread first, then the hold as a tab of the thread's", async () => {
    const { onOpen, openScreen, row } = await renderRow(
      thread({ holds: { apps: ["github"], files: [], sites: [] } }),
    );
    const [app] = marksOf(row);
    app?.click();
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(openScreen).toHaveBeenCalledWith("/orchestrator/apps/github", {
      newTab: true,
    });
    app?.dispatchEvent(
      new MouseEvent("auxclick", { bubbles: true, button: 1 }),
    );
    expect(onOpen).toHaveBeenCalledTimes(2);
    expect(openScreen).toHaveBeenCalledTimes(2);
  });

  it("opens the thread's topic list from the pill, which files the thread rather than opening it", async () => {
    const { onOpen, onSetTopics, row } = await renderRow(
      thread({ topics: ["house"] }),
    );
    const pill = pillOf(row);
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
    // The control is in the flow only while the pointer is on the row.
    await userEvent.hover(gutterOf(row));
    await vi.waitFor(() => {
      expect(control.getClientRects().length).toBeGreaterThan(0);
    });
    await userEvent.click(control);
    const list = page.getByRole("menu");
    await expect.element(list).toBeVisible();
    await userEvent.click(list.getByText("House"));
    expect(onSetTopics).toHaveBeenCalledWith(["house"]);
    expect(onOpen).not.toHaveBeenCalled();
    await userEvent.keyboard("{Escape}");
  });
});
