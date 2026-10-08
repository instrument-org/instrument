import type * as FaviconUrl from "@/client/lib/favicon-url";

import { promptDraftAtom } from "@/client/atoms/prompt-value";
import { forgetIconlessThisSession } from "@/client/lib/favicon-url";
import { getRevealInFolderLabel, isMacOS } from "@/client/lib/utils";
import { renderInBrowser } from "@/tests/render-browser";
import {
  ChatIdSchema,
  StoreId,
  TaskIdSchema,
} from "@instrument-org/workspace/client";
import { createStore } from "jotai";
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

import { useChatActionsFor } from "./chat-actions";
import { ChatRow } from "./chat-row";
import { type Chat, type Topic } from "./chats";
import { WindowContext, type WindowContextValue } from "./context";

/** What each of the row's own routes was asked, by name. */
const calls = vi.hoisted(() => ({
  archive: vi.fn(),
  rename: vi.fn(),
  retitle: vi.fn(),
  read: vi.fn(),
  star: vi.fn(),
  transcript: vi.fn(),
  unarchive: vi.fn(),
  unread: vi.fn(),
}));

/** `.invalid` sites given an icon partway through a test, as a page opened in a browser tab hands over its own. */
const givenIcon = vi.hoisted(() => new Set<string>());

/** Whether the row is drawn in developer mode, which is off unless a test turns it on. */
const developerMode = vi.hoisted(() => ({ enabled: false }));

vi.mock("@/client/hooks/use-developer-mode", () => ({
  useDeveloperMode: () => developerMode.enabled,
}));

