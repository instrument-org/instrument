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

function thread(
  overrides: Partial<Thread> = {},
  ask = "Guard the Nest eco mode before 5 p.m.",
): Thread {
  const messageId = StoreId.newMessageId();
  return {
    createdAt: new Date(2026, 8, 16, 8, 46).getTime(),
    holds: { apps: [], files: [], sites: [] },
    id: sessionId,
    lastReplyAt: Date.now() - 5 * 60_000,
    latest: {
      at: Date.now() - 5 * 60_000,
      kind: "reply",
      text: "Done: the automation now checks presence first.",
    },
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

/** The gutter at the row's left, which is the thread's start time. */
function gutterOf(row: HTMLElement) {
  const gutter = row.firstElementChild;
  if (!(gutter instanceof HTMLElement)) {
    throw new TypeError("no gutter");
  }
  return gutter;
}

/** The lines hanging past the gutter, in order: the header, the ask, the replies row, the holds. */
function linesOf(row: HTMLElement) {
  return [...(row.children[1]?.children ?? [])].filter(
    (child): child is HTMLElement => child instanceof HTMLElement,
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
  {
    onOpen = vi.fn(),
    onPickTopic = vi.fn(),
    openScreen = vi.fn(),
    width = 400,
  } = {},
) {
  const rendered = await renderInBrowser(
    <OrchestratorContext value={paneWindow(openScreen)}>
      <div style={{ width: `${width}px` }}>
        <ThreadRow
          appsBySlug={new Map()}
          onNewTopic={vi.fn()}
          onOpen={onOpen}
          onPickTopic={onPickTopic}
          onSetTopics={vi.fn()}
          thread={row}
          topics={[HOUSE]}
        />
      </div>
    </OrchestratorContext>,
  );
  const rowElement =
    rendered.container.querySelector<HTMLElement>(".group\\/row");
  if (!rowElement) {
    throw new Error("no row");
  }
  return { ...rendered, onOpen, onPickTopic, openScreen, row: rowElement };
}

/** The replies row, which is the one button the row keeps at rest. */
function repliesRowOf(row: HTMLElement) {
  const button = [...row.querySelectorAll("button")].find((candidate) =>
    /replies|reply/.test(candidate.textContent),
  );
  if (!button) {
    throw new Error("no replies row");
  }
  return button;
}

/** What the replies row shows right now, its parts in order, leaving out what is only drawn on hover. */
function shownOn(replies: HTMLElement) {
  return [...replies.querySelectorAll(":scope > span")]
    .filter((span) => span.getClientRects().length > 0)
    .map((span) => span.textContent);
}

describe("ThreadRow", () => {
  it("starts with the time in a gutter and hangs every line off one edge past it", async () => {
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
    const gutter = gutterOf(row);
    expect(gutter.textContent).toBe("8:46 AM");
    const lines = linesOf(row);
    const [header, ask, replies, holds] = lines;
    if (!header || !ask || !replies || !holds || lines.length !== 4) {
      throw new Error("the row is short a line");
    }
    const edge = header.getBoundingClientRect().left;
    expect(edge).toBeGreaterThan(gutter.getBoundingClientRect().right);
    for (const line of lines) {
      expect(line.getBoundingClientRect().left).toBe(edge);
    }
    // The gutter's time shares the header's line.
    expect(gutter.getBoundingClientRect().top).toBe(
      header.getBoundingClientRect().top,
    );
    expect(header.textContent).toContain("House");
    expect(header.textContent).toContain("·");
    expect(header.textContent).toContain("Second-floor Nest");
    expect(header.textContent).not.toContain("8:46 AM");
    expect(header.textContent).not.toContain("replies");
    // The title has what the pill and the control leave, which at this width
    // is most of the line rather than a few letters before an ellipsis.
    const title = header.querySelector("span.truncate.flex-1");
    expect(title?.getBoundingClientRect().width).toBeGreaterThan(
      row.clientWidth / 2,
    );
    expect(ask.textContent).toBe("Guard the Nest eco mode before 5 p.m.");
    expect(replies.tagName).toBe("BUTTON");
    expect(holds.textContent).toContain("report.md");
    expect(row.textContent).not.toContain("last reply");
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

  it("clips the holds at the edge and counts the rest", async () => {
    const files = Array.from(
      { length: 12 },
      (_, index) => `/task/out/a-long-report-name-${index}.md`,
    );
    const { row } = await renderRow(
      thread({ holds: { apps: [], files, sites: [] } }),
      { width: 320 },
    );
    const holds = linesOf(row).at(-1);
    await vi.waitFor(() => {
      // The visible count, not the widest one the measuring row lays out.
      const more = [...(holds?.querySelectorAll("button") ?? [])].find(
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

  it("puts the count in brand, the unseen ones after it, the last reply's time, then the peek on one line", async () => {
    const { row } = await renderRow(thread({ unread: 2 }));
    const replies = repliesRowOf(row);
    const [count, time, peek] = shownOn(replies);
    expect(count).toBe("3 replies, 2 new");
    expect(replies.querySelector(".text-brand-700")?.textContent).toBe(
      "3 replies, 2 new",
    );
    expect(time).toMatch(/^\d+m ago$/);
    expect(peek).toBe("Done: the automation now checks presence first.");
    expect(shownOn(replies)).toHaveLength(3);
  });

  it("truncates the peek to what the line has left", async () => {
    const { row } = await renderRow(
      thread({ latest: { at: Date.now(), kind: "reply", text: LONG_ASK } }),
      { width: 320 },
    );
    const replies = repliesRowOf(row);
    const peek = replies.querySelector(".truncate");
    expect(peek?.scrollWidth).toBeGreaterThan(peek?.clientWidth ?? 0);
    expect(replies.scrollWidth).toBe(replies.clientWidth);
  });

  it("counts one reply in the singular, with nothing about unseen ones", async () => {
    const { row } = await renderRow(thread({ replyCount: 1 }));
    expect(shownOn(repliesRowOf(row))[0]).toBe("1 reply");
  });

  it("says there are no replies yet, with no time beside it", async () => {
    const { row } = await renderRow(
      thread({ lastReplyAt: undefined, latest: undefined, replyCount: 0 }),
    );
    const replies = [...row.querySelectorAll("button")].find((button) =>
      button.textContent.includes("No replies yet"),
    );
    if (!replies) {
      throw new Error("no replies row");
    }
    expect(shownOn(replies)).toEqual(["No replies yet"]);
  });

  it("says View thread at the replies row's end on hover, and opens the thread", async () => {
    const { onOpen, openScreen, row } = await renderRow(thread());
    const replies = repliesRowOf(row);
    expect(shownOn(replies)).toHaveLength(3);
    await userEvent.hover(replies);
    await vi.waitFor(() => {
      expect(shownOn(replies).at(-1)).toBe("View thread");
    });
    expect(shownOn(replies)[0]).toBe("3 replies");
    expect(shownOn(replies)).toHaveLength(4);
    await userEvent.click(replies);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(openScreen).not.toHaveBeenCalled();
    // The pointer stays where it was left, and the next test's row renders
    // under it.
    await userEvent.unhover(replies);
  });

  it("opens the thread from the keyboard on the replies row", async () => {
    const { onOpen, row } = await renderRow(thread());
    repliesRowOf(row).focus();
    await userEvent.keyboard("{Enter}");
    expect(onOpen).toHaveBeenCalledTimes(1);
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
    const replies = repliesRowOf(row);
    expect(shownOn(replies).at(-1)).toBe(
      "Reuse the old CSR, or generate a new one?",
    );
    expect(replies.querySelector("svg.text-warning-700")).not.toBeNull();
    expect(container.querySelector(".bg-brand-500")).toBeNull();
    expect(container.querySelector(".bg-warning-500")).toBeNull();
  });

  it("writes a working thread's step with the traveling highlight", async () => {
    const { row } = await renderRow(
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
    const replies = repliesRowOf(row);
    expect(replies.querySelector(".brand-shiny-text")?.textContent).toBe(
      "Reading the automation",
    );
    expect(shownOn(replies).at(-1)).toBe("Reading the automation");
  });

  it("keeps the unseen count off the peek", async () => {
    const { row } = await renderRow(thread({ unread: 2 }));
    expect(shownOn(repliesRowOf(row)).at(-1)).not.toContain("new");
  });

  it("is only the count and the time when an idle thread has said nothing", async () => {
    const { row } = await renderRow(thread({ latest: undefined }));
    const replies = repliesRowOf(row);
    expect(shownOn(replies)).toHaveLength(2);
    expect(shownOn(replies)[0]).toBe("3 replies");
    expect(linesOf(row)).toHaveLength(3);
  });

  it("opens the thread from the ask and from the peek", async () => {
    const { container, onOpen, openScreen, row } = await renderRow(thread());
    container.querySelector<HTMLElement>(".line-clamp-2")?.click();
    expect(onOpen).toHaveBeenCalledTimes(1);
    repliesRowOf(row).querySelector<HTMLElement>(".truncate")?.click();
    expect(onOpen).toHaveBeenCalledTimes(2);
    expect(openScreen).not.toHaveBeenCalled();
  });

  it("asks the window for a place of its own on a middle or a modified click", async () => {
    const { onOpen, openScreen, row } = await renderRow(thread());
    const replies = repliesRowOf(row);
    replies.dispatchEvent(
      new MouseEvent("auxclick", { bubbles: true, button: 1 }),
    );
    expect(openScreen).toHaveBeenCalledWith(
      `/orchestrator/threads/${sessionId}`,
    );
    replies.dispatchEvent(
      new MouseEvent("click", { bubbles: true, metaKey: true }),
    );
    expect(openScreen).toHaveBeenCalledTimes(2);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("narrows the list to a topic from its pill", async () => {
    const { onOpen, onPickTopic } = await renderRow(
      thread({ topics: ["house"] }),
    );
    await userEvent.click(page.getByRole("button", { name: /House/ }));
    expect(onPickTopic).toHaveBeenCalledWith("house");
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("opens nothing from the row's padding, its gutter, or its tag control", async () => {
    const { onOpen, openScreen, row } = await renderRow(thread());
    row.click();
    gutterOf(row).click();
    linesOf(row)[0]?.click();
    row.dispatchEvent(new MouseEvent("auxclick", { bubbles: true, button: 1 }));
    row.querySelector<HTMLElement>('[aria-label="Topics"]')?.click();
    expect(onOpen).not.toHaveBeenCalled();
    expect(openScreen).not.toHaveBeenCalled();
    expect(row.getAttribute("role")).toBeNull();
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
