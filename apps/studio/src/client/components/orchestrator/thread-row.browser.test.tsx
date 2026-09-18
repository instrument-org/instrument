import { renderInBrowser } from "@/tests/render-browser";
import { StoreId, TaskIdSchema } from "@instrument-org/workspace/client";
import { toast, Toaster } from "sonner";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest";
import { page, userEvent } from "vitest/browser";

import { OrchestratorContext, type OrchestratorWindow } from "./context";
import { type RowDensity } from "./row-shell";
import { ThreadRow } from "./thread-row";
import { type Thread, type Topic } from "./threads";

/** What each of the row's own routes was asked, by name. */
const calls = vi.hoisted(() => ({
  archive: vi.fn(),
  seen: vi.fn(),
  star: vi.fn(),
  unarchive: vi.fn(),
  unseen: vi.fn(),
}));

// The routes the row's actions reach, each answering at once so what hangs
// off a success can be seen, and the one the open gestures bind whether or
// not they are used.
vi.mock("@/client/rpc/client", () => {
  const routeOf = (call: Mock) => ({
    mutationOptions: (options: object) => ({
      ...options,
      mutationFn: (input: unknown) => {
        call(input);
        return Promise.resolve();
      },
    }),
  });
  return {
    rpcClient: {
      utils: { openExternalLink: routeOf(vi.fn()) },
      workspace: {
        orchestrator: {
          threads: {
            archive: routeOf(calls.archive),
            seen: routeOf(calls.seen),
            star: routeOf(calls.star),
            unarchive: routeOf(calls.unarchive),
            unseen: routeOf(calls.unseen),
          },
        },
      },
    },
  };
});

const sessionId = StoreId.newSessionId();

/** The input every route of the row's is asked with. */
const INPUT = { id: "orchestrator", sessionId };

/** The moment every row is read at: a Wednesday afternoon. */

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
    archived: false,
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
    starred: false,
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

