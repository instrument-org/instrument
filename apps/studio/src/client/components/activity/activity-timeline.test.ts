import { describe, expect, it } from "vitest";

import {
  type ActivityRequest,
  actionText,
  type ActivityView,
  dayLabel,
  entriesShown,
  makerOfModel,
  moreFromOf,
  type PersonAction,
  placeOf,
  timelineOf,
  type TimelineEntry,
  turnText,
  withDayHeads,
} from "./activity-timeline";

// Times are local, so a day head is the same wherever the suite runs.
const at = (hour: number, minute: number, second = 0) =>
  new Date(2026, 10, 5, hour, minute, second).getTime();

const CHAT = "kitchen-remodel-quotes";
const OTHER_CHAT = "interest-on-1099s";

let ids = 0;
function request(
  startedAt: number,
  fields: Partial<ActivityRequest> = {},
): ActivityRequest {
  ids += 1;
  return {
    cacheReadTokens: null,
    cacheWriteTokens: null,
    chatId: CHAT,
    chatTitle: "Kitchen remodel quotes",
    connectionName: null,
    connectionType: "anthropic",
    device: null,
    durationMs: 1200,
    error: null,
    finishReason: null,
    id: `req_${ids}`,
    imageQuality: null,
    inputTokens: null,
    kind: "language",
    modelRequested: "anthropic/claude-haiku-5.5",
    modelServed: null,
    outputTokens: null,
    purpose: "chat",
    reasoningTokens: null,
    responseId: null,
    sessionId: "ses_1",
    startedAt,
    status: "finished",
    surface: null,
    totalTokens: 1000,
    ...fields,
  };
}

function action(time: number): PersonAction {
  return {
    at: new Date(time).toISOString(),
    kind: "folder",
    path: "/Users/sam/Downloads/Sam taxes 2025",
  };
}

const done = <T>(items: T[]) => ({ complete: true, items });

/** The list as rows: an action by its time, a turn by its requests' ids. */
function rows(entries: TimelineEntry[]) {
  return entries.map((entry) =>
    entry.kind === "action"
      ? `action ${new Date(entry.at).toTimeString().slice(0, 5)}`
      : `turn ${entry.turn.requests.map((each) => each.id).join(",")}`,
  );
}

