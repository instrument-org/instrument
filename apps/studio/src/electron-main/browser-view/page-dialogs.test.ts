import type { BrowserTargetId } from "@instrument-org/workspace/electron";
import type { WebContents } from "electron";

import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BrowserEntry } from "./entry";

vi.mock("electron", () => ({ ipcMain: { on: vi.fn() } }));
vi.mock("@instrument-org/workspace/electron", () => ({
  isDrivenByWorkingAgent: () => Promise.resolve(false),
}));
vi.mock("@/electron-main/rpc/publisher", () => ({
  publisher: { publish: vi.fn() },
}));

const {
  askBeforeClosingPage,
  createPageDialogs,
  guardPageLeaving,
  noteGoing,
  takePageDialogs,
} = await import("./page-dialogs");

const tab = "tab-1" as BrowserTargetId;

describe("page dialogs", () => {
  it("lists what is waiting and answers each once", () => {
    const onChange = vi.fn();
    const dialogs = createPageDialogs(onChange);
    const reply = vi.fn();
    const id = dialogs.add(
      {
        kind: "prompt",
        message: "Your name?",
        site: "example.com",
        targetId: tab,
      },
      7,
      reply,
    );
    expect(dialogs.list()).toMatchInlineSnapshot(`
      [
        {
          "id": "1",
          "kind": "prompt",
          "message": "Your name?",
          "site": "example.com",
          "targetId": "tab-1",
        },
      ]
    `);
    expect(dialogs.answer(id, { accept: true, text: "Sam" })).toBe(true);
    expect(dialogs.answer(id, { accept: false })).toBe(false);
    expect(reply.mock.calls).toMatchInlineSnapshot(`
      [
        [
          {
            "accept": true,
            "text": "Sam",
          },
        ],
      ]
    `);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("cancels what a guest was waiting on when it goes", () => {
    const dialogs = createPageDialogs(vi.fn());
    const reply = vi.fn();
    dialogs.add(
      { kind: "confirm", message: "Sure?", site: "a.test", targetId: tab },
      7,
      reply,
    );
    dialogs.add(
      { kind: "alert", message: "Hi", site: "b.test", targetId: tab },
      8,
      vi.fn(),
    );
    dialogs.dropGuest(7);
    expect(reply.mock.calls).toMatchInlineSnapshot(`
      [
        [
          {
            "accept": false,
          },
        ],
      ]
    `);
    expect(dialogs.list().map(({ site }) => site)).toEqual(["b.test"]);
  });
});

describe("leaving a page that holds its navigation up", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const guestOf = (id: number) => {
    const guest = Object.assign(new EventEmitter(), {
      getURL: () => "https://example.com/draft",
      id,
      isDestroyed: () => false,
      loadURL: vi.fn(() => Promise.resolve()),
      navigationHistory: {
        getActiveIndex: () => 3,
        goBack: vi.fn(),
        goForward: vi.fn(),
        goToIndex: vi.fn(),
        goToOffset: vi.fn(),
      },
      reload: vi.fn(),
      reloadIgnoringCache: vi.fn(),
    });
    return guest;
  };

  it.each([
    [
      "a page's own link",
      { kind: "push", steps: 0, url: "https://example.com/next" },
      "loadURL",
    ],
    ["a traverse", { kind: "traverse", steps: -2, url: "" }, "goToOffset"],
    [
      "a reload",
      { kind: "reload", steps: 0, url: "https://example.com/draft" },
      "reload",
    ],
  ] as const)(
    "asks in the tab and, on Leave, goes the way %s was going",
    async (_name, going, method) => {
      vi.useFakeTimers();
      const dialogs = createPageDialogs(vi.fn());
      const guest = guestOf(11);
      const loadURL = guest.loadURL;
      const reload = guest.reload;
      const { goToOffset } = guest.navigationHistory;
      guardPageLeaving(
        guest as unknown as WebContents,
        { targetId: tab } as BrowserEntry,
        { dialogs, mayPageGoTo: () => true, personUsedAt: () => Date.now() },
      );
      noteGoing(11, going);
      const held = { preventDefault: vi.fn() };
      guest.emit("will-prevent-unload", held);
      expect(held.preventDefault).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(200);
      const [dialog] = dialogs.list();
      expect(dialog?.kind).toBe(method === "reload" ? "reload" : "leave");
      dialogs.answer(dialog!.id, { accept: true });
      await vi.advanceTimersByTimeAsync(0);
      const calls = {
        goToOffset: goToOffset.mock.calls,
        loadURL: loadURL.mock.calls,
        reload: reload.mock.calls,
      };
      expect(calls[method]).toHaveLength(1);
      // The navigation it starts goes through the page's question this once.
      const again = { preventDefault: vi.fn() };
      guest.emit("will-prevent-unload", again);
      expect(again.preventDefault).toHaveBeenCalledOnce();
    },
  );

  it.each([
    [
      "a push",
      { byPage: true, kind: "push", steps: 0, url: "file:///private/a.html" },
    ],
    ["a traverse", { byPage: true, kind: "traverse", steps: -2, url: "" }],
  ] as const)(
    "goes nowhere on Leave when the page's own word names %s it may not make",
    async (_name, going) => {
      vi.useFakeTimers();
      const dialogs = createPageDialogs(vi.fn());
      const guest = Object.assign(guestOf(13), {
        navigationHistory: {
          ...guestOf(13).navigationHistory,
          getEntryAtIndex: (index: number) =>
            index === 1 ? { url: "file:///private/b.html" } : undefined,
        },
      });
      const { loadURL } = guest;
      const { goToOffset } = guest.navigationHistory;
      const asked: string[] = [];
      guardPageLeaving(
        guest as unknown as WebContents,
        { targetId: tab } as BrowserEntry,
        {
          dialogs,
          mayPageGoTo: (url) => {
            asked.push(url);
            return !url.startsWith("file:");
          },
          personUsedAt: () => Date.now(),
        },
      );
      noteGoing(13, going);
      guest.emit("will-prevent-unload", { preventDefault: vi.fn() });
      await vi.advanceTimersByTimeAsync(200);
      dialogs.answer(dialogs.list()[0]!.id, { accept: true });
      await vi.advanceTimersByTimeAsync(0);
      expect(asked).toEqual([
        going.kind === "push" ? going.url : "file:///private/b.html",
      ]);
      expect(loadURL).not.toHaveBeenCalled();
      expect(goToOffset).not.toHaveBeenCalled();
    },
  );

  it("stays on the page on Cancel", async () => {
    vi.useFakeTimers();
    const dialogs = createPageDialogs(vi.fn());
    const guest = guestOf(12);
    const loadURL = guest.loadURL;
    guardPageLeaving(
      guest as unknown as WebContents,
      { targetId: tab } as BrowserEntry,
      { dialogs, mayPageGoTo: () => true, personUsedAt: () => Date.now() },
    );
    noteGoing(12, { kind: "push", steps: 0, url: "https://example.com/next" });
    guest.emit("will-prevent-unload", { preventDefault: vi.fn() });
    await vi.advanceTimersByTimeAsync(200);
    dialogs.answer(dialogs.list()[0]!.id, { accept: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(loadURL).not.toHaveBeenCalled();
  });
});

describe("a page's alert and confirm", () => {
  const guestWithSheet = () => {
    const sheet = vi.fn();
    const guest = Object.assign(new EventEmitter(), {
      getURL: () => "https://example.com/form",
      id: 21,
      isDestroyed: () => false,
    });
    guest.on("-run-dialog", sheet);
    return { guest, sheet };
  };

  it.each([
    ["confirm", { accept: true }, [true, ""]],
    ["confirm", { accept: false }, [false, ""]],
    ["alert", { accept: true }, [true, ""]],
  ] as const)(
    "asks a %s in the tab and replies with the answer",
    async (kind, answer, replied) => {
      const dialogs = createPageDialogs(vi.fn());
      const { guest, sheet } = guestWithSheet();
      takePageDialogs(
        guest as unknown as WebContents,
        { targetId: tab } as BrowserEntry,
        { dialogs, personUsedAt: () => Date.now() },
      );
      const reply = vi.fn();
      guest.emit(
        "-run-dialog",
        { defaultPromptText: "", dialogType: kind, messageText: "Sure?" },
        reply,
      );
      await vi.waitFor(() => {
        expect(dialogs.list()).toHaveLength(1);
      });
      expect(sheet).not.toHaveBeenCalled();
      dialogs.answer(dialogs.list()[0]!.id, answer);
      await vi.waitFor(() => {
        expect(reply).toHaveBeenCalledWith(...replied);
      });
    },
  );

  it("takes the card down without replying once Electron cancels the page's dialogs", async () => {
    const dialogs = createPageDialogs(vi.fn());
    const { guest } = guestWithSheet();
    takePageDialogs(
      guest as unknown as WebContents,
      { targetId: tab } as BrowserEntry,
      { dialogs, personUsedAt: () => Date.now() },
    );
    const reply = vi.fn();
    guest.emit(
      "-run-dialog",
      { defaultPromptText: "", dialogType: "alert", messageText: "Hi" },
      reply,
    );
    await vi.waitFor(() => {
      expect(dialogs.list()).toHaveLength(1);
    });
    guest.emit("-cancel-dialogs");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(dialogs.list()).toEqual([]);
    expect(reply).not.toHaveBeenCalled();
  });
});

describe("closing a page that holds its going up", () => {
  /** A guest whose `beforeunload` answers a close with `proceed`, the page asking first when it holds the close up. */
  const guestAnswering = (proceed: boolean) => {
    const guest = Object.assign(new EventEmitter(), {
      close: vi.fn(() => {
        if (!proceed) {
          guest.emit("will-prevent-unload", { preventDefault: vi.fn() });
        }
        const fired = { preventDefault: vi.fn() };
        guest.emit("-before-unload-fired", fired, proceed);
        vetoes.push(fired.preventDefault);
      }),
      getURL: () => "https://example.com/draft",
      id: 31,
      isDestroyed: () => false,
      loadURL: vi.fn(() => Promise.resolve()),
      navigationHistory: {
        getActiveIndex: () => 0,
        goBack: vi.fn(),
        goForward: vi.fn(),
        goToIndex: vi.fn(),
        goToOffset: vi.fn(),
      },
      reload: vi.fn(),
      reloadIgnoringCache: vi.fn(),
    });
    const vetoes: ReturnType<typeof vi.fn>[] = [];
    return { guest, vetoes };
  };

  it("closes at once when the page does not hold the close up, keeping the page for the caller to close", async () => {
    const dialogs = createPageDialogs(vi.fn());
    const { guest, vetoes } = guestAnswering(true);
    await expect(
      askBeforeClosingPage(
        guest as unknown as WebContents,
        { targetId: tab } as BrowserEntry,
        { dialogs },
      ),
    ).resolves.toBe(true);
    expect(dialogs.list()).toEqual([]);
    expect(vetoes[0]).toHaveBeenCalledOnce();
  });

  it.each([
    [{ accept: true }, true],
    [{ accept: false }, false],
  ] as const)(
    "asks Leave site? in the tab when the page holds it up: %o closes %s",
    async (answer, closes) => {
      const dialogs = createPageDialogs(vi.fn());
      const { guest } = guestAnswering(false);
      guardPageLeaving(
        guest as unknown as WebContents,
        { targetId: tab } as BrowserEntry,
        { dialogs, mayPageGoTo: () => true, personUsedAt: () => undefined },
      );
      const asked = askBeforeClosingPage(
        guest as unknown as WebContents,
        { targetId: tab } as BrowserEntry,
        { dialogs },
      );
      await vi.waitFor(() => {
        expect(dialogs.list().map(({ kind }) => kind)).toEqual(["leave"]);
      });
      dialogs.answer(dialogs.list()[0]!.id, answer);
      await expect(asked).resolves.toBe(closes);
      // The close's own hold never also asks as a navigation would.
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(dialogs.list()).toEqual([]);
    },
  );
});
