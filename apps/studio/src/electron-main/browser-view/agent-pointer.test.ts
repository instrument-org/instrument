import type {
  AbsolutePath,
  BrowserTargetId,
} from "@instrument-org/workspace/electron";
import type { WebContents } from "electron";

import { browserTargetOf, StoreId } from "@instrument-org/workspace/electron";
import { describe, expect, it, vi } from "vitest";

import {
  carryAgentPointer,
  showAgentPointer,
  withoutAgentPointer,
} from "./agent-pointer";
import { type BrowserEntry, createEntry } from "./entry";

/** A guest whose isolated-world scripts answer only when `answer` is called, and the updates each one carried. */
function makeGuest() {
  const answers: (() => void)[] = [];
  const codes: string[] = [];
  const run = vi.fn((_world: number, scripts: { code: string }[]) => {
    codes.push(scripts[0]?.code ?? "");
    return new Promise<void>((resolve) => answers.push(resolve));
  });
  const entry = createEntry({
    hostId: 1,
    partitionDir: "/tmp/partition" as AbsolutePath,
    targetId: browserTargetOf(StoreId.newTabId()) as BrowserTargetId,
  });
  // Cast: only the members the pointer touches are faked.
  entry.webContents = {
    executeJavaScriptInIsolatedWorld: run,
    isDestroyed: () => false,
  } as unknown as WebContents;
  const updates = () =>
    codes
      .map((code) => /\)\((\{.*\})\)$/s.exec(code)?.[1])
      .map((json) => (json ? (JSON.parse(json) as unknown) : "other"));
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  /** Lets the script on its way reach the page, answers it, and lets the next one go out. */
  const answer = async () => {
    await settle();
    answers.shift()?.();
    await settle();
  };
  return { answer, codes, entry, updates };
}

const mouse = (entry: BrowserEntry, type: string, x: number, y: number) => {
  showAgentPointer(
    entry,
    "Input.dispatchMouseEvent",
    { type, x, y },
    undefined,
  );
};

describe("showAgentPointer", () => {
  it("sends the newest point once the page answers, keeping a press it skipped over", async () => {
    const guest = makeGuest();
    mouse(guest.entry, "mouseMoved", 10, 10);
    mouse(guest.entry, "mouseMoved", 20, 20);
    mouse(guest.entry, "mousePressed", 30, 30);
    mouse(guest.entry, "mouseReleased", 30, 30);
    await guest.answer();
    expect(guest.updates()).toMatchInlineSnapshot(`
      [
        {
          "down": false,
          "idleMs": 5000,
          "press": false,
          "x": 10,
          "y": 10,
        },
        {
          "down": false,
          "idleMs": 5000,
          "press": true,
          "x": 30,
          "y": 30,
        },
      ]
    `);
  });

  it("holds the button down between a press and its release", async () => {
    const guest = makeGuest();
    mouse(guest.entry, "mousePressed", 5, 5);
    await guest.answer();
    mouse(guest.entry, "mouseMoved", 50, 5);
    await guest.answer();
    mouse(guest.entry, "mouseReleased", 50, 5);
    await guest.answer();
    expect(guest.updates()).toMatchInlineSnapshot(`
      [
        {
          "down": true,
          "idleMs": 5000,
          "press": true,
          "x": 5,
          "y": 5,
        },
        {
          "down": true,
          "idleMs": 5000,
          "press": false,
          "x": 50,
          "y": 5,
        },
        {
          "down": false,
          "idleMs": 5000,
          "press": false,
          "x": 50,
          "y": 5,
        },
      ]
    `);
  });

  it("leaves out a frame's commands, the wheel, and anything but mouse input", () => {
    const guest = makeGuest();
    showAgentPointer(
      guest.entry,
      "Input.dispatchMouseEvent",
      { type: "mouseMoved", x: 1, y: 1 },
      "frame-session",
    );
    mouse(guest.entry, "mouseWheel", 1, 1);
    showAgentPointer(
      guest.entry,
      "Input.dispatchKeyEvent",
      { type: "keyDown" },
      undefined,
    );
    expect(guest.codes).toEqual([]);
  });
});

describe("carryAgentPointer", () => {
  it("puts the pointer back where it was on the next document, for the time it had left", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const guest = makeGuest();
      mouse(guest.entry, "mousePressed", 40, 60);
      await guest.answer();
      vi.advanceTimersByTime(1000);
      carryAgentPointer(guest.entry);
      await guest.answer();
      expect(guest.updates()[1]).toMatchInlineSnapshot(`
        {
          "down": false,
          "idleMs": 4000,
          "press": false,
          "x": 40,
          "y": 60,
        }
      `);
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves a pointer that has already faded, or never showed, alone", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const guest = makeGuest();
      carryAgentPointer(guest.entry);
      mouse(guest.entry, "mouseMoved", 1, 1);
      await guest.answer();
      vi.advanceTimersByTime(6000);
      carryAgentPointer(guest.entry);
      await guest.answer();
      expect(guest.codes).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("withoutAgentPointer", () => {
  it("takes the picture between hiding the pointer and showing it again", async () => {
    const guest = makeGuest();
    mouse(guest.entry, "mouseMoved", 10, 10);
    await guest.answer();
    const order: string[] = [];
    const taken = withoutAgentPointer(guest.entry, () => {
      order.push(`take after ${guest.codes.length} scripts`);
      return Promise.resolve("picture");
    });
    await guest.answer();
    await expect(taken).resolves.toBe("picture");
    expect(order).toEqual(["take after 2 scripts"]);
    expect(guest.codes[1]).toContain('"hidden"');
    expect(guest.codes[2]).toContain('"visible"');
  });

  it("takes the picture straight away when no pointer was shown", async () => {
    const guest = makeGuest();
    await expect(
      withoutAgentPointer(guest.entry, () => Promise.resolve("picture")),
    ).resolves.toBe("picture");
    expect(guest.codes).toEqual([]);
  });
});
