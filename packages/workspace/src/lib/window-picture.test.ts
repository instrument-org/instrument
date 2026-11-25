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
  type WindowOwner,
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

let pages: Record<string, { documents: string[]; isSigningIn: boolean }>;
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

const side = (up: LayoutTab, root?: string): WindowOwner => ({
  kind: "side",
  ...(root === undefined ? {} : { root }),
  tab: up,
});

/** Two cells side by side: the frame's, and the owner's under test. */
function lookAt(
  owner: WindowOwner,
  more: Partial<WindowLook> = {},
): WindowLook {
  return {
    columns: 3,
    covers: [],
    owners: [{ kind: "frame" }, owner],
    pictures: [],
    points: [0, 0, 1, 1, 0, 0, 1, 1],
    rows: 1,
    ...more,
  };
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
    : { hidden: picture.hidden, shown: masks.at(-1)?.shown };
}

const SHOWN = [true, true, true];
const BLANK = [true, false, false];

describe("what a picture shows of a side or a page", () => {
  it.each<[string, WindowOwner, boolean]>([
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
    ["a page with no guest", { kind: "page", tabId: "tab_gone" }, false],
  ])("%s", async (_name, owner, isShown) => {
    answers = [{ look: lookAt(owner) }];
    expect(await take()).toMatchObject({ shown: isShown ? SHOWN : BLANK });
  });

  it("blanks a folder whose view starts in a folder that asks first", async () => {
    answers = [{ look: lookAt(side(tab("folder", docs), home)) }];
    expect(
      await take(layoutWith([{ level: "ask", path: home, source: "folder" }])),
    ).toMatchObject({ shown: BLANK });
  });

  it("blanks a folder with a closed one anywhere in it", async () => {
    answers = [{ look: lookAt(side(tab("folder", docs), docs)) }];
    expect(
      await take(
        layoutWith([
          { level: "never", path: path.join(docs, "in", "it"), source: "folder" },
        ]),
      ),
    ).toMatchObject({
      hidden: [{ tab: "tab_a", why: "a folder you can't read all of" }],
      shown: BLANK,
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
    ["a page asking for a password", ["https://example.com/"], true, false],
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
  ])("%s", async (_name, documents, isSigningIn, isShown) => {
    pages = { tab_page: { documents, isSigningIn } };
    answers = [{ look: lookAt({ kind: "page", tabId: "tab_page" }) }];
    expect(await take()).toMatchObject({ shown: isShown ? SHOWN : BLANK });
  });

  it("blanks every cell a point over something unknown touches", async () => {
    answers = [
      {
        look: lookAt(side(tab("chat", "instrument://chat/x")), {
          points: [0, 0, 0, 0, 0, 0, 0, -1],
        }),
      },
    ];
    expect(await take()).toMatchObject({ shown: [true, true, false] });
  });

  it("blanks everything where the window says too little", async () => {
    answers = [
      { look: lookAt({ kind: "frame" }, { owners: [], points: [0] }) },
    ];
    expect(await take()).toMatchObject({ shown: [false, false, false] });
  });
});

describe("the parts blanked whatever the points say", () => {
  const box: WindowBox = { height: 0.1, width: 0.1, x: 0.5, y: 0.5 };
  const chat = side(tab("chat", "instrument://chat/x"));
  const blankedWith = async (
    owner: WindowOwner,
    picture: Partial<WindowLook["pictures"][number]>,
  ) => {
    answers = [
      {
        look: lookAt(owner, {
          pictures: [{ box, isIcon: false, owner: 1, ...picture }],
        }),
      },
    ];
    await take();
    return masks.at(-1)?.blanked;
  };

  it("what stands over the sides", async () => {
    answers = [{ look: lookAt(chat, { covers: [box] }) }];
    expect(await take()).toMatchObject({
      hidden: [{ why: expect.stringContaining("stands over the window") }],
    });
    expect(masks.at(-1)?.blanked).toEqual([box]);
  });

  it("a picture in a reply of a file the chat can't read", async () => {
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

  it("a picture in a reply of nobody knows what", async () => {
    expect(await blankedWith(chat, {})).toEqual([box]);
    expect(await blankedWith(chat, { isIcon: true })).toEqual([]);
    expect(
      await blankedWith(side(tab("file", path.join(docs, "a.png"))), {}),
    ).toEqual([]);
  });
});

describe("a window that changes", () => {
  const chatLook = { look: lookAt(side(tab("chat", "instrument://chat/x"))) };
  const fileLook = {
    look: lookAt(side(tab("file", path.join(hidden, "a")))),
  };

  it("is not captured until what is up has been up", async () => {
    answers = [chatLook, fileLook, fileLook, fileLook, fileLook];
    expect(await take()).toMatchObject({ shown: BLANK });
    expect(captures).toBe(1);
  });

  it("is taken again when something came up around the frame", async () => {
    answers = [chatLook, chatLook, fileLook, fileLook, fileLook, fileLook];
    expect(await take()).toMatchObject({ shown: BLANK });
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