/** The row's own action, by name, wherever on the row it stands. */
function actionOf(row: HTMLElement, label: string) {
  const action = row.querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`,
  );
  if (!action) {
    throw new Error(`no ${label}`);
  }
  return action;
}

/** The bar of actions at the row's right end, and what it offers, in order. */
function barOf(row: HTMLElement) {
  const bar = [...row.querySelectorAll<HTMLElement>("span")].find((span) =>
    span.className.includes("ring-1"),
  );
  if (!bar) {
    throw new Error("no action bar");
  }
  return {
    bar,
    labels: [...bar.querySelectorAll("button")].map((button) =>
      button.getAttribute("aria-label"),
    ),
  };
}

/** The state dot in front of the title, if the thread wears one. */
function dotOf(row: HTMLElement) {
  return row.querySelector<HTMLElement>(
    '[aria-label="Unread"], [aria-label="Working"], [aria-label="Needs you"]',
  );
}

/** The first line of a tall row: the dot, the title, and the pills at its end. */
function firstLineOf(row: HTMLElement) {
  const line = row.firstElementChild?.firstElementChild;
  if (!(line instanceof HTMLElement)) {
    throw new TypeError("no first line");
  }
  return line;
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
    openPath: vi.fn(),
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
      {/* The toasts the row's actions raise land here, and stay until read. */}
      <Toaster duration={Infinity} />
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
  it("lies down to one line across a wide list, the pills and the star at the far right, no ask and no time on it", async () => {
    const { row } = await renderRow(thread({ topics: ["house"] }), {
      density: "slim",
    });
    expect(row.getBoundingClientRect().height).toBeLessThanOrEqual(40);
    expect(row.textContent).toBe(`${TITLE}${REPLY}🏠House`);
    // Nothing past the pill but the star, which is the row's own mark.
    const pill = pillOf(row)?.getBoundingClientRect();
    const star = row
      .querySelector('[aria-label="Star"]')
      ?.getBoundingClientRect();
    expect(star?.left).toBeGreaterThanOrEqual(pill?.right ?? 0);
    // The latest line starts past the title's column, never under it.
    expect(peekOf(row)?.getBoundingClientRect().left).toBeGreaterThan(
      titleOf(row).getBoundingClientRect().right,
    );
  });

  it("stacks when the list is narrow: the title with the pill at its end on one line, the latest under it, the files under that", async () => {
    const { row } = await renderRow(
      thread({
        holds: { apps: [], files: ["/task/out/report.md"], sites: [] },
        topics: ["house"],
      }),
    );
    expect(row.getBoundingClientRect().height).toBeGreaterThan(40);
    const first = firstLineOf(row);
    expect(first.textContent).toBe(`${TITLE}🏠House`);
    // The pill on the title's line, at its end in the row's corner.
    const pill = pillOf(row)?.getBoundingClientRect();
    expect(pill?.top).toBeGreaterThanOrEqual(first.getBoundingClientRect().top);
    expect(pill?.left).toBeGreaterThan(
      titleOf(row).getBoundingClientRect().right,
    );
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

  it("carries no reply count and no time", async () => {
    const { rows } = await renderRows([
      { density: "tall", thread: thread({ replyCount: 3 }) },
      { density: "slim", thread: thread({ replyCount: 3 }) },
    ]);
    const [tall, slim] = rows;
    if (!tall || !slim) {
      throw new Error("no rows");
    }
    expect(tall.querySelector('[aria-label="3 replies"]')).toBeNull();
    expect(firstLineOf(tall).textContent).toBe(TITLE);
    expect(slim.textContent).toBe(`${TITLE}${REPLY}`);
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
    expect(titleOf(seen).className).not.toContain("font-semibold");
  });

  it("wears a pill per topic, each by name, at the title's end", async () => {
    const { row } = await renderRow(thread({ topics: ["money", "house"] }));
    const pills = [...row.querySelectorAll("button.rounded-full")];
    expect(pills.map((pill) => pill.textContent)).toEqual([
      "💸Money",
      "🏠House",
    ]);
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
    expect(row.textContent).toBe(TITLE);
  });

  it("opens the thread from a click anywhere on it, and from Enter", async () => {
    const { onOpen, openScreen, row } = await renderRow(
      thread({ topics: ["house"] }),
    );
    row.click();
    firstLineOf(row).click();
    titleOf(row).click();
    peekOf(row)?.click();
    expect(onOpen).toHaveBeenCalledTimes(4);
    row.focus();
    await userEvent.keyboard("{Enter}");
    expect(onOpen).toHaveBeenCalledTimes(5);
    expect(openScreen).not.toHaveBeenCalled();
  });

  it("opens the thread in place on a modified click too: a thread is never a tab", async () => {
    const { onOpen, openScreen, row } = await renderRow(thread());
    titleOf(row).dispatchEvent(
      new MouseEvent("click", { bubbles: true, metaKey: true }),
    );
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(openScreen).not.toHaveBeenCalled();
  });

  it("wears the hover ground across the whole row, and puts the tag control in front of the title then", async () => {
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
    const titleBefore = titleOf(row).getBoundingClientRect();
    await userEvent.hover(titleOf(row));
    await vi.waitFor(() => {
      expect(control.getClientRects().length).toBeGreaterThan(0);
    });
    const titleAfter = titleOf(row).getBoundingClientRect();
    expect(control.getBoundingClientRect().right).toBeLessThanOrEqual(
      titleAfter.left,
    );
    expect(titleAfter.left).toBeGreaterThan(titleBefore.left);
    expect(getComputedStyle(row).backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
    // Nothing under the first line moves with the pointer.
    expect(marksOf(row)[0]?.getBoundingClientRect()).toEqual(chipBefore);
    await userEvent.unhover(titleOf(row));
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

  it("keeps what it holds to one line when tall, the files first, clipped at the row's edge rather than wrapped", async () => {
    const files = Array.from(
      { length: 4 },
      (_, index) => `/task/out/a-report-with-a-long-name-${index}.md`,
    );
    const holds = { apps: ["github"], files, sites: ["wakatime.com"] };
    const { rows } = await renderRows([
      { density: "tall", thread: thread({ holds }) },
      {
        density: "tall",
        thread: thread({ holds: { ...holds, files: files.slice(0, 1) } }),
      },
    ]);
    const [many, few] = rows;
    if (!many || !few) {
      throw new Error("no rows");
    }
    const marks = marksOf(many);
    const line = marks[0]?.parentElement;
    if (!line) {
      throw new Error("no line of holds");
    }
    // One line whatever it holds: every mark at one height, and the row no
    // taller than one holding what fits.
    expect(
      new Set(marks.map((mark) => Math.round(mark.getBoundingClientRect().top)))
        .size,
    ).toBe(1);
    expect(many.getBoundingClientRect().height).toBe(
      few.getBoundingClientRect().height,
    );
    // More than the row shows, and none of it past the row's edge.
    expect(line.scrollWidth).toBeGreaterThan(line.clientWidth);
    expect(line.getBoundingClientRect().right).toBeLessThanOrEqual(
      many.getBoundingClientRect().right,
    );
    expect(marks.slice(0, 4).map((mark) => mark.textContent)).toEqual(
      files.toReversed().map((path) => path.split("/").at(-1)),
    );
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

  it("opens a hold inside its thread: as a tab of the thread's group, shown, without opening the row", async () => {
    const { onOpen, openScreen, row } = await renderRow(
      thread({ holds: { apps: ["github"], files: [], sites: [] } }),
    );
    const [app] = marksOf(row);
    app?.click();
    expect(onOpen).not.toHaveBeenCalled();
    expect(openScreen).toHaveBeenCalledWith("/orchestrator/apps/github", {
      group: sessionId,
      newTab: true,
      show: true,
    });
    app?.dispatchEvent(
      new MouseEvent("auxclick", { bubbles: true, button: 1 }),
    );
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
    await userEvent.hover(titleOf(row));
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

/** The Undo on the toast that says `message`, once the toast is up. */
async function undoOf(message: string) {
  const line = page.getByText(message);
  await expect.element(line).toBeVisible();
  const undo = line
    .element()
    .closest("[data-sonner-toast]")
    ?.querySelector<HTMLButtonElement>("[data-button]");
  if (!undo) {
    throw new Error(`no undo on ${message}`);
  }
  return undo;
}

describe("the row's actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    toast.dismiss();
  });

  it.each<RowDensity>(["tall", "slim"])(
    "stand over the %s row's right end while the pointer is on it, out of the flow at rest",
    async (density) => {
      const { row } = await renderRow(thread(), { density });
      const { bar, labels } = barOf(row);
      expect(labels).toEqual(["Archive", "Mark as unread"]);
      // The pointer is wherever the last test left it, which may be here.
      await userEvent.unhover(row);
      expect(bar.getClientRects().length).toBe(0);
      const before = titleOf(row).getBoundingClientRect();
      await userEvent.hover(titleOf(row));
      await vi.waitFor(() => {
        expect(bar.getClientRects().length).toBeGreaterThan(0);
      });
      const box = bar.getBoundingClientRect();
      const edge = row.getBoundingClientRect();
      expect(box.right).toBeLessThanOrEqual(edge.right);
      expect(box.right).toBeGreaterThan(edge.right - 80);
      expect(box.top).toBeGreaterThanOrEqual(edge.top);
      // Nothing on the row moved for them but the tag control's arrival in
      // front of the title.
      expect(titleOf(row).getBoundingClientRect().top).toBeCloseTo(
        before.top,
        0,
      );
      await userEvent.unhover(titleOf(row));
    },
  );

  it("puts the thread away from its edge, short of the door, and offers it back from the toast", async () => {
    const { onOpen, row } = await renderRow(thread());
    await userEvent.hover(titleOf(row));
    await userEvent.click(actionOf(row, "Archive"));
    expect(calls.archive).toHaveBeenCalledWith(INPUT);
    expect(onOpen).not.toHaveBeenCalled();
    await userEvent.click(await undoOf("Archived"));
    expect(calls.unarchive).toHaveBeenCalledWith(INPUT);
    // The way back has its own undo, which is the way there again.
    await userEvent.click(await undoOf("Moved to Inbox"));
    expect(calls.archive).toHaveBeenCalledTimes(2);
  });

  it("offers a thread put away the way back", async () => {
    const { row } = await renderRow(thread({ archived: true }));
    expect(barOf(row).labels).toEqual(["Unarchive", "Mark as unread"]);
    await userEvent.hover(titleOf(row));
    await userEvent.click(actionOf(row, "Unarchive"));
    expect(calls.unarchive).toHaveBeenCalledWith(INPUT);
    expect(calls.archive).not.toHaveBeenCalled();
    await expect.element(page.getByText("Moved to Inbox")).toBeVisible();
  });

  it.each<[string, Partial<Thread>, Mock]>([
    ["Mark as read", { unread: 2 }, calls.seen],
    ["Mark as unread", { replyCount: 3, unread: 0 }, calls.unseen],
  ])(
    "offers %s, which asks the route and says nothing",
    async (label, overrides, call) => {
      const { onOpen, row } = await renderRow(thread(overrides));
      await userEvent.hover(titleOf(row));
      await userEvent.click(actionOf(row, label));
      expect(call).toHaveBeenCalledWith(INPUT);
      expect(onOpen).not.toHaveBeenCalled();
      // The route has answered by now; no toast followed.
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(document.querySelector("[data-sonner-toast]")).toBeNull();
    },
  );

  it("offers no read or unread mark on a thread with no replies to have read", async () => {
    const { row } = await renderRow(thread({ replyCount: 0, unread: 0 }));
    expect(barOf(row).labels).toEqual(["Archive"]);
  });

  it("raises the row's menu on a right click: the way in, the actions, and the topics", async () => {
    const { onOpen, onSetTopics, row } = await renderRow(thread({ unread: 1 }));
    await userEvent.click(titleOf(row), { button: "right" });
    const menu = page.getByRole("menu");
    await expect.element(menu).toBeVisible();
    expect(
      [...menu.element().querySelectorAll('[role="menuitem"]')].map(
        (item) => item.textContent,
      ),
    ).toEqual(["Open", "Archive", "Mark as read", "Star", "Topics"]);
    expect(onOpen).not.toHaveBeenCalled();

    await userEvent.click(
      page.getByRole("menuitem", { exact: true, name: "Open" }),
    );
    expect(onOpen).toHaveBeenCalledTimes(1);

    await userEvent.click(titleOf(row), { button: "right" });
    await userEvent.click(page.getByRole("menuitem", { name: "Archive" }));
    expect(calls.archive).toHaveBeenCalledWith(INPUT);

    await userEvent.click(titleOf(row), { button: "right" });
    await userEvent.hover(page.getByRole("menuitem", { name: "Topics" }));
    const house = page.getByRole("menuitemcheckbox", { name: "House" });
    await expect.element(house).toBeVisible();
    await userEvent.click(house);
    expect(onSetTopics).toHaveBeenCalledWith(["house"]);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("keeps the star at the row's end at either width, out of the actions and clear of the words, and turns it on a click", async () => {
    const { rows } = await renderRows([
      { density: "slim", thread: thread() },
      {
        density: "tall",
        thread: thread({
          holds: {
            apps: [],
            files: ["/task/out/a.md", "/task/out/b.md", "/task/out/c.md"],
            sites: [],
          },
          latest: { at: MOVED_AT.getTime(), kind: "reply", text: LONG_REPLY },
          starred: true,
        }),
      },
    ]);
    const [slim, tall] = rows;
    if (!slim || !tall) {
      throw new Error("no rows");
    }
    // At the wide row's end, past the latest line.
    const control = slim.querySelector<HTMLButtonElement>(
      '[aria-label="Star"]',
    );
    expect(control).not.toBeNull();
    expect(control?.getBoundingClientRect().left).toBeGreaterThanOrEqual(
      peekOf(slim)?.getBoundingClientRect().right ?? 0,
    );
    control?.click();
    await vi.waitFor(() => {
      expect(calls.star).toHaveBeenCalledWith({ ...INPUT, starred: true });
    });
    // At the lower right of the narrow row, under the first line, filled
    // once given.
    const given = tall.querySelector<HTMLButtonElement>(
      '[aria-label="Unstar"]',
    );
    expect(given?.getAttribute("aria-pressed")).toBe("true");
    expect(given?.getBoundingClientRect().top).toBeGreaterThan(
      firstLineOf(tall).getBoundingClientRect().bottom,
    );
    expect(given?.getBoundingClientRect().right).toBeLessThanOrEqual(
      tall.getBoundingClientRect().right,
    );
    // The holds on its line stop short of it.
    const starLeft = given?.getBoundingClientRect().left ?? 0;
    for (const mark of marksOf(tall)) {
      expect(mark.getBoundingClientRect().left).toBeLessThan(starLeft);
    }
    // The star is the row's own control, not one of the actions on hover.
    expect([...tall.querySelectorAll('[aria-label="Unstar"]')].length).toBe(1);
  });
});