describe("timelineOf", () => {
  it("gathers a chat turn's requests, its title request with them, and splits turns at an action, a five-minute pause, another session, and no chat", () => {
    ids = 0;
    const requests = [
      request(at(14, 44, 30)), // req_1
      request(at(14, 44, 0)), // req_2
      request(at(14, 43, 0)), // req_3, an action at 14:42 comes before it
      request(at(14, 41, 0)), // req_4
      request(at(14, 35, 0)), // req_5, six minutes before req_4
      request(at(14, 34, 50), { sessionId: "ses_task" }), // req_6
      request(at(14, 34, 40), { purpose: "chat-title", sessionId: null }), // req_7, naming the chat, joins its turn
      request(at(14, 30, 0), {
        chatId: null,
        chatTitle: null,
        purpose: "settings-search",
        sessionId: null,
        surface: "settings",
      }), // req_8
      request(at(14, 29, 50), {
        chatId: null,
        chatTitle: null,
        purpose: "settings-search",
        sessionId: null,
        surface: "settings",
      }), // req_9
    ];
    const { entries, waitingOn } = timelineOf({
      actions: done([action(at(14, 42))]),
      requests: done(requests),
      view: "all",
    });
    expect(waitingOn).toEqual([]);
    expect(rows(entries)).toMatchInlineSnapshot(`
      [
        "turn req_1,req_2,req_3",
        "action 14:42",
        "turn req_4",
        "turn req_5,req_7",
        "turn req_6",
        "turn req_8,req_9",
      ]
    `);
  });

  it("keeps two chats' turns apart while their requests interleave", () => {
    ids = 0;
    const { entries } = timelineOf({
      actions: done([]),
      requests: done([
        request(at(14, 44)),
        request(at(14, 43), { chatId: OTHER_CHAT }),
        request(at(14, 42)),
        request(at(14, 41), { chatId: OTHER_CHAT }),
      ]),
      view: "all",
    });
    expect(rows(entries)).toEqual(["turn req_1,req_3", "turn req_2,req_4"]);
  });

  it("shows only as far back as the log that has read least, and waits on that one", () => {
    ids = 0;
    const requests = [request(at(14, 40)), request(at(12, 0))];
    const actions = [action(at(14, 50)), action(at(14, 30))];
    const partial = timelineOf({
      actions: { complete: false, items: actions },
      requests: done(requests),
      view: "all",
    });
    expect(rows(partial.entries)).toEqual([
      "action 14:50",
      "turn req_1",
      "action 14:30",
    ]);
    expect(partial.waitingOn).toEqual(["actions"]);

    const loading = timelineOf({
      actions: { complete: false, items: [] },
      requests: done(requests),
      view: "all",
    });
    expect(loading).toEqual({ entries: [], waitingOn: ["actions"] });

    const whole = timelineOf({
      actions: done(actions),
      requests: done(requests),
      view: "all",
    });
    expect(rows(whole.entries).at(-1)).toBe("turn req_2");
  });

  it.each<[ActivityView, string[]]>([
    ["all", ["action 14:50", "turn req_1", "action 14:30"]],
    ["yours", ["action 14:50", "action 14:30"]],
    ["ai", ["turn req_1"]],
  ])("shows %s", (view, expected) => {
    ids = 0;
    const { entries, waitingOn } = timelineOf({
      // The log a view leaves out is never waited on, loaded or not.
      actions: {
        complete: view === "ai" ? false : true,
        items: [action(at(14, 50)), action(at(14, 30))],
      },
      requests: { complete: view !== "yours", items: [request(at(14, 40))] },
      view,
    });
    expect(rows(entries)).toEqual(expected);
    expect(waitingOn).toEqual([]);
  });

  it("leaves out where the log stopped writing", () => {
    const { entries } = timelineOf({
      actions: done([
        {
          at: new Date(at(14, 0)).toISOString(),
          dropped: 4,
          kind: "capped",
          of: "move",
        },
      ]),
      requests: done([]),
      view: "all",
    });
    expect(entries).toEqual([]);
  });
});

describe("withDayHeads", () => {
  it("heads each day with its weekday and date, after Today or Yesterday, with the year only when it is not this one", () => {
    const now = new Date(2026, 10, 5, 15, 0);
    const day = (month: number, date: number, year = 2026) =>
      dayLabel(new Date(year, month, date, 9, 0).getTime(), now, "en-US");
    expect([day(10, 5), day(10, 4), day(10, 3), day(11, 31, 2025)])
      .toMatchInlineSnapshot(`
        [
          "Today · Thursday, November 5",
          "Yesterday · Wednesday, November 4",
          "Tuesday, November 3",
          "Wednesday, December 31, 2025",
        ]
      `);
    ids = 0;
    const { entries } = timelineOf({
      actions: done([action(at(14, 0)), action(at(9, 0))]),
      requests: done([request(new Date(2026, 10, 4, 20, 0).getTime())]),
      view: "all",
    });
    expect(
      withDayHeads(entries, now, "en-US").map((item) =>
        item.kind === "day" ? item.label : item.kind,
      ),
    ).toEqual([
      "Today · Thursday, November 5",
      "action",
      "action",
      "Yesterday · Wednesday, November 4",
      "turn",
    ]);
  });
});

