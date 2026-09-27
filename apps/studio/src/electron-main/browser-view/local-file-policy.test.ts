import {
  type OnBeforeRequestListenerDetails,
  type WebContents,
  type WebFrameMain,
} from "electron";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

import { trackFrameDocuments } from "./frame-documents";
import {
  isAllowedGuestRequest,
  isAllowedLocalRequest,
} from "./local-file-policy";

const { liveFrames } = vi.hoisted(() => ({ liveFrames: new Set<string>() }));

vi.mock("electron", () => ({
  app: { on: vi.fn() },
  webFrameMain: {
    fromId: (processId: number, routingId: number) =>
      liveFrames.has(`${processId}:${routingId}`) ? {} : undefined,
  },
}));

const FOLDER = "file:///Users/casey/Documents/Instrument/report";
const PAGE = `${FOLDER}/index.html`;

let nextContentsId = 1;
let nextRoutingId = 1;

/**
 * A guest as the main process sees it: frames that load documents, and a
 * page script that can rewrite a frame's address without loading one. Only
 * the fields the policy reads are real, so the doubles are shaped on the way
 * in.
 */
function guest() {
  // Electron's WebContents is a Node EventEmitter.
  // eslint-disable-next-line unicorn/prefer-event-target
  const contents = Object.assign(new EventEmitter(), { id: nextContentsId++ });
  trackFrameDocuments(contents as unknown as WebContents);

  const frame = () => {
    const self = { processId: 4, routingId: nextRoutingId++, url: "" };
    liveFrames.add(`${self.processId}:${self.routingId}`);
    return self;
  };
  type Frame = ReturnType<typeof frame>;

  return {
    contents,
    frame,
    /** A cross-document navigation the frame committed. */
    load: (target: Frame, url: string) => {
      target.url = url;
      contents.emit(
        "did-frame-navigate",
        {},
        url,
        -1,
        "",
        false,
        target.processId,
        target.routingId,
      );
    },
    /** `history.pushState` in the frame: its address moves, its document does not. */
    pushState: (target: Frame, url: string) => {
      target.url = url;
      contents.emit(
        "did-navigate-in-page",
        {},
        url,
        false,
        target.processId,
        target.routingId,
      );
    },
    read: (
      from: Frame | null,
      url: string,
      resourceType: OnBeforeRequestListenerDetails["resourceType"] = "xhr",
      editedPage?: Parameters<typeof isAllowedLocalRequest>[1],
    ) =>
      isAllowedLocalRequest(
        {
          frame: from as unknown as WebFrameMain,
          resourceType,
          url,
          webContentsId: contents.id,
        },
        editedPage,
      ),
  };
}

/** A guest whose main frame has loaded the report page. */
function pageGuest() {
  const g = guest();
  const main = g.frame();
  g.load(main, PAGE);
  return { ...g, main };
}

