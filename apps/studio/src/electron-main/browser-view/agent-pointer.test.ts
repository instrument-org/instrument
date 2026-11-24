import type {
  AbsolutePath,
  BrowserTargetId,
} from "@instrument-org/workspace/electron";
import type { WebContents } from "electron";

import { browserTargetOf, StoreId } from "@instrument-org/workspace/electron";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  carryAgentPointer,
  pointerSize,
  showAgentCommand,
  withoutAgentPointer,
} from "./agent-pointer";
import { setDeviceEmulation } from "./device-emulation";
import { type BrowserEntry, createEntry } from "./entry";

const driven = vi.hoisted(() => ({ value: true }));
vi.mock("@instrument-org/workspace/electron", async (original) => ({
  ...(await original<object>()),
  isDrivenByWorkingAgent: () => Promise.resolve(driven.value),
}));

const appZoom = vi.hoisted(() => ({ value: 1 }));
vi.mock("@/electron-main/stores/workspace/window-state", () => ({
  getAppZoom: () => appZoom.value,
}));

afterEach(() => {
  appZoom.value = 1;
  driven.value = true;
  vi.useRealTimers();
});

/** A guest whose isolated-world scripts answer only when `answer` is called, and the acts each one carried. */
function makeGuest() {
  const answers: ((value: unknown) => void)[] = [];
  const codes: string[] = [];
  const page = { zoom: 1 };
  const run = vi.fn((_world: number, scripts: { code: string }[]) => {
    codes.push(scripts[0]?.code ?? "");
    return new Promise<unknown>((resolve) => answers.push(resolve));
  });
  const entry = createEntry({
    hostId: 1,
    partitionDir: "/tmp/partition" as AbsolutePath,
    targetId: browserTargetOf(StoreId.newTabId()) as BrowserTargetId,
  });
  // Cast: only the members the pointer touches are faked.
  entry.webContents = {
    debugger: { sendCommand: () => Promise.resolve() },
    executeJavaScriptInIsolatedWorld: run,
    getZoomFactor: () => page.zoom,
    isDestroyed: () => false,
  } as unknown as WebContents;
  const sent = () =>
    codes.map((code) => {
      const [, json, size] =
        /apply\((\{.*\}), ([\d.]+)\)(?: : "__missing__")?$/s.exec(code) ?? [];
      const act = json ? (JSON.parse(json) as { kind: string }) : undefined;
      return {
        act: code.startsWith("(function") ? `install ${act?.kind}` : act,
        size: Number(size),
      };
    });
  /** The acts sent, in order; an install is marked. */
  const acts = () => sent().map(({ act }) => act);
  /** Each act's kind with the size it was sent at. */
  const sizes = () =>
    sent().map(({ act, size }) =>
      typeof act === "string" ? `${act} ${size}` : `${act?.kind} ${size}`,
    );
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  /** Lets the script on its way reach the page, answers it, and lets the next one go out. */
  const answer = async (value?: unknown) => {
    await settle();
    answers.shift()?.(value);
    await settle();
  };
  return { acts, answer, codes, entry, page, settle, sizes };
}

const mouse = (entry: BrowserEntry, type: string, x: number, y: number) =>
  showAgentCommand(
    entry,
    "Input.dispatchMouseEvent",
    { type, x, y },
    undefined,
  );

