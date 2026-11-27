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

const { createPageDialogs, guardPageLeaving, noteGoing } =
  await import("./page-dialogs");

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
        { dialogs, personUsedAt: () => Date.now() },
      );
      noteGoing(11, going);
      const held = { preventDefault: vi.fn() };
      guest.emit("will-prevent-unload", held);
      expect(held.preventDefault).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(200);
      const [dialog] = dialogs.list();
      expect(dialog?.kind).toBe("leave");
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

  it("stays on the page on Cancel", async () => {
    vi.useFakeTimers();
    const dialogs = createPageDialogs(vi.fn());
    const guest = guestOf(12);
    const loadURL = guest.loadURL;
    guardPageLeaving(
      guest as unknown as WebContents,
      { targetId: tab } as BrowserEntry,
      { dialogs, personUsedAt: () => Date.now() },
    );
    noteGoing(12, { kind: "push", steps: 0, url: "https://example.com/next" });
    guest.emit("will-prevent-unload", { preventDefault: vi.fn() });
    await vi.advanceTimersByTimeAsync(200);
    dialogs.answer(dialogs.list()[0]!.id, { accept: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(loadURL).not.toHaveBeenCalled();
  });
});