describe("isAllowedLocalRequest", () => {
  it.each([
    ["a picture beside the page", `${FOLDER}/chart.png`, "image"],
    ["a stylesheet in a subfolder", `${FOLDER}/css/site.css`, "stylesheet"],
    ["data fetched from beside the page", `${FOLDER}/data.json`, "xhr"],
    ["a frame from beside the page", `${FOLDER}/embed.html`, "subFrame"],
  ] as const)("lets a page read %s", (_case, url, resourceType) => {
    const { main, read } = pageGuest();
    expect(read(main, url, resourceType)).toBe(true);
  });

  it.each([
    [
      "a file above the page",
      "file:///Users/casey/Documents/Instrument/notes.md",
      "xhr",
    ],
    [
      "a file beside the page's folder",
      "file:///Users/casey/Documents/Instrument/other/x.json",
      "xhr",
    ],
    ["a file anywhere else", "file:///Users/casey/.ssh/id_rsa", "xhr"],
    [
      "a folder named like the page's folder",
      "file:///Users/casey/Documents/Instrument/report-archive/x.json",
      "xhr",
    ],
    ["an encoded climb out of the folder", `${FOLDER}/%2E%2E/notes.md`, "xhr"],
    [
      "the task's private directory beside the page",
      `${FOLDER}/.instrument/task.db`,
      "xhr",
    ],
    [
      "a picture drawn from outside the folder",
      "file:///Users/casey/Pictures/private.jpg",
      "image",
    ],
  ] as const)("refuses a page %s", (_case, url, resourceType) => {
    const { main, read } = pageGuest();
    expect(read(main, url, resourceType)).toBe(false);
  });

  it("refuses a read from a frame with no address of its own", () => {
    const { read } = pageGuest();
    expect(read(null, `${FOLDER}/data.json`)).toBe(false);
  });

  it("refuses a read from a page that is not a file", () => {
    const { load, main, read } = pageGuest();
    load(main, "https://example.test/");
    expect(read(main, `${FOLDER}/data.json`)).toBe(false);
  });

  it("refuses a read from a frame whose document was never seen", () => {
    const { frame, read } = pageGuest();
    const unknown = frame();
    unknown.url = PAGE;
    expect(read(unknown, `${FOLDER}/data.json`)).toBe(false);
  });

  it("refuses a read from a frame of a guest that was never tracked", () => {
    const { main } = pageGuest();
    expect(
      isAllowedLocalRequest({
        frame: main as unknown as WebFrameMain,
        resourceType: "xhr",
        url: `${FOLDER}/data.json`,
        webContentsId: -1,
      }),
    ).toBe(false);
  });

  it("forgets a guest's documents once it is gone", () => {
    const { contents, main, read } = pageGuest();
    contents.emit("destroyed");
    expect(read(main, `${FOLDER}/data.json`)).toBe(false);
  });

  describe("a page that rewrites its own address", () => {
    it.each([
      ["the root", "/", "file:///etc/hosts"],
      ["another folder", "/etc/z.html", "file:///etc/hosts"],
      [
        "a folder beside its own",
        "../outside/x.html",
        "file:///Users/casey/Documents/Instrument/outside/secret.txt",
      ],
      [
        "a sibling path above its folder",
        "../sibling.html",
        "file:///Users/casey/Documents/Instrument/notes.md",
      ],
    ])(
      "is still judged by the document it loaded after moving to %s",
      (_case, pushed, target) => {
        const { main, pushState, read } = pageGuest();
        pushState(main, new URL(pushed, PAGE).href);
        expect(read(main, target)).toBe(false);
        expect(read(main, `${FOLDER}/chart.png`, "image")).toBe(true);
      },
    );
  });

  it("follows a frame that loads a document in another folder", () => {
    const { load, main, read } = pageGuest();
    load(main, "file:///Users/casey/Desktop/other/page.html");
    expect(read(main, "file:///Users/casey/Desktop/other/pic.png")).toBe(true);
    expect(read(main, `${FOLDER}/chart.png`)).toBe(false);
  });

  it("judges a frame inside the page by the document it loaded", () => {
    const { frame, load, main, pushState, read } = pageGuest();
    const inner = frame();
    load(inner, `${FOLDER}/embed/inner.html`);
    expect(read(inner, `${FOLDER}/embed/pic.png`, "image")).toBe(true);
    expect(read(inner, `${FOLDER}/chart.png`, "image")).toBe(false);
    pushState(inner, PAGE);
    expect(read(inner, `${FOLDER}/chart.png`, "image")).toBe(false);
    expect(read(main, `${FOLDER}/chart.png`, "image")).toBe(true);
  });

  it("forgets a frame that is gone", () => {
    const { frame, load, read } = pageGuest();
    const inner = frame();
    load(inner, `${FOLDER}/embed/inner.html`);
    liveFrames.delete(`${inner.processId}:${inner.routingId}`);
    load(frame(), PAGE);
    expect(read(inner, `${FOLDER}/embed/pic.png`, "image")).toBe(false);
  });

  // Where the person goes is theirs: a link they follow, a file they open.
  it("lets the frame itself move to another file", () => {
    const { main, read } = pageGuest();
    expect(
      read(main, "file:///Users/casey/Desktop/other.html", "mainFrame"),
    ).toBe(true);
  });

  it("never lets the frame move into a private directory", () => {
    const { main, read } = pageGuest();
    expect(
      read(
        main,
        "file:///Users/casey/tasks/a/.instrument/task.db",
        "mainFrame",
      ),
    ).toBe(false);
  });

  describe("a page being edited", () => {
    const COPY = "data:text/html;charset=utf-8;base64,PHA+ZWRpdGVkPC9wPg==";

    const editing = () => {
      const g = guest();
      const main = g.frame();
      g.load(main, COPY);
      const editedPage = (id: number | undefined, url: string | undefined) =>
        id === g.contents.id && url === COPY
          ? "/Users/casey/Documents/Instrument/report/index.html"
          : undefined;
      const read = (url: string) => g.read(main, url, "image", editedPage);
      return { ...g, main, read };
    };

    it("reads the file's folder from the copy the edit loaded", () => {
      expect(editing().read(`${FOLDER}/chart.png`)).toBe(true);
    });

    it("reads nothing beyond the file's folder", () => {
      expect(editing().read("file:///Users/casey/.ssh/id_rsa")).toBe(false);
    });

    it("reads nothing from any other copy in the same guest", () => {
      const { load, main, read } = editing();
      load(main, "data:text/html;charset=utf-8;base64,PHA+b2xkZXI8L3A+");
      expect(read(`${FOLDER}/chart.png`)).toBe(false);
    });

    it("keeps to the file's folder after the copy rewrites its address", () => {
      const { main, pushState, read } = editing();
      pushState(main, "file:///etc/z.html");
      expect(read("file:///etc/hosts")).toBe(false);
      expect(read(`${FOLDER}/chart.png`)).toBe(true);
    });
  });
});

describe("isAllowedGuestRequest", () => {
  const navigate = (
    type: ReturnType<WebContents["getType"]> | undefined,
    url: string,
  ) =>
    isAllowedGuestRequest({
      frame: null,
      resourceType: "mainFrame",
      url,
      webContents: type === undefined ? undefined : { getType: () => type },
    });

  it("lets a guest move to another file", () => {
    expect(navigate("webview", "file:///Users/casey/Desktop/other.html")).toBe(
      true,
    );
  });

  // A local page opens a popup to any web address, then sends it to a file:
  // the opener would read that file through its handle, one `file://` origin
  // to another.
  it.each([
    ["a popup a page opened", "window"],
    ["a contents the request does not name", undefined],
  ] as const)("never shows a file in %s", (_case, type) => {
    expect(navigate(type, "file:///etc/hosts")).toBe(false);
  });

  it("still confines a guest page's reads to its folder", () => {
    const { contents, main } = pageGuest();
    const read = (url: string) =>
      isAllowedGuestRequest({
        frame: main as unknown as WebFrameMain,
        resourceType: "xhr",
        url,
        webContents: { getType: () => "webview" },
        webContentsId: contents.id,
      });
    expect(read(`${FOLDER}/data.json`)).toBe(true);
    expect(read("file:///etc/hosts")).toBe(false);
  });
});