describe("showAgentCommand", () => {
  it("holds a move until the pointer arrives, and sends a drag's newest move only", async () => {
    const guest = makeGuest();
    let arrived = false;
    void mouse(guest.entry, "mouseMoved", 10, 10).then(() => {
      arrived = true;
    });
    let skipped = false;
    void mouse(guest.entry, "mouseMoved", 20, 20);
    void mouse(guest.entry, "mouseMoved", 30, 30);
    void mouse(guest.entry, "mouseMoved", 20, 20).then(() => {
      skipped = true;
    });
    void mouse(guest.entry, "mouseMoved", 40, 40);
    await guest.settle();
    expect(arrived).toBe(false);
    expect(skipped).toBe(true);
    await guest.answer();
    expect(arrived).toBe(true);
    await guest.answer();
    expect(guest.acts()).toMatchInlineSnapshot(`
      [
        {
          "kind": "move",
          "x": 10,
          "y": 10,
        },
        {
          "kind": "move",
          "x": 40,
          "y": 40,
        },
      ]
    `);
  });

  it("installs the pointer in a document that has none", async () => {
    const guest = makeGuest();
    void mouse(guest.entry, "mousePressed", 5, 5);
    await guest.answer("__missing__");
    await guest.answer();
    expect(guest.acts()).toEqual([
      { kind: "press", x: 5, y: 5 },
      "install press",
    ]);
  });

  it("shows scrolling, typing, and any other command as the agent at work", async () => {
    const guest = makeGuest();
    // agent-browser's bookkeeping, which reaches every tab, is not work in it.
    void showAgentCommand(guest.entry, "Runtime.enable", {}, undefined);
    void showAgentCommand(
      guest.entry,
      "Runtime.evaluate",
      { expression: "1" },
      undefined,
    );
    void showAgentCommand(
      guest.entry,
      "Accessibility.getFullAXTree",
      {},
      undefined,
    );
    await guest.answer();
    // Already showing: another read sends nothing.
    void showAgentCommand(guest.entry, "DOM.getDocument", {}, undefined);
    void showAgentCommand(
      guest.entry,
      "Input.dispatchMouseEvent",
      { deltaY: 300, type: "mouseWheel", x: 50, y: 60 },
      undefined,
    );
    await guest.answer();
    void showAgentCommand(
      guest.entry,
      "Input.dispatchKeyEvent",
      { type: "keyDown" },
      undefined,
    );
    await guest.answer();
    // A key's release and a frame's click are not acts of their own.
    void showAgentCommand(
      guest.entry,
      "Input.dispatchKeyEvent",
      { type: "keyUp" },
      undefined,
    );
    void showAgentCommand(
      guest.entry,
      "Input.dispatchMouseEvent",
      { type: "mousePressed", x: 1, y: 1 },
      "frame-session",
    );
    await guest.answer();
    expect(guest.acts()).toMatchInlineSnapshot(`
      [
        {
          "kind": "here",
        },
        {
          "dy": 300,
          "kind": "scroll",
          "x": 50,
          "y": 60,
        },
        {
          "kind": "type",
        },
      ]
    `);
  });

  it("scrolls in place for a wheel at the page's corner, which has no point of its own", async () => {
    const guest = makeGuest();
    void mouse(guest.entry, "mouseMoved", 30, 40);
    await guest.answer();
    void showAgentCommand(
      guest.entry,
      "Input.dispatchMouseEvent",
      { deltaY: 100, type: "mouseWheel", x: 0, y: 0 },
      undefined,
    );
    await guest.answer();
    carryAgentPointer(guest.entry);
    await guest.answer();
    expect(guest.acts()).toEqual([
      { kind: "move", x: 30, y: 40 },
      { dy: 100, kind: "scroll" },
      { kind: "restore", x: 30, y: 40 },
    ]);
  });

  it("leaves once no agent at work drives the tab", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const guest = makeGuest();
    void mouse(guest.entry, "mouseMoved", 1, 1);
    await guest.answer();
    await vi.advanceTimersByTimeAsync(1000);
    expect(guest.acts()).toHaveLength(1);
    driven.value = false;
    await vi.advanceTimersByTimeAsync(1000);
    await guest.answer();
    expect(guest.acts().at(-1)).toEqual({ kind: "leave" });
  });
});

