import { describe, expect, it, vi } from "vitest";

import { type AppWindowAsk, createAppWindowAsks } from "./app-window-asks";

// A file or link opened from outside while setup is up waits for setup, then
// reaches the window: neither lost to a page that asked once and got nothing,
// nor put up behind setup where nobody can see it.

const file: AppWindowAsk = {
  hostPath: "/Users/mac-user/a.pdf",
  type: "openFile",
};
const link: AppWindowAsk = { href: "/chats/abc", type: "openScreen" };

function asks({ held = false } = {}) {
  const state = { held };
  const deliver = vi.fn<(ask: AppWindowAsk) => void>();
  const queue = createAppWindowAsks({
    deliver,
    isHeld: () => state.held,
  });
  return { deliver, queue, state };
}

describe("createAppWindowAsks", () => {
  it("delivers at once to a page that is listening", () => {
    const { deliver, queue } = asks();
    queue.take();
    queue.ask(file);
    expect(deliver.mock.calls).toEqual([[file]]);
  });

  it("keeps what came before the page was up for it to take", () => {
    const { deliver, queue } = asks();
    queue.ask(file);
    queue.ask(link);
    expect(deliver).not.toHaveBeenCalled();
    expect(queue.take()).toEqual([file, link]);
    expect(queue.take()).toEqual([]);
  });

  it("holds asks while held, names them, and delivers them on release", () => {
    const { deliver, queue, state } = asks({ held: true });
    expect(queue.take()).toEqual([]);
    queue.ask(file);
    queue.ask(link);
    expect(deliver).not.toHaveBeenCalled();
    expect(queue.waiting).toEqual([file, link]);

    state.held = false;
    queue.release();
    expect(deliver.mock.calls).toEqual([[file], [link]]);
    expect(queue.waiting).toEqual([]);
  });

  it("leaves what waited for a reloading page to take on release", () => {
    const { deliver, queue, state } = asks({ held: true });
    queue.take();
    queue.ask(file);
    queue.stopTaking();
    state.held = false;
    queue.release();
    expect(deliver).not.toHaveBeenCalled();
    expect(queue.take()).toEqual([file]);
  });

  it("releases nothing while still held", () => {
    const { deliver, queue } = asks({ held: true });
    queue.take();
    queue.ask(file);
    queue.release();
    expect(deliver).not.toHaveBeenCalled();
  });
});
