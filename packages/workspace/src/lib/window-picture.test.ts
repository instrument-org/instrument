import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatIdSchema } from "../schemas/chat-id";
import { type LayoutTab } from "../schemas/group-layout";
import { MountedFolder } from "../schemas/mounted-folder";
import { AbsolutePathSchema, WorkDirSchema } from "../schemas/paths";
import {
  type WindowBox,
  type WindowLook,
  type WindowSide,
} from "../schemas/window-look";
import { type WindowTabAnswer } from "../schemas/window-tab";
import { type WindowMask } from "../types";
import { type Rule } from "./permissions/rules";
import { takeWindowPicture } from "./window-picture";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";
import { buildWorkspaceFsLayout } from "./workspace-fs-layout";

const chatId = ChatIdSchema.parse("window-picture-chat");
const home = path.resolve("/home-of/user");
const work = path.join(home, "work");
const docs = path.join(home, "docs");
const hidden = path.join(home, "hidden");

function layoutWith(rules: Rule[] = []) {
  return buildWorkspaceFsLayout({
    chatHostRoot: WorkDirSchema.parse(work),
    folders: {
      docs: {
        access: "read-only",
        id: MountedFolder.IdSchema.parse("docs"),
        path: AbsolutePathSchema.parse(docs),
      },
    },
    rules: {
      dangerouslyAllowEveryFolder: false,
      home,
      rules: [
        { level: "allow", path: work, source: "grant" },
        { level: "allow", path: docs, source: "grant" },
        ...rules,
      ],
    },
  });
}

/** What the window answers, one per ask, the last repeating. */
let answers: Omit<WindowTabAnswer, "id" | "requestId">[];
vi.mock(import("./chat/window-tab"), async (importOriginal) => ({
  ...(await importOriginal()),
  askWindow: () => {
    const answer = answers.length > 1 ? answers.shift() : answers[0];
    return Promise.resolve(answer && { requestId: "ask", ...answer });
  },
}));

let pages: Record<
  string,
  { documents: string[]; fields: WindowBox[]; hasFrameField: boolean }
>;
let masks: WindowMask[];
let captures: number;
const config = getWorkspaceConfig();

beforeEach(() => {
  masks = [];
  pages = {};
  captures = 0;
  setWorkspaceConfig({
    ...config,
    windowCamera: {
      capture: () => {
        captures += 1;
        return Promise.resolve({
          masked: (mask) => {
            masks.push(mask);
            return Buffer.from("png");
          },
        });
      },
      pageShows: (tabId) => Promise.resolve(pages[tabId]),
    },
  });
});

afterEach(() => {
  setWorkspaceConfig(config);
});

const tab = (
  kind: LayoutTab["kind"],
  address: string,
  id = "tab_a",
): LayoutTab => ({ address, id, isUp: true, kind, title: "" });

/** Where the side under test draws its page: the right half. */
const PAGE: WindowBox = { height: 0.9, width: 0.5, x: 0.5, y: 0.1 };

const side = (up: LayoutTab, root?: string): WindowSide => ({
  box: PAGE,
  ...(root === undefined ? {} : { root }),
  tab: up,
});

const page = (tabId = "tab_page") =>
  side({ ...tab("website", "https://example.com/"), id: tabId });

/** The window with one side, the one under test. */
function lookAt(one: WindowSide, more: Partial<WindowLook> = {}): WindowLook {
  return { fields: [], pictures: [], sides: [one], ...more };
}

async function take(layout = layoutWith()) {
  const picture = await takeWindowPicture({
    askedBy: chatId,
    layout,
    sleepFor: () => Promise.resolve(),
    window: 1,
  });
  return "error" in picture
    ? picture
    : { blanked: masks.at(-1)?.blanked, hidden: picture.hidden };
}

const SHOWN: WindowBox[] = [];
const BLANK = [PAGE];

