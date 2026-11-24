import { PAGE_EDIT_CHANNEL } from "@/shared/page-editor-channels";
import {
  type BrowserTargetId,
  browserTargetOf,
  StoreId,
} from "@instrument-org/workspace/electron";
import { type WebContents } from "electron";
import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { agentAt, heard } = vi.hoisted(() => ({
  agentAt: new Map<string, number>(),
  heard: new Map<string, (event: unknown) => void>(),
}));

vi.mock("electron", () => ({
  app: { on: vi.fn() },
  ipcMain: {
    on: (channel: string, listener: (event: unknown) => void) => {
      heard.set(channel, listener);
    },
  },
  webFrameMain: { fromId: () => undefined },
}));
vi.mock("./log", () => ({ log: { info: vi.fn() } }));
vi.mock("@instrument-org/workspace/electron", async (original) => ({
  ...(await original<typeof import("@instrument-org/workspace/electron")>()),
  lastBrowserAgentActivity: (targetId: string) => agentAt.get(targetId),
}));

import { type BrowserEntry } from "./entry";
import { USER_INPUT_WINDOW_MS } from "./external-app-links";
import { type GuestRole, guests } from "./guest-registry";
import {
  isPersonEdit,
  isTypedCharacter,
  listenForPageEdits,
  typedIntoFrame,
} from "./page-edits";

const NOW = 1_000_000;
const tabGuest = (userInputAt: number) =>
  ({ role: "webview", userInputAt }) as const;

describe("whose entry into a page it is", () => {
  it.each([
    ["a key of the person's just before, no agent", NOW - 100, undefined, true],
    ["dictation: no key at all, no agent", 0, undefined, true],
    [
      "dictation, with an agent's last command long past",
      0,
      NOW - USER_INPUT_WINDOW_MS - 1,
      true,
    ],
    ["an agent's command just before, no key", 0, NOW - 100, false],
    [
      "an agent's command just before, the person's key long past",
      NOW - USER_INPUT_WINDOW_MS - 1,
      NOW - 100,
      false,
    ],
    ["both just before: the person's counts", NOW - 100, NOW - 100, true],
  ])("%s", (_case, userInputAt, agentCommandAt, expected) => {
    expect(isPersonEdit(tabGuest(userInputAt), agentCommandAt, NOW)).toBe(
      expected,
    );
  });

  it("leaves out a contents that is no tab's guest", () => {
    expect(
      isPersonEdit({ role: "popup", userInputAt: NOW - 100 }, undefined, NOW),
    ).toBe(false);
  });
});

describe("a key typed into a frame", () => {
  const contents = (focused: null | number) =>
    ({
      focusedFrame: focused === null ? null : { frameTreeNodeId: focused },
      mainFrame: { frameTreeNodeId: 1 },
    }) as unknown as Parameters<typeof typedIntoFrame>[0];

  it.each([
    ["the main frame", 1, false],
    ["a frame below it", 7, true],
    ["no frame focused", null, false],
  ])("%s", (_case, focused, expected) => {
    expect(typedIntoFrame(contents(focused))).toBe(expected);
  });

  it.each([
    ["a letter", { key: "a", type: "keyDown" }, true],
    ["a space", { key: " ", type: "keyDown" }, true],
    ["a key coming up", { key: "a", type: "keyUp" }, false],
    ["an arrow", { key: "ArrowDown", type: "keyDown" }, false],
    ["Enter", { key: "Enter", type: "keyDown" }, false],
    ["a chord", { key: "c", meta: true, type: "keyDown" }, false],
    [
      "a chord with Control",
      { control: true, key: "c", type: "keyDown" },
      false,
    ],
  ] as const)("%s", (_case, input, expected) => {
    expect(isTypedCharacter({ control: false, meta: false, ...input })).toBe(
      expected,
    );
  });
});

describe("a page saying something was entered", () => {
  let nextId = 100;
  const MAIN = { frameTreeNodeId: 1 };

  /** A guest the registry tracks, bound to a tab when it is one. */
  function guest(role: GuestRole, targetId?: BrowserTargetId) {
    // Electron's WebContents is a Node EventEmitter.
    const contents = Object.assign(new EventEmitter(), {
      id: nextId++,
      mainFrame: MAIN,
    }) as unknown as WebContents;
    const record = guests.track(contents, role);
    if (targetId) {
      record.entry = { targetId } as BrowserEntry;
    }
    return { contents, record };
  }
  const say = (contents: WebContents, senderFrame: object = MAIN) => {
    heard.get(PAGE_EDIT_CHANNEL)?.({ sender: contents, senderFrame });
  };

  beforeEach(() => {
    agentAt.clear();
    listenForPageEdits();
  });

  it("marks a tab's page", () => {
    const { contents, record } = guest("webview");
    say(contents);
    expect(record.edited).toBe(true);
  });

  it("leaves out a frame below the main one, and what is no tab's guest", () => {
    const framed = guest("webview");
    say(framed.contents, { frameTreeNodeId: 7 });
    expect(framed.record.edited).toBe(false);

    const popup = guest("popup");
    say(popup.contents);
    expect(popup.record.edited).toBe(false);
  });

  it("leaves out what an agent's command entered just before", () => {
    const targetId = browserTargetOf(StoreId.newTabId());
    const { contents, record } = guest("webview", targetId);
    agentAt.set(targetId, Date.now());
    say(contents);
    expect(record.edited).toBe(false);

    agentAt.set(targetId, Date.now() - USER_INPUT_WINDOW_MS - 1);
    say(contents);
    expect(record.edited).toBe(true);
  });
});