describe("pointerSize", () => {
  it.each([
    { appZoom: 1, emulationScale: 1, pageZoom: 1, size: 1 },
    { appZoom: 1, emulationScale: 1, pageZoom: 0.5, size: 2 },
    { appZoom: 1, emulationScale: 1, pageZoom: 0.67, size: 1.4925 },
    { appZoom: 1, emulationScale: 1, pageZoom: 2, size: 0.5 },
    { appZoom: 1.25, emulationScale: 1, pageZoom: 0.5, size: 2.5 },
    { appZoom: 1, emulationScale: 0.5, pageZoom: 1, size: 2 },
    { appZoom: 1.5, emulationScale: 0.5, pageZoom: 0.75, size: 4 },
    { appZoom: 1, emulationScale: 1, pageZoom: 0, size: 1 },
    { appZoom: Number.NaN, emulationScale: 1, pageZoom: 1, size: 1 },
  ])(
    "draws at $size for page zoom $pageZoom, preview scale $emulationScale and app zoom $appZoom",
    ({ size, ...factors }) => {
      expect(pointerSize(factors)).toBe(size);
    },
  );

  it("sends each act at the size for the page's zoom when it goes out, an install included", async () => {
    const guest = makeGuest();
    void mouse(guest.entry, "mouseMoved", 10, 10);
    await guest.answer();
    guest.page.zoom = 0.5;
    appZoom.value = 1.25;
    void mouse(guest.entry, "mousePressed", 10, 10);
    await guest.answer("__missing__");
    await guest.answer();
    setDeviceEmulation({
      device: { height: 800, scale: 0.5, width: 1280 },
      ensureDebuggerAttached: () => undefined,
      entry: guest.entry,
    });
    void mouse(guest.entry, "mouseReleased", 10, 10);
    await guest.answer();
    setDeviceEmulation({
      device: null,
      ensureDebuggerAttached: () => undefined,
      entry: guest.entry,
    });
    carryAgentPointer(guest.entry);
    await guest.answer();
    expect(guest.sizes()).toEqual([
      "move 1",
      "press 2.5",
      "install press 2.5",
      "release 5",
      "restore 2.5",
    ]);
  });

  it("resizes a pointer at rest once its page's zoom changes, and only then", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const guest = makeGuest();
    void mouse(guest.entry, "mouseMoved", 1, 1);
    await guest.answer();
    await vi.advanceTimersByTimeAsync(1000);
    guest.page.zoom = 0.5;
    await vi.advanceTimersByTimeAsync(1000);
    await guest.answer();
    await vi.advanceTimersByTimeAsync(1000);
    await guest.settle();
    expect(guest.sizes()).toEqual(["move 1", "size 2"]);
  });
});

describe("carryAgentPointer", () => {
  it("puts a showing pointer back at its last point on the next document", async () => {
    const guest = makeGuest();
    void mouse(guest.entry, "mousePressed", 40, 60);
    await guest.answer();
    carryAgentPointer(guest.entry);
    await guest.answer();
    expect(guest.acts()[1]).toEqual({ kind: "restore", x: 40, y: 60 });
  });

  it("leaves a tab no agent has worked in alone", async () => {
    const guest = makeGuest();
    carryAgentPointer(guest.entry);
    await guest.settle();
    expect(guest.codes).toEqual([]);
  });
});

describe("withoutAgentPointer", () => {
  it("takes the picture between hiding the pointer and showing it again", async () => {
    const guest = makeGuest();
    void mouse(guest.entry, "mouseMoved", 10, 10);
    await guest.answer();
    const order: string[] = [];
    const taken = withoutAgentPointer(guest.entry, () => {
      order.push(`take after ${guest.codes.length} scripts`);
      return Promise.resolve("picture");
    });
    await guest.answer();
    await expect(taken).resolves.toBe("picture");
    await guest.answer();
    expect(order).toEqual(["take after 2 scripts"]);
    expect(guest.acts().slice(1)).toEqual([
      { kind: "hide" },
      { kind: "unhide" },
    ]);
  });

  it("takes the picture straight away when no pointer is showing", async () => {
    const guest = makeGuest();
    await expect(
      withoutAgentPointer(guest.entry, () => Promise.resolve("picture")),
    ).resolves.toBe("picture");
    expect(guest.codes).toEqual([]);
  });
});
