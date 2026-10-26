import { windowHoldsAtom } from "@/client/atoms/tab-navigation-block";
import { renderWithDefaultStore } from "@/tests/render";
import { getDefaultStore } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useWindowCommands } from "./use-window-commands";

// What main sends the window over its command stream, as a test can feed it.
const stream = vi.hoisted(() => {
  const queued: unknown[] = [];
  let wake: (() => void) | undefined;
  return {
    push(command: unknown) {
      queued.push(command);
      wake?.();
    },
    async *read() {
      for (;;) {
        const next = queued.shift();
        if (next !== undefined) {
          yield next;
          continue;
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    },
  };
});

vi.mock("@tanstack/react-router", () => ({ useRouter: () => ({}) }));
vi.mock("@/client/rpc/client", () => ({
  rpcClient: {
    window: {
      events: { command: { call: () => Promise.resolve(stream.read()) } },
      takePending: { call: () => Promise.resolve([]) },
    },
  },
}));

const handlers = {
  back: vi.fn(),
  closeTab: vi.fn(),
  forward: vi.fn(),
  goToPlace: vi.fn(),
  newChat: vi.fn(),
  newChatFromLink: vi.fn(),
  newTab: vi.fn(),
  openFile: vi.fn(),
  openScreen: vi.fn(),
  reopenTab: vi.fn(),
  search: vi.fn(),
  selectChat: vi.fn(),
  selectRelative: vi.fn(),
  selectTab: vi.fn(),
  toggleInbox: vi.fn(),
};

function Window() {
  useWindowCommands(handlers, { isReady: true });
  return null;
}

afterEach(() => {
  getDefaultStore().set(windowHoldsAtom, []);
});

// What waited for setup is sent over the command stream the moment setup is
// done, which can be before setup's own hold on the window has come down. It
// is answered all the same: the hold keeps the tab chords off the window,
// never what was opened from outside it.
describe("useWindowCommands", () => {
  it("answers a file and a link from outside while the window is held", async () => {
    getDefaultStore().set(windowHoldsAtom, [{}]);
    renderWithDefaultStore(<Window />);
    stream.push({ hostPath: "/Users/mac-user/a.pdf", type: "openFile" });
    stream.push({ href: "/chats/abc", type: "openScreen" });
    await vi.waitFor(() => {
      expect(handlers.openScreen).toHaveBeenCalledWith("/chats/abc");
    });
    expect(handlers.openFile).toHaveBeenCalledWith("/Users/mac-user/a.pdf");
  });

  it("starts a new chat's draft with the words a link brought", async () => {
    renderWithDefaultStore(<Window />);
    stream.push({ topic: "01JTOPIC", type: "newChat", words: "Plan my week" });
    await vi.waitFor(() => {
      expect(handlers.newChatFromLink).toHaveBeenCalledWith(
        "Plan my week",
        "01JTOPIC",
      );
    });
  });

  it("leaves the search chord to what holds the window", () => {
    renderWithDefaultStore(<Window />);
    const press = () =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "l", metaKey: true }),
      );
    press();
    expect(handlers.search).toHaveBeenCalledTimes(1);
    getDefaultStore().set(windowHoldsAtom, [{}]);
    press();
    expect(handlers.search).toHaveBeenCalledTimes(1);
  });

  // The tests run as a Mac, where Ctrl+K, Ctrl+L and Ctrl+E are the text
  // system's own: delete to the end of the line, center, end of the line.
  it.each(["k", "l", "e"])("leaves ⌃%s to the text field on a Mac", (key) => {
    renderWithDefaultStore(<Window />);
    const press = (held: { ctrlKey?: boolean; metaKey?: boolean }) => {
      const event = new KeyboardEvent("keydown", {
        cancelable: true,
        key,
        ...held,
      });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(press({ ctrlKey: true })).toBe(false);
    expect(press({ metaKey: true })).toBe(true);
  });
});