// A site's icon comes over the app protocol, which only the main process
// answers, so here every site has a one-pixel icon except a `.invalid` one,
// which is left to the real address and fails the way a site with none does.
vi.mock("@/client/lib/favicon-url", async (importOriginal) => {
  const actual = await importOriginal<typeof FaviconUrl>();
  return {
    ...actual,
    getFaviconUrl: (url: string) =>
      url.includes(".invalid") && !givenIcon.has(url)
        ? actual.getFaviconUrl(url)
        : "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  };
});

// The routes the row's actions reach, each answering at once so what hangs
// off a success can be seen, and the one the open gestures bind whether or
// not they are used.
vi.mock("@/client/rpc/client", () => {
  const routeOf = (call: Mock) => ({
    call: (input: unknown) => {
      call(input);
      return Promise.resolve();
    },
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
      transcript: {
        copy: routeOf(vi.fn()),
        save: routeOf(calls.transcript),
      },
      utils: {
        // The Finder's icon is decorative; the row draws its glyph without it.
        fileManagerApp: {
          queryOptions: () => ({
            queryFn: () => ({ appPath: null, iconUrl: null }),
            queryKey: ["fileManagerApp"],
          }),
        },
        openExternalLink: routeOf(vi.fn()),
        showFileInFolder: routeOf(vi.fn()),
      },
      workspace: {
        chats: {
          archive: routeOf(calls.archive),
          // Only for its key, which the actions paint their marks onto.
          live: {
            list: {
              experimental_liveOptions: () => ({ queryKey: ["chats"] }),
            },
          },
          rename: routeOf(calls.rename),
          retitle: routeOf(calls.retitle),
          read: routeOf(calls.read),
          star: routeOf(calls.star),
          unarchive: routeOf(calls.unarchive),
          unread: routeOf(calls.unread),
        },
      },
    },
  };
});

const sessionId = StoreId.newSessionId();

const CHAT_ID = ChatIdSchema.parse("2026-09-16-nest-eco-mode-guard");

/** The input every route of the row's is asked with. */
const INPUT = { id: CHAT_ID };

/** The moment every row is read at: a Wednesday afternoon. */

/** When the fixture's chat last moved, earlier the same day. */
const MOVED_AT = new Date(2026, 8, 16, 9, 11);

/** The afternoon the rows are read in: the same day the chat last moved. */
const NOW = new Date(2026, 8, 16, 14, 30);

/** The morning the fixture's chat began. */
const STARTED_AT = new Date(2026, 8, 16, 8, 46);

const ASK = "Guard the Nest eco mode before 5 p.m.";

const TITLE = "Second-floor Nest eco mode guard before 5 p.m.";

const REPLY = "Done: the automation now checks presence first.";

/** A long reply, so a clamp has something to cut. */
const LONG_REPLY =
  "Done: the automation now checks presence first, then the hour, then the thermostat's own schedule, and only then trips eco mode, which it also undoes on the way back before five so the second floor is warm when anyone comes up.";

function chat(overrides: Partial<Chat> = {}): Chat {
  const messageId = StoreId.newMessageId();
  return {
    archived: false,
    createdAt: STARTED_AT.getTime(),
    holds: { apps: [], files: [], sites: [] },
    id: CHAT_ID,
    lastReplyAt: MOVED_AT.getTime(),
    latest: { at: MOVED_AT.getTime(), kind: "reply", text: REPLY },
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
    sessionId,
    starred: false,
    state: "idle",
    title: TITLE,
    titled: true,
    topics: [],
    unread: false,
    unreadByUser: false,
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
  const bar = row.querySelector<HTMLElement>('[data-slot="row-actions"]');
  if (!bar) {
    throw new Error("no action bar");
  }
  return {
    bar,
    // The actions past the control that files the chat, which leads.
    labels: [...bar.querySelectorAll("button")]
      .map((button) => button.getAttribute("aria-label"))
      .filter((label) => label !== "Topics"),
  };
}

/** A state dot in front of the title, which no row wears. */
function dotOf(row: HTMLElement) {
  return row.querySelector<HTMLElement>(
    '[aria-label="Unread"], [aria-label="Working"], [aria-label="Needs you"]',
  );
}

/** The first line of a tall row: the title and the pills at its end. */
function firstLineOf(row: HTMLElement) {
  const line = row.firstElementChild?.firstElementChild;
  if (!(line instanceof HTMLElement)) {
    throw new TypeError("no first line");
  }
  return line;
}

function isHTMLElement(element: Element): element is HTMLElement {
  return element instanceof HTMLElement;
}

/** The marks on the row's line of holds: the file chips, the bare marks, and the count. */
function marksOf(row: HTMLElement) {
  const line = row.querySelector<HTMLElement>('[data-slot="holds"]');
  return line ? [...line.children].filter(isHTMLElement) : [];
}

/** The window the pane sits in, as far as a row can tell: every opener lands in a tab of its own. */
function paneWindow(openScreen = vi.fn()): WindowContextValue {
  return {
    ask: vi.fn(),
    browser: null,
    focusComposer: vi.fn(),
    openPage: vi.fn(),
    openPath: vi.fn(),
    openScreen,
  };
}

/** The agent's latest line, the one thing on the row set in the smaller size. */
function peekOf(row: HTMLElement) {
  return row.querySelector<HTMLElement>('[class*="text-[12px]"]');
}

/** The pill of the topic the chat is filed under: a label, not a control. */
function pillOf(row: HTMLElement) {
  return row.querySelector<HTMLElement>("span.rounded-full");
}

async function renderRow(
  row: Chat,
  {
    onOpen = vi.fn(),
    onSetTopics = vi.fn(),
    openScreen = vi.fn(),
    store,
  }: {
    onOpen?: Mock<() => void>;
    onSetTopics?: Mock<(topics: string[]) => void>;
    openScreen?: Mock<(href: string) => void>;
    store?: ReturnType<typeof createStore>;
  } = {},
) {
  const { rows, ...rest } = await renderRows([row], {
    onOpen,
    onSetTopics,
    openScreen,
    store,
  });
  const [element] = rows;
  if (!element) {
    throw new Error("no row");
  }
  return { ...rest, onOpen, onSetTopics, openScreen, row: element };
}

/** Several rows at once, each in a box of the list's width, so one test can compare them without a second render. */
async function renderRows(
  chats: Chat[],
  {
    onOpen = vi.fn(),
    onSetTopics = vi.fn(),
    openScreen = vi.fn(),
    store,
  }: {
    onOpen?: Mock<() => void>;
    onSetTopics?: Mock<(topics: string[]) => void>;
    openScreen?: Mock<(href: string) => void>;
    /** A store with atoms already set, for what the row reads beyond its props. */
    store?: ReturnType<typeof createStore>;
  } = {},
) {
  // The rows' actions come from the list, which asks once for all of them.
  function Rows() {
    const actionsFor = useChatActionsFor();
    return chats.map((entry, index) => (
      <div key={index} style={{ width: "400px" }}>
        <ChatRow
          actions={actionsFor(entry)}
          appsBySlug={
            new Map([
              ["github", { name: "GitHub", site: "https://github.com" }],
            ])
          }
          chat={entry}
          isOpen={false}
          now={NOW}
          onDelete={vi.fn()}
          onNewTopic={vi.fn()}
          onOpen={onOpen}
          onSetTopics={onSetTopics}
          topics={[HOUSE, MONEY]}
        />
      </div>
    ));
  }
  const window = paneWindow(openScreen);
  const rendered = await renderInBrowser(
    <WindowContext value={window}>
      {/* The toasts the row's actions raise land here, and stay until read. */}
      <Toaster duration={Infinity} />
      <Rows />
    </WindowContext>,
    store ? { store } : {},
  );
  const rows = [
    ...rendered.container.querySelectorAll<HTMLElement>('[role="button"]'),
  ];
  return { ...rendered, onOpen, onSetTopics, openScreen, rows, window };
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

describe("ChatRow", () => {
  it("stacks: the title with the pill at its end on one line, the latest under it, the files and the time under that", async () => {
    const { row } = await renderRow(
      chat({
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
    // The time in the bottom corner. The innermost span with its words,
    // since the corner around it has them too.
    const time = [...row.querySelectorAll("span")]
      .findLast((span) => span.textContent === "9:11 AM")
      ?.getBoundingClientRect();
    expect(time?.top).toBeGreaterThanOrEqual(
      peek?.getBoundingClientRect().bottom ?? 0,
    );
    expect(time?.right).toBeLessThanOrEqual(row.getBoundingClientRect().right);
  });

  it("keeps one row height whether a chat holds anything or has said anything", async () => {
    const { rows } = await renderRows([
      chat({ holds: { apps: [], files: ["/task/out/report.md"], sites: [] } }),
      chat(),
      chat({ lastReplyAt: undefined, latest: undefined }),
      chat({ state: "working" }),
    ]);
    const heights = new Set(
      rows.map((row) => Math.round(row.getBoundingClientRect().height)),
    );
    expect(heights.size).toBe(1);
  });

  it("gives the latest line one line", async () => {
    const { row } = await renderRow(
      chat({
        latest: { at: MOVED_AT.getTime(), kind: "reply", text: LONG_REPLY },
      }),
    );
    const peek = peekOf(row);
    expect(peek?.querySelector(".truncate")).not.toBeNull();
    expect(peek?.getBoundingClientRect().height).toBeLessThan(24);
  });

  it("carries no reply count, and the time", async () => {
    const { row } = await renderRow(chat());
    expect(row.querySelector('[aria-label="3 replies"]')).toBeNull();
    expect(firstLineOf(row).textContent).toBe(TITLE);
    expect(row.textContent).toContain("9:11 AM");
  });

  it.each<[string, Partial<Chat>]>([
    ["quiet", {}],
    ["unseen", { unread: true }],
    ["working", { state: "working" }],
    ["waiting", { state: "waiting" }],
  ])(
    "wears no dot when %s: the latest line says where it stands",
    async (_, overrides) => {
      const { row } = await renderRow(chat(overrides));
      expect(dotOf(row)).toBeNull();
    },
  );

  it("sets the title in semibold only while something in it is unseen", async () => {
    const { rows } = await renderRows([chat({ unread: true }), chat()]);
    const [unseen, seen] = rows;
    if (!unseen || !seen) {
      throw new Error("no rows");
    }
    expect(titleOf(unseen).className).toContain("font-semibold");
    expect(titleOf(seen).className).not.toContain("font-semibold");
  });

  it("says Draft in red right after the title while the chat's composer holds words", async () => {
    const store = createStore();
    store.set(
      promptDraftAtom({ chatId: CHAT_ID, scope: "chat" }),
      "and keep the porch light on",
    );
    const { row } = await renderRow(chat({ topics: ["house"] }), {
      store,
    });
    const draft = [...row.querySelectorAll("span")].find(
      (span) => span.textContent === "Draft",
    );
    expect(draft?.className).toContain("text-error-700");
    // Beside the title's words, before the pill, and never the draft's words.
    const title = titleOf(row).getBoundingClientRect();
    const worn = draft?.getBoundingClientRect();
    expect(worn?.left).toBeGreaterThanOrEqual(title.right);
    expect(worn?.left).toBeLessThan(title.right + 16);
    expect(worn?.left).toBeLessThan(
      pillOf(row)?.getBoundingClientRect().left ?? 0,
    );
    expect(row.textContent).not.toContain("porch light");
  });

  it("says nothing of a draft that is only whitespace", async () => {
    const store = createStore();
    store.set(promptDraftAtom({ chatId: CHAT_ID, scope: "chat" }), "  \n");
    const { row } = await renderRow(chat(), { store });
    expect(row.textContent).not.toContain("Draft");
  });

  it("wears a pill per topic, each by name, at the title's end", async () => {
    const { row } = await renderRow(chat({ topics: ["money", "house"] }));
    const pills = [...row.querySelectorAll("span.rounded-full")];
    expect(pills.map((pill) => pill.textContent)).toEqual([
      "💸Money",
      "🏠House",
    ]);
  });

  it("shows the step in brand while working, and the question behind the amber glyph while waiting", async () => {
    const { rows } = await renderRows([
      chat({
        latest: undefined,
        runningTasks: [
          {
            id: TaskIdSchema.parse("nest-guard"),
            step: "Reading the automation",
            title: "Nest guard",
          },
        ],
        state: "working",
      }),
      chat({
        latest: {
          at: MOVED_AT.getTime(),
          kind: "question",
          text: "Reuse the old CSR, or generate a new one?",
        },
        state: "waiting",
      }),
    ]);
    const [working, waiting] = rows;
    if (!working || !waiting) {
      throw new Error("no rows");
    }
    expect(working.querySelector(".brand-shiny-text")?.textContent).toBe(
      "Reading the automation",
    );
    expect(peekOf(working)?.textContent).toBe("Reading the automation");
    const peek = peekOf(waiting);
    expect(peek?.textContent).toBe("Reuse the old CSR, or generate a new one?");
    expect(peek?.querySelector("svg.text-warning-700")).not.toBeNull();
  });

  it("shows only Instrument is working until a task starts", async () => {
    const working = chat({
      lastAsk: "Check the Nest schedule",
      latest: undefined,
      state: "working",
    });
    const { row } = await renderRow(working);
    expect(peekOf(row)?.textContent).toBe("Instrument is working");
  });

  it("shows only Instrument is working until the task's first step lands", async () => {
    const { row } = await renderRow(
      chat({
        latest: undefined,
        runningTasks: [
          { id: TaskIdSchema.parse("nest-guard"), title: "Nest guard" },
        ],
        state: "working",
      }),
    );
    expect(peekOf(row)?.textContent).toBe("Instrument is working");
  });

  it("says a chat stopped on an error in red, in place of its latest line", async () => {
    const { row } = await renderRow(chat({ state: "failed" }));
    expect(peekOf(row)?.textContent).toBe("Stopped on an error");
  });

  it("has no latest line for an idle chat with nothing to say", async () => {
    const { row } = await renderRow(
      chat({ lastReplyAt: undefined, latest: undefined }),
    );
    expect(peekOf(row)).toBeNull();
    expect(row.textContent).toBe(`${TITLE}9:11 AM`);
  });

  it("opens the chat from a click anywhere on it, and from Enter", async () => {
    const { onOpen, openScreen, row } = await renderRow(
      chat({ topics: ["house"] }),
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

  it.each([
    {
      event: () =>
        new MouseEvent("click", {
          bubbles: true,
          ctrlKey: !isMacOS(),
          metaKey: isMacOS(),
        }),
      gesture: "modified click",
    },
    {
      event: () => new MouseEvent("auxclick", { bubbles: true, button: 1 }),
      gesture: "middle click",
    },
  ])(
    "opens the chat in a tab behind the one up on a $gesture",
    async ({ event }) => {
      const { onOpen, openScreen, row } = await renderRow(chat());
      titleOf(row).dispatchEvent(event());
      expect(onOpen).not.toHaveBeenCalled();
      expect(openScreen).toHaveBeenCalledWith(`/chats/${CHAT_ID}`, {
        behind: true,
        newTab: true,
      });
    },
  );

  it("tints the full width on hover and swaps the pills for the corner's controls", async () => {
    const { row } = await renderRow(
      chat({
        holds: { apps: [], files: ["/task/out/report.md"], sites: [] },
        topics: ["house"],
      }),
    );
    const control = row.querySelector<HTMLElement>('[aria-label="Topics"]');
    const pill = pillOf(row);
    if (!control || !pill) {
      throw new Error("no tag control or pill");
    }
    // The pointer is shared across test files, so it may sit wherever another
    // file left it, over the row just drawn. Move it off before reading rest.
    await userEvent.unhover(row);
    // Out of the flow at rest: it takes no room until the pointer arrives.
    expect(control.getClientRects().length).toBe(0);
    expect(getComputedStyle(pill).visibility).toBe("visible");
    const chipBefore = marksOf(row)[0]?.getBoundingClientRect();
    const titleBefore = titleOf(row).getBoundingClientRect();
    await userEvent.hover(titleOf(row));
    await vi.waitFor(() => {
      expect(control.getClientRects().length).toBeGreaterThan(0);
    });
    // In the row's top corner, where the pills were, which step aside.
    expect(getComputedStyle(pill).visibility).toBe("hidden");
    const box = control.getBoundingClientRect();
    const edge = row.getBoundingClientRect();
    expect(box.top).toBeLessThan(titleBefore.bottom);
    expect(box.right).toBeLessThanOrEqual(edge.right);
    // The tint is a square bar across the row's full width, the open row's
    // bar in grey, rather than a rounded field inside the row.
    expect(getComputedStyle(row).backgroundColor).toBe("rgba(0, 0, 0, 0)");
    const tint = getComputedStyle(row, "::before");
    expect(tint.opacity).toBe("1");
    expect(tint.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
    expect(tint.borderRadius).toBe("0px");
    expect([tint.left, tint.right]).toEqual(["0px", "0px"]);
    // Nothing on the row moves with the pointer.
    expect(titleOf(row).getBoundingClientRect()).toEqual(titleBefore);
    expect(marksOf(row)[0]?.getBoundingClientRect()).toEqual(chipBefore);
    await userEvent.unhover(titleOf(row));
  });

  it("carries what it holds as chips named for the files and bare marks for the rest, behind a count past a few", async () => {
    const holds = {
      apps: ["github"],
      files: ["/task/out/report.md", "/task/out/data.csv"],
      sites: ["wakatime.com", "example.com", "example.org", "example.net"],
    };
    const { rows } = await renderRows([chat({ holds })]);
    for (const row of rows) {
      const marks = marksOf(row);
      // Five marks, then a count of the two that did not get one.
      expect(marks).toHaveLength(6);
      expect(marks.at(-1)?.textContent).toBe("+2");
      // The files first, newest first, each named and a door; the app and
      // the sites bare, and nothing to press: the chat's face, not its
      // openers.
      expect(marks.slice(0, 2).map((mark) => mark.textContent)).toEqual([
        "data.csv",
        "report.md",
      ]);
      expect(marks.slice(0, 2).every((mark) => mark.tagName === "BUTTON")).toBe(
        true,
      );
      expect(
        marks
          .slice(2, 5)
          .every(
            (mark) =>
              mark.textContent === "" && Object.hasOwn(mark.dataset, "inert"),
          ),
      ).toBe(true);
      expect(row.textContent).not.toContain("/task");
      expect(row.textContent).not.toContain("wakatime.com");
    }
  });

  it("keeps what it holds to one line, the files first, clipped at the row's edge rather than wrapped", async () => {
    const files = Array.from(
      { length: 4 },
      (_, index) => `/task/out/a-report-with-a-long-name-${index}.md`,
    );
    const holds = { apps: ["github"], files, sites: ["wakatime.com"] };
    const { rows } = await renderRows([
      chat({ holds }),
      chat({ holds: { ...holds, files: files.slice(0, 1) } }),
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
    // An app the workspace does not know draws its initial, which needs no
    // icon to arrive before the mark holds still under the pointer.
    const { row } = await renderRow(
      chat({ holds: { apps: ["paper"], files: [], sites: [] } }),
    );
    const [app] = marksOf(row);
    if (!app) {
      throw new Error("no mark");
    }
    await userEvent.hover(app);
    // The tooltip and the announcement it carries for the screen reader are
    // two elements with the role; either says the name.
    await expect
      .element(page.getByRole("tooltip").first())
      .toHaveTextContent("paper");
    await userEvent.unhover(app);
  });

  it("leaves out a site whose icon resolves nowhere, rather than drawing a globe for it", async () => {
    const { row } = await renderRow(
      chat({
        holds: {
          apps: ["paper"],
          files: [],
          // A name no resolver answers, so the proxy and the site both fail
          // it, and quickly.
          sites: ["no-such-site.invalid"],
        },
      }),
    );
    // The site's mark goes once its icon has failed everywhere; the app's
    // stays.
    await vi.waitFor(
      () => {
        expect(marksOf(row)).toHaveLength(1);
      },
      { timeout: 5000 },
    );
    expect(
      row.querySelector('[aria-label="Favicon for no-such-site.invalid"]'),
    ).toBe(null);
  });

  it("brings a site back once it is given the icon it failed to have", async () => {
    const site = "later-icon.invalid";
    const { row } = await renderRow(
      chat({ holds: { apps: [], files: [], sites: [site] } }),
    );
    // Gone once its first lookup fails...
    await vi.waitFor(
      () => {
        expect(marksOf(row)).toHaveLength(0);
      },
      { timeout: 5000 },
    );
    // ...and back in the same row, with no remount, once it has an icon.
    givenIcon.add(`https://${site}`);
    forgetIconlessThisSession(site);
    await vi.waitFor(() => {
      expect(marksOf(row)).toHaveLength(1);
    });
    expect(row.querySelector(`img[alt="Favicon for ${site}"]`)).not.toBeNull();
  });

  it("lists every hold by name behind the count, never a slug or a path", async () => {
    const files = Array.from(
      { length: 6 },
      (_, index) => `/task/out/report-${index}.md`,
    );
    const { row } = await renderRow(
      chat({ holds: { apps: ["paper"], files, sites: [] } }),
    );
    const count = marksOf(row).at(-1);
    if (!count) {
      throw new Error("no count");
    }
    await userEvent.click(count);
    const list = page.getByRole("dialog");
    await expect.element(list).toBeVisible();
    const rows = [...list.element().querySelectorAll('[data-slot="hold"]')];
    // The app's row carries its initial as its icon, then its name.
    expect(rows.map((entry) => entry.textContent)).toEqual([
      ...files.toReversed().map((path) => path.split("/").at(-1)),
      "Ppaper",
    ]);
    // The files are doors; the app is named and nothing more.
    expect(rows.map((entry) => entry.tagName)).toEqual([
      ...files.map(() => "BUTTON"),
      "SPAN",
    ]);
    await userEvent.keyboard("{Escape}");
  });

  it("opens a file it holds inside its chat, as a tab of the chat's group, shown, without opening the row; an app or a site it used opens nothing", async () => {
    const { onOpen, openScreen, row, window } = await renderRow(
      chat({
        holds: { apps: ["github"], files: ["/task/out/report.md"], sites: [] },
      }),
    );
    const [file, app] = marksOf(row);
    file?.click();
    expect(onOpen).not.toHaveBeenCalled();
    expect(window.openPath).toHaveBeenCalledWith("/task/out/report.md", {
      group: CHAT_ID,
      ownTab: true,
      show: true,
    });
    file?.dispatchEvent(
      new MouseEvent("auxclick", { bubbles: true, button: 1 }),
    );
    expect(window.openPath).toHaveBeenCalledTimes(2);
    app?.click();
    expect(onOpen).not.toHaveBeenCalled();
    expect(openScreen).not.toHaveBeenCalled();
  });

  it("opens the chat's topic list from the corner's tag control, which files the chat rather than opening it, and holds the corner while the list leaves", async () => {
    const { onOpen, onSetTopics, row } = await renderRow(
      chat({ topics: ["house"] }),
    );
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
    await userEvent.click(list.getByText("Money"));
    expect(onSetTopics).toHaveBeenCalledWith(["house", "money"]);
    expect(onOpen).not.toHaveBeenCalled();
    // The pointer leaves as the list closes; the control stays for the
    // list's way out, so the list is not left without an anchor. The hold is
    // a timer, faked so the two round trips to the browser cannot outlast it.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      await userEvent.keyboard("{Escape}");
      await userEvent.unhover(row);
      expect(control.getClientRects().length).toBeGreaterThan(0);
      vi.runOnlyPendingTimers();
    } finally {
      vi.useRealTimers();
    }
    await vi.waitFor(() => {
      expect(control.getClientRects().length).toBe(0);
    });
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
    developerMode.enabled = false;
  });

  it("stand over the row's right end while the pointer is on it, out of the flow at rest", async () => {
    const { row } = await renderRow(chat());
    const { bar, labels } = barOf(row);
    expect(labels).toEqual(["Archive", "Mark as unread", "Star"]);
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
    expect(titleOf(row).getBoundingClientRect().top).toBeCloseTo(before.top, 0);
    await userEvent.unhover(titleOf(row));
  });

  it("puts the chat away from its edge, short of the door, and offers it back from the toast", async () => {
    const { onOpen, row } = await renderRow(chat());
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

  it("offers a chat put away the way back", async () => {
    const { row } = await renderRow(chat({ archived: true }));
    expect(barOf(row).labels).toEqual(["Unarchive", "Mark as unread", "Star"]);
    await userEvent.hover(titleOf(row));
    await userEvent.click(actionOf(row, "Unarchive"));
    expect(calls.unarchive).toHaveBeenCalledWith(INPUT);
    expect(calls.archive).not.toHaveBeenCalled();
    await expect.element(page.getByText("Moved to Inbox")).toBeVisible();
  });

  it.each<[string, Partial<Chat>, Mock]>([
    ["Mark as read", { unread: true }, calls.read],
    ["Mark as unread", { unread: false }, calls.unread],
  ])(
    "offers %s, which asks the route and says nothing",
    async (label, overrides, call) => {
      const { onOpen, row } = await renderRow(chat(overrides));
      await userEvent.hover(titleOf(row));
      await userEvent.click(actionOf(row, label));
      expect(call).toHaveBeenCalledWith(INPUT);
      expect(onOpen).not.toHaveBeenCalled();
      // The route has answered by now; no toast followed.
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(document.querySelector("[data-sonner-toast]")).toBeNull();
    },
  );

  it("offers Mark as unread on a chat with nothing said in it yet", async () => {
    const { row } = await renderRow(
      chat({ lastReplyAt: undefined, latest: undefined, unread: false }),
    );
    expect(barOf(row).labels).toEqual(["Archive", "Mark as unread", "Star"]);
  });

  it("raises the row's menu on a right click: the way in, the actions, and the topics", async () => {
    const { onOpen, onSetTopics, row } = await renderRow(
      chat({ unread: true }),
    );
    await userEvent.click(titleOf(row), { button: "right" });
    const menu = page.getByRole("menu");
    await expect.element(menu).toBeVisible();
    expect(
      [...menu.element().querySelectorAll('[role="menuitem"]')].map(
        (item) => item.textContent,
      ),
    ).toEqual([
      "Open",
      "Open in New Tab",
      "Mark as read",
      "Star",
      "Rename",
      "Topics",
      getRevealInFolderLabel(),
      "Archive",
      "Delete chat…",
    ]);
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

  it("offers saving the transcript in developer mode alone, in its color", async () => {
    developerMode.enabled = true;
    const { row } = await renderRow(chat());
    await userEvent.click(titleOf(row), { button: "right" });
    const save = page.getByRole("menuitem", { name: "Save transcript" });
    await expect.element(save).toHaveAttribute("data-variant", "developer");
    await userEvent.click(save);
    expect(calls.transcript).toHaveBeenCalledWith(
      expect.objectContaining({ format: "markdown", sessionId }),
    );
  });

  // The click that puts a row's menu away is a click on whatever it landed
  // on: a reader who right-clicked one row and then clicked another asked to
  // open the second, and a menu that ate the click made the list feel dead.
  it("lets the click that puts one row's menu away open another row", async () => {
    const onOpen = vi.fn();
    const { rows } = await renderRows(
      [chat({ title: `${TITLE} one` }), chat({ title: `${TITLE} two` })],
      { onOpen },
    );
    const [first, second] = rows;
    if (!first || !second) {
      throw new Error("no rows");
    }
    await userEvent.click(first, { button: "right" });
    await expect.element(page.getByRole("menu")).toBeVisible();
    await userEvent.click(second);
    await expect.element(page.getByRole("menu")).not.toBeInTheDocument();
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  // The row's controls take a click each, so the click stops at them; a
  // right click is the row's whatever is under the pointer, or the menu is
  // only there on the words.
  it("raises the row's menu on a right click on a pill, the star, and the corner's bar", async () => {
    const { onOpen, row } = await renderRow(chat({ topics: ["house"] }));
    const menu = page.getByRole("menu");
    for (const target of [
      pillOf(row),
      row.querySelector<HTMLElement>('[aria-label="Star"]'),
      row.querySelector<HTMLElement>('[aria-label="Topics"]'),
      row.querySelector<HTMLElement>('[aria-label="Archive"]'),
    ]) {
      if (!target) {
        throw new Error("no target");
      }
      await userEvent.click(target, { button: "right" });
      await expect.element(menu).toBeVisible();
      await userEvent.keyboard("{Escape}");
      await expect.element(menu).not.toBeInTheDocument();
    }
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("marks a starred row with a star past its topics, not a control", async () => {
    const { rows } = await renderRows([
      chat({ starred: true, topics: ["house"] }),
      chat(),
    ]);
    const [starred, plain] = rows;
    if (!starred || !plain) {
      throw new Error("no rows");
    }
    const mark = starred.querySelector('[aria-label="Starred"]');
    expect(mark?.closest("button")).toBeNull();
    expect(mark?.getBoundingClientRect().left).toBeGreaterThanOrEqual(
      pillOf(starred)?.getBoundingClientRect().right ?? 0,
    );
    expect(plain.querySelector('[aria-label="Starred"]')).toBeNull();
    // Taking the star back ends the corner's bar, over where the star stood.
    expect(barOf(starred).labels.at(-1)).toBe("Unstar");
  });
});