describe("actionText", () => {
  const time = new Date(at(14, 0)).toISOString();
  const actions: PersonAction[] = [
    {
      at: time,
      kind: "folder",
      path: "/Users/sam/Downloads/Sam taxes 2025",
      selected: ["a.pdf"],
    },
    {
      at: time,
      kind: "file",
      path: "/Users/sam/Downloads/Sam taxes 2025/1099-INT Capital One.pdf",
    },
    {
      app: "Numbers",
      at: time,
      kind: "open-with",
      path: "/Users/sam/Documents/Budget.xlsx",
    },
    { at: time, kind: "open-with", path: "/Users/sam/Documents/Budget.xlsx" },
    { at: time, kind: "edit", path: "/Users/sam/Trips/Lisbon in March.md" },
    {
      at: time,
      from: "/Users/sam/Downloads",
      kind: "move",
      names: ["a.pdf", "b.pdf", "c.pdf"],
      to: "/Users/sam/Archive/2023",
    },
    {
      at: time,
      from: "/Users/sam/Desktop",
      kind: "copy",
      names: ["Receipt.pdf"],
      to: "/Users/sam/Taxes",
    },
    {
      at: time,
      from: "/Users/sam/Pictures/IMG_2210.jpg",
      kind: "rename",
      to: "/Users/sam/Pictures/Porch.jpg",
    },
    { at: time, kind: "trash", paths: ["/Users/sam/Documents/old draft.docx"] },
    {
      at: time,
      kind: "trash",
      paths: [
        "C:\\Users\\sam\\Documents\\a.txt",
        "C:\\Users\\sam\\Documents\\b.txt",
      ],
    },
    { at: time, kind: "new-folder", path: "/Users/sam/Documents/Receipts" },
    { at: time, id: CHAT, kind: "chat", title: "Kitchen remodel quotes" },
    {
      at: time,
      kind: "page",
      title: "Where's My Refund?",
      url: "https://www.irs.gov/refunds",
    },
    { at: time, kind: "page", url: "https://www.irs.gov/refunds" },
    {
      at: time,
      kind: "download",
      path: "/Users/sam/Downloads/Globex NDA.pdf",
      url: "https://globex.com/nda.pdf",
    },
    { at: time, did: "sign-in failed", kind: "app", name: "Gmail" },
    { at: time, did: "signed in", kind: "app", name: "Gmail" },
    { at: time, did: "disconnected", kind: "app", name: "Gmail" },
    { at: time, from: "2.0.13", kind: "update", to: "2.0.14" },
    {
      at: time,
      did: "allowed",
      id: CHAT,
      kind: "permission",
      path: "/Users/sam/Downloads",
      title: "Kitchen remodel quotes",
    },
    {
      app: "Gmail",
      at: time,
      did: "allowed",
      id: CHAT,
      kind: "permission",
      title: "Kitchen remodel quotes",
    },
    {
      at: time,
      did: "refused",
      id: CHAT,
      kind: "permission",
      path: "/Users/sam/Downloads",
      title: "Kitchen remodel quotes",
    },
    {
      at: time,
      kind: "error",
      message: "Couldn't show “scan-0412.heic”.",
      where: "the file viewer",
    },
    { at: time, kind: "error", message: "Couldn't save. The disk is full." },
    { at: time, kind: "screen", name: "Settings › Models" },
    { at: time, kind: "setting", name: "Zoom", value: "110%" },
  ];

  it("names what each row is about, then what was done with it, without quotes", () => {
    expect(
      actions.flatMap((each) => {
        if (each.kind === "capped") {
          return [];
        }
        const { context, title } = actionText(each, { trash: "Trash" });
        return [`${each.kind}: ${title} | ${context}`];
      }),
    ).toMatchInlineSnapshot(`
      [
        "folder: Sam taxes 2025 | ",
        "file: 1099-INT Capital One.pdf | ",
        "open-with: Budget.xlsx | Opened in Numbers",
        "open-with: Budget.xlsx | Opened in another app",
        "edit: Lisbon in March.md | Edited",
        "move: a.pdf and 2 more | Moved to 2023",
        "copy: Receipt.pdf | Copied to Taxes",
        "rename: Porch.jpg | Renamed from IMG_2210.jpg",
        "trash: old draft.docx | Moved to the Trash",
        "trash: a.txt and 1 more | Moved to the Trash",
        "new-folder: Receipts | New folder",
        "chat: Kitchen remodel quotes | Chat",
        "page: Where's My Refund? | irs.gov",
        "page: irs.gov/refunds | irs.gov",
        "download: Globex NDA.pdf | Downloaded from globex.com",
        "app: Gmail | Couldn't sign in",
        "app: Gmail | Signed in",
        "app: Gmail | Disconnected",
        "update: Instrument 2.0.14 | Updated",
        "permission: Downloads | Allowed Kitchen remodel quotes to use it",
        "permission: Gmail | Allowed Kitchen remodel quotes to use it",
        "permission: Downloads | Didn't allow Kitchen remodel quotes to use it",
        "error: Couldn't show “scan-0412.heic” | Error in the file viewer",
        "error: Couldn't save. The disk is full | Error",
        "screen: Settings › Models | ",
        "setting: Zoom | Changed to 110%",
      ]
    `);
  });

  it("opens what each row names, and nothing for an error or what went to the bin", () => {
    expect(
      actions.flatMap((each) =>
        each.kind === "capped"
          ? []
          : [`${each.kind}: ${JSON.stringify(placeOf(each))}`],
      ),
    ).toMatchInlineSnapshot(`
      [
        "folder: {"href":"/files?path=&root=%2FUsers%2Fsam%2FDownloads%2FSam+taxes+2025","kind":"screen"}",
        "file: {"href":"/files?file=%2FUsers%2Fsam%2FDownloads%2FSam%20taxes%202025%2F1099-INT%20Capital%20One.pdf&path=&root=~","kind":"screen"}",
        "open-with: {"href":"/files?file=%2FUsers%2Fsam%2FDocuments%2FBudget.xlsx&path=&root=~","kind":"screen"}",
        "open-with: {"href":"/files?file=%2FUsers%2Fsam%2FDocuments%2FBudget.xlsx&path=&root=~","kind":"screen"}",
        "edit: {"href":"/files?file=%2FUsers%2Fsam%2FTrips%2FLisbon%20in%20March.md&path=&root=~","kind":"screen"}",
        "move: {"href":"/files?path=&root=%2FUsers%2Fsam%2FArchive%2F2023&select=a.pdf","kind":"screen"}",
        "copy: {"href":"/files?path=&root=%2FUsers%2Fsam%2FTaxes&select=Receipt.pdf","kind":"screen"}",
        "rename: {"href":"/files?path=&root=%2FUsers%2Fsam%2FPictures&select=Porch.jpg","kind":"screen"}",
        "trash: undefined",
        "trash: undefined",
        "new-folder: {"href":"/files?path=&root=%2FUsers%2Fsam%2FDocuments%2FReceipts","kind":"screen"}",
        "chat: {"href":"/chats/kitchen-remodel-quotes","kind":"screen"}",
        "page: {"kind":"page","url":"https://www.irs.gov/refunds"}",
        "page: {"kind":"page","url":"https://www.irs.gov/refunds"}",
        "download: {"href":"/files?file=%2FUsers%2Fsam%2FDownloads%2FGlobex%20NDA.pdf&path=&root=~","kind":"screen"}",
        "app: {"href":"/apps","kind":"screen"}",
        "app: {"href":"/apps","kind":"screen"}",
        "app: {"href":"/apps","kind":"screen"}",
        "update: {"href":"/release-notes","kind":"screen"}",
        "permission: {"href":"/chats/kitchen-remodel-quotes","kind":"screen"}",
        "permission: {"href":"/chats/kitchen-remodel-quotes","kind":"screen"}",
        "permission: {"href":"/chats/kitchen-remodel-quotes","kind":"screen"}",
        "error: undefined",
        "error: undefined",
        "screen: {"href":"/settings/Models","kind":"screen"}",
        "setting: {"href":"/settings/Zoom","kind":"screen"}",
      ]
    `);
  });
});

