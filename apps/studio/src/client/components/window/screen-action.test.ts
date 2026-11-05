import { ChatIdSchema } from "@instrument-org/workspace/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createScreenSettler,
  SCREEN_SETTLE_MS,
  screenActionOf,
} from "./screen-action";

const ROOFER = ChatIdSchema.parse("2026-10-01-roofer");

const of = (patch: Partial<Parameters<typeof screenActionOf>[0]>) =>
  screenActionOf({
    appName: (slug) => (slug === "linear" ? "Linear" : undefined),
    chatTitle: (chat) => (chat === ROOFER ? "Roof quotes" : undefined),
    href: "/new-tab",
    view: null,
    ...patch,
  });

describe("screenActionOf", () => {
  it.each([
    ["nothing for a new tab", {}, null],
    [
      "Settings over whatever is behind it",
      {
        href: `/chats/${ROOFER}`,
        settingsTab: "Providers" as const,
      },
      { kind: "screen", name: "Settings › Providers" },
    ],
    [
      "nothing for a file a viewer shows, which history records",
      {
        href: "/files",
        view: {
          file: { name: "a.pdf", path: "/Users/sam/a.pdf" },
          screen: "file" as const,
        },
      },
      null,
    ],
    [
      "a folder by where it is, with what is selected in it",
      {
        folderPath: "/Users/sam/Downloads",
        href: "/files",
        view: {
          folder: { display: "~/Downloads", selected: ["a.pdf", "Taxes/"] },
          screen: "computer" as const,
        },
      },
      {
        kind: "folder",
        path: "/Users/sam/Downloads",
        selected: ["a.pdf", "Taxes/"],
      },
    ],
    [
      "a folder with nothing selected",
      {
        href: "/files",
        view: {
          folder: { display: "~/Downloads", selected: [] },
          screen: "computer" as const,
        },
      },
      { kind: "folder", path: "~/Downloads" },
    ],
    [
      "a chat by its id and title",
      { href: `/chats/${ROOFER}` },
      { id: ROOFER, kind: "chat", title: "Roof quotes" },
    ],
    [
      "nothing for a chat whose title is not known yet",
      { href: "/chats/2026-10-02-trip" },
      null,
    ],
    ["Apps", { href: "/apps/" }, { kind: "screen", name: "Apps" }],
    [
      "an app's page by its name",
      { href: "/apps/linear" },
      { kind: "screen", name: "Apps › Linear" },
    ],
    ["Tasks", { href: "/tasks/" }, { kind: "screen", name: "Tasks" }],
    ["nothing for the browser", { href: "/browser" }, null],
    ["nothing for the inbox", { href: "/chats/" }, null],
  ])("names %s", (_name, patch, action) => {
    expect(of(patch)).toEqual(action);
  });
});

describe("createScreenSettler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const settler = () => {
    const settled: string[] = [];
    const screens = createScreenSettler<string>({
      delayMs: SCREEN_SETTLE_MS,
      onSettled: (value) => settled.push(value),
    });
    return { screens, settled };
  };

  it("hands on a screen once it has been in front long enough, and only once", () => {
    const { screens, settled } = settler();
    screens.see("folder");
    vi.advanceTimersByTime(SCREEN_SETTLE_MS - 1);
    expect(settled).toEqual([]);
    screens.see("folder");
    vi.advanceTimersByTime(1);
    screens.see("folder");
    vi.advanceTimersByTime(SCREEN_SETTLE_MS * 2);
    expect(settled).toEqual(["folder"]);
  });

  it("passes over what was in front for less, as a selection typed through", () => {
    const { screens, settled } = settler();
    screens.see("a");
    vi.advanceTimersByTime(500);
    screens.see("ab");
    vi.advanceTimersByTime(500);
    screens.see("abc");
    vi.advanceTimersByTime(SCREEN_SETTLE_MS);
    expect(settled).toEqual(["abc"]);
  });

  it("hands on a screen come back to after another settled, but not after a glance away", () => {
    const { screens, settled } = settler();
    screens.see("folder");
    vi.advanceTimersByTime(SCREEN_SETTLE_MS);
    screens.see("chat");
    vi.advanceTimersByTime(200);
    screens.see("folder");
    vi.advanceTimersByTime(SCREEN_SETTLE_MS);
    expect(settled).toEqual(["folder"]);
    screens.see(null);
    vi.advanceTimersByTime(SCREEN_SETTLE_MS);
    screens.see("folder");
    vi.advanceTimersByTime(SCREEN_SETTLE_MS);
    expect(settled).toEqual(["folder", "folder"]);
  });

  it("hands on nothing once stopped", () => {
    const { screens, settled } = settler();
    screens.see("folder");
    screens.stop();
    vi.advanceTimersByTime(SCREEN_SETTLE_MS);
    expect(settled).toEqual([]);
  });
});
