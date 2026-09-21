import { afterEach, describe, expect, it, vi } from "vitest";

import { createMainFrameLoadGate } from "./cdp-bridge";

/** Drain pending microtasks. */
async function flush(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve();
  }
}

function frameNavigated(id: string, parentId?: string) {
  return {
    frame: {
      domainAndRegistry: "",
      id,
      loaderId: "loader",
      mimeType: "text/html",
      ...(parentId === undefined ? {} : { parentId }),
      secureContext: "Secure",
      securityOrigin: "https://example.com",
      url: "https://example.com/",
    },
    type: "Navigation",
  };
}

/** Attach a resolution flag to a held navigate. */
function track(p: Promise<void>): () => boolean {
  let done = false;
  void p.then(() => {
    done = true;
  });
  return () => done;
}

describe("createMainFrameLoadGate", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves when the main frame stops loading", async () => {
    const gate = createMainFrameLoadGate();
    gate.observe("Page.frameNavigated", frameNavigated("main"));
    const done = track(gate.nextMainFrameLoad(20_000).promise);
    await flush();
    expect(done()).toBe(false);

    gate.observe("Page.frameStoppedLoading", { frameId: "main" });
    await flush();
    expect(done()).toBe(true);
  });

  it("ignores an iframe stopping, including one still finishing the prior page", async () => {
    const gate = createMainFrameLoadGate();
    gate.observe("Page.frameNavigated", frameNavigated("main"));
    gate.observe("Page.frameNavigated", frameNavigated("ad", "main"));
    const done = track(gate.nextMainFrameLoad(20_000).promise);

    gate.observe("Page.frameStoppedLoading", { frameId: "ad" });
    await flush();
    expect(done()).toBe(false);

    gate.observe("Page.frameStoppedLoading", { frameId: "main" });
    await flush();
    expect(done()).toBe(true);
  });

  it("releases at the cap when the main frame never stops", async () => {
    vi.useFakeTimers();
    const gate = createMainFrameLoadGate();
    gate.observe("Page.frameNavigated", frameNavigated("main"));
    const done = track(gate.nextMainFrameLoad(20_000).promise);

    await vi.advanceTimersByTimeAsync(19_999);
    expect(done()).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done()).toBe(true);
  });

  it("cancel releases at once and clears the cap timer", async () => {
    vi.useFakeTimers();
    const gate = createMainFrameLoadGate();
    gate.observe("Page.frameNavigated", frameNavigated("main"));
    const held = gate.nextMainFrameLoad(20_000);
    const done = track(held.promise);

    held.cancel();
    await flush();
    expect(done()).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("waits for the main frame's load after a fresh navigation resets it", async () => {
    const gate = createMainFrameLoadGate();
    gate.observe("Page.frameNavigated", frameNavigated("main"));
    const first = track(gate.nextMainFrameLoad(20_000).promise);
    gate.observe("Page.frameStoppedLoading", { frameId: "main" });
    await flush();
    expect(first()).toBe(true);

    const second = track(gate.nextMainFrameLoad(20_000).promise);
    await flush();
    expect(second()).toBe(false);
    gate.observe("Page.frameStoppedLoading", { frameId: "main" });
    await flush();
    expect(second()).toBe(true);
  });
});