describe("entriesShown", () => {
  const entry = (did: PersonAction, n: number): TimelineEntry => {
    if (did.kind === "capped") {
      throw new Error("not a row");
    }
    return { action: did, at: at(14, n), id: String(n), kind: "action" };
  };
  const time = new Date(at(14, 0)).toISOString();
  const entries: TimelineEntry[] = [
    entry(
      {
        at: time,
        kind: "page",
        title: "Refunds",
        url: "https://www.irs.gov/refunds",
      },
      1,
    ),
    entry({ at: time, kind: "file", path: "/Users/sam/Taxes/w2.pdf" }, 2),
    entry(
      { at: time, id: CHAT, kind: "chat", title: "Kitchen remodel quotes" },
      3,
    ),
    entry({ at: time, kind: "setting", name: "Zoom", value: "110%" }, 4),
    {
      at: at(14, 5),
      id: "req_turn",
      kind: "turn",
      turn: { id: "req_turn", requests: [request(at(14, 5))] },
    },
  ];
  const shown = (q: string, show?: "ai" | "chats" | "files" | "pages") =>
    entriesShown(entries, {
      modelName: (id) => (id === null ? "" : "Claude Haiku 5.5"),
      q,
      show,
      words: { trash: "Trash" },
    }).map((each) => each.id);

  it.each([
    ["pages", ["1"]],
    ["files", ["2"]],
    ["chats", ["3"]],
    ["ai", ["req_turn"]],
  ] as const)("shows only %s under its filter", (show, expected) => {
    expect(shown("", show)).toEqual(expected);
  });

  it("finds a row by its words, its path or its address, every word of the search", () => {
    expect(shown("")).toHaveLength(5);
    expect(shown("irs.gov")).toEqual(["1"]);
    expect(shown("/users/sam/taxes")).toEqual(["2"]);
    expect(shown("kitchen")).toEqual(["3", "req_turn"]);
    expect(shown("kitchen haiku")).toEqual(["req_turn"]);
    expect(shown("kitchen", "chats")).toEqual(["3"]);
  });

  it("searches More from a page's site, a file's folder, and a turn's chat", () => {
    expect(entries.map((each) => moreFromOf(each)?.q ?? null)).toEqual([
      "irs.gov",
      "/Users/sam/Taxes",
      "Kitchen remodel quotes",
      null,
      "Kitchen remodel quotes",
    ]);
  });
});