describe("what a picture shows of a side or a page", () => {
  it.each<[string, WindowSide, boolean]>([
    ["a chat", side(tab("chat", "instrument://chat/x")), true],
    ["a file in reach", side(tab("file", path.join(docs, "a.md"))), true],
    ["a file out of reach", side(tab("file", path.join(hidden, "a"))), false],
    [
      "a settings page with nothing private",
      side(tab("builtIn", "instrument://settings/general")),
      true,
    ],
    [
      "the model providers",
      side(tab("builtIn", "instrument://settings/providers")),
      false,
    ],
    [
      "a screen not listed",
      side(tab("builtIn", "instrument://screen/new-thing")),
      false,
    ],
    ["a folder in reach", side(tab("folder", docs), docs), true],
    [
      "a folder in reach, its view starting above it in reach",
      side(tab("folder", docs), home),
      true,
    ],
    ["a folder whose view is unknown", side(tab("folder", docs)), false],
    ["a folder out of reach", side(tab("folder", hidden), hidden), false],
    ["a page with no guest", page("tab_gone"), false],
  ])("%s", async (_name, owner, isShown) => {
    answers = [{ look: lookAt(owner) }];
    expect(await take()).toMatchObject({ blanked: isShown ? SHOWN : BLANK });
  });

  it("blanks a folder whose view starts in a folder that asks first", async () => {
    answers = [{ look: lookAt(side(tab("folder", docs), home)) }];
    expect(
      await take(layoutWith([{ level: "ask", path: home, source: "folder" }])),
    ).toMatchObject({ blanked: BLANK });
  });

  it("blanks a folder with a closed one anywhere in it", async () => {
    answers = [{ look: lookAt(side(tab("folder", docs), docs)) }];
    expect(
      await take(
        layoutWith([
          {
            level: "never",
            path: path.join(docs, "in", "it"),
            source: "folder",
          },
        ]),
      ),
    ).toMatchObject({
      hidden: [{ tab: "tab_a", why: "a folder you can't read all of" }],
      blanked: BLANK,
    });
  });

  it.each<[string, string[], boolean, boolean]>([
    ["a website", ["https://example.com/"], false, true],
    [
      "a website with a frame of its own making",
      ["https://example.com/", "about:srcdoc"],
      false,
      true,
    ],
    [
      "a page with a password field in a frame",
      ["https://example.com/", "https://login.example.com/"],
      true,
      false,
    ],
    [
      "a page with a password manager's frame in it",
      ["https://example.com/", "chrome-extension://abc/menu.html"],
      false,
      false,
    ],
    [
      "a file in reach",
      [pathToFileURL(path.join(docs, "a.html")).href],
      false,
      true,
    ],
    [
      "a file out of reach",
      [pathToFileURL(path.join(hidden, "a.html")).href],
      false,
      false,
    ],
    [
      "a file in reach framing one out of it",
      [
        pathToFileURL(path.join(docs, "a.html")).href,
        pathToFileURL(path.join(hidden, "a.html")).href,
      ],
      false,
      false,
    ],
    ["view-source of anything", ["view-source:file:///a"], false, false],
    ["a page that loaded nothing", [], false, false],
  ])("%s", async (_name, documents, hasFrameField, isShown) => {
    pages = { tab_page: { documents, fields: [], hasFrameField } };
    answers = [{ look: lookAt(page()) }];
    expect(await take()).toMatchObject({ blanked: isShown ? SHOWN : BLANK });
  });

  it("shows everything outside the sides as drawn", async () => {
    answers = [{ look: { fields: [], pictures: [], sides: [] } }];
    expect(await take()).toEqual({ blanked: [], hidden: [] });
  });
});

describe("pictures", () => {
  const box: WindowBox = { height: 0.1, width: 0.1, x: 0.5, y: 0.5 };
  const chat = side(tab("chat", "instrument://chat/x"));
  const blankedWith = async (
    one: WindowSide,
    picture: Partial<WindowLook["pictures"][number]>,
  ) => {
    answers = [
      {
        look: lookAt(one, {
          pictures: [{ box, isIcon: false, side: 0, ...picture }],
        }),
      },
    ];
    await take();
    return masks.at(-1)?.blanked;
  };

  it("blanks one in a reply of a file the chat can't read", async () => {
    expect(
      await blankedWith(chat, { file: path.join(hidden, "a.png") }),
    ).toEqual([box]);
    expect(
      await blankedWith(chat, {
        file: path.join(hidden, "a.png"),
        isIcon: true,
      }),
    ).toEqual([box]);
    expect(await blankedWith(chat, { file: path.join(docs, "a.png") })).toEqual(
      [],
    );
  });

  it("blanks one of nobody knows what, but for an icon or a file's own viewer", async () => {
    expect(await blankedWith(chat, {})).toEqual([box]);
    expect(await blankedWith(chat, { isIcon: true })).toEqual([]);
    expect(
      await blankedWith(side(tab("file", path.join(docs, "a.png"))), {}),
    ).toEqual([]);
  });

  it("holds one outside every side, in a dialog, to the same rule", async () => {
    answers = [
      {
        look: {
          fields: [],
          pictures: [
            { box, file: path.join(hidden, "a.png"), isIcon: false },
            { box: PAGE, file: path.join(docs, "a.png"), isIcon: false },
          ],
          sides: [],
        },
      },
    ];
    expect(await take()).toEqual({
      blanked: [box],
      hidden: [{ why: "pictures of files you can't read" }],
    });
  });

  it("leaves one in a side already blanked to the side", async () => {
    expect(
      await blankedWith(side(tab("file", path.join(hidden, "a"))), {
        file: path.join(hidden, "a.png"),
      }),
    ).toEqual([PAGE]);
  });
});