describe("makerOfModel", () => {
  it.each([
    ["anthropic/claude-haiku-5.5", "anthropic"],
    ["claude-opus-5-5", "anthropic"],
    ["gpt-6-luna", "openai"],
    ["instrument/auto", undefined],
    ["something-new", undefined],
    [null, undefined],
  ])("reads %s as made by %s", (id, maker) => {
    expect(makerOfModel(id)).toBe(maker);
  });
});

describe("turnText", () => {
  const names = (id: null | string) =>
    id === "anthropic/claude-haiku-5.5" ? "Claude Haiku 5.5" : (id ?? "");
  const text = (requests: ActivityRequest[]) => {
    const { context, title } = turnText(
      { id: requests[0]?.id ?? "", requests },
      names,
    );
    return `${title} | ${context}`;
  };

  it("names a turn by what led it, in its chat, with the model and how many requests", () => {
    ids = 0;
    expect([
      text([
        request(at(14, 44), { purpose: "next-message" }),
        request(at(14, 43)),
        request(at(14, 43), {
          kind: "search",
          modelRequested: "exa",
          purpose: "web-search",
        }),
        request(at(14, 42)),
      ]),
      text([request(at(14, 0), { purpose: "chat-title", sessionId: null })]),
      text([request(at(14, 0), { purpose: "next-message" })]),
      text([request(at(14, 0), { kind: "image", purpose: "image" })]),
      text([request(at(14, 0), { purpose: "web-search" })]),
      text([request(at(14, 0), { purpose: "task", sessionId: "ses_task" })]),
      text([request(at(14, 0), { chatTitle: null })]),
      text([
        request(at(14, 0), {
          chatId: null,
          chatTitle: null,
          modelRequested: null,
          purpose: "settings-search",
          sessionId: null,
          surface: "settings",
        }),
      ]),
    ]).toMatchInlineSnapshot(`
      [
        "Kitchen remodel quotes | Claude Haiku 5.5 · 4 requests",
        "Kitchen remodel quotes | Named a chat · Claude Haiku 5.5 · 1 request",
        "Kitchen remodel quotes | Suggested a reply · Claude Haiku 5.5 · 1 request",
        "Kitchen remodel quotes | Made an image · Claude Haiku 5.5 · 1 request",
        "Kitchen remodel quotes | Searched the web · Claude Haiku 5.5 · 1 request",
        "Kitchen remodel quotes | Claude Haiku 5.5 · 1 request",
        "Deleted chat | Claude Haiku 5.5 · 1 request",
        "Searched Settings | 1 request",
      ]
    `);
  });
});