describe("fields", () => {
  /** Where the guest is drawn: the right half, below the page's own bar. */
  const GUEST: WindowBox = { height: 0.5, width: 0.5, x: 0.5, y: 0.25 };
  const field: WindowBox = { height: 0.25, width: 0.5, x: 0.25, y: 0.5 };
  const onGuest = (tabId = "tab_page"): WindowSide => ({
    ...page(tabId),
    guest: GUEST,
  });

  it("blanks a page's password or typing field where its guest draws it, and shows the rest", async () => {
    pages = {
      tab_page: {
        documents: ["https://example.com/login"],
        fields: [field],
        hasFrameField: false,
      },
    };
    answers = [{ look: lookAt(onGuest()) }];
    expect(await take()).toEqual({
      blanked: [{ height: 0.125, width: 0.25, x: 0.625, y: 0.5 }],
      hidden: [
        { why: "password and key fields, and the field being typed in" },
      ],
    });
  });

  it("blanks the page whole where its fields can't be placed", async () => {
    pages = {
      tab_page: {
        documents: ["https://example.com/login"],
        fields: [field],
        hasFrameField: false,
      },
    };
    answers = [{ look: lookAt(page()) }];
    expect(await take()).toMatchObject({ blanked: BLANK });
    pages = {
      tab_page: {
        documents: ["https://example.com/", "https://pay.example.net/"],
        fields: [],
        hasFrameField: true,
      },
    };
    answers = [{ look: lookAt(onGuest()) }];
    expect(await take()).toMatchObject({
      blanked: BLANK,
      hidden: [{ why: "a password or typing field on it can't be placed" }],
    });
  });

  it("blanks the window's own key fields and the field being typed in, but for the chat's own reply box", async () => {
    const own = side({
      ...tab("chat", `instrument://chat/${chatId}`),
      id: "tab_own",
    });
    const other = side({
      ...tab("chat", "instrument://chat/another"),
      id: "tab_other",
    });
    const key: WindowBox = { height: 0.05, width: 0.3, x: 0.1, y: 0.1 };
    const typing: WindowBox = { height: 0.1, width: 0.4, x: 0.5, y: 0.85 };
    answers = [
      {
        look: {
          fields: [
            { box: key },
            { box: typing, replyBoxOf: 0 },
            { box: field, replyBoxOf: 1 },
          ],
          pictures: [],
          sides: [own, other],
        },
      },
    ];
    expect(await take()).toMatchObject({ blanked: [key, field] });
  });
});

describe("a window that changes", () => {
  const chatLook = { look: lookAt(side(tab("chat", "instrument://chat/x"))) };
  const fileLook = {
    look: lookAt(side(tab("file", path.join(hidden, "a")))),
  };

  it("is not captured until what is up has been up", async () => {
    answers = [chatLook, fileLook, fileLook, fileLook, fileLook];
    expect(await take()).toMatchObject({ blanked: BLANK });
    expect(captures).toBe(1);
  });

  it("is taken again when something came up around the frame", async () => {
    answers = [chatLook, chatLook, fileLook, fileLook, fileLook, fileLook];
    expect(await take()).toMatchObject({ blanked: BLANK });
    expect(captures).toBe(2);
  });

  it("gives no picture when it never settles", async () => {
    answers = Array.from({ length: 20 }, (_, index) =>
      index % 2 === 0 ? chatLook : fileLook,
    );
    expect(await take()).toEqual({
      error: "the window kept changing, so no picture was taken.",
    });
    expect(masks).toEqual([]);
  });

  it("says why where the window gives no account of itself", async () => {
    answers = [{ error: "the window is covered." }];
    expect(await take()).toEqual({ error: "the window is covered." });
    answers = [];
    expect(await take()).toEqual({ error: "the window did not answer." });
  });
});
