import { beforeEach, describe, expect, it, vi } from "vitest";

import { type GuestRecord, guests } from "./guest-registry";

const driven = new Set<string>();

vi.mock("@instrument-org/workspace/electron", () => ({
  isDrivenByWorkingAgent: (targetId: string) =>
    Promise.resolve(driven.has(targetId)),
}));
vi.mock("./log", () => ({ log: { error: vi.fn(), info: vi.fn() } }));
vi.mock("./guest-registry", () => {
  const records: unknown[] = [];
  return {
    guests: {
      records: () => records.values(),
      set: (next: unknown[]) => records.splice(0, records.length, ...next),
    },
  };
});

const { contentScriptMatches, matchesPattern, reloadOpenTabsFor } =
  await import("./extension-open-tabs");

/** 1Password's own content scripts, in short. */
const MANIFEST = {
  content_scripts: [
    { js: ["inline/inject-content-scripts.js"], matches: ["<all_urls>"] },
    { js: ["inline/injected/b5.js"], matches: ["https://*.1password.com/*"] },
  ],
};

function tab(
  targetId: string,
  url: string,
  {
    agentCommandAt = 0,
    audible = false,
    unsaved = false,
  }: { agentCommandAt?: number; audible?: boolean; unsaved?: boolean } = {},
) {
  const reload = vi.fn();
  const record = {
    contents: {
      getURL: () => url,
      isCurrentlyAudible: () => audible,
      isDestroyed: () => false,
      mainFrame: {
        framesInSubtree: [
          { executeJavaScript: () => Promise.resolve(false) },
          { executeJavaScript: () => Promise.resolve(unsaved) },
        ],
      },
      reload,
    },
    edit: null,
    entry: { lastAgentCommandAt: agentCommandAt, targetId },
    htmlFullScreen: false,
    role: "webview",
  } as unknown as GuestRecord;
  return { record, reload };
}

function setTabs(tabs: { record: GuestRecord }[]) {
  (guests as unknown as { set: (records: GuestRecord[]) => void }).set(
    tabs.map(({ record }) => record),
  );
}

describe("reloadOpenTabsFor", () => {
  beforeEach(() => {
    driven.clear();
  });

  it("reloads the open pages a new extension reaches and nothing would lose", async () => {
    const plain = tab("tab_plain", "https://www.patreon.com/login");
    const typedIn = tab("tab_typed", "https://example.com/form", {
      unsaved: true,
    });
    const agentNow = tab("tab_agent", "https://example.com/a", {
      agentCommandAt: Date.now(),
    });
    const drivenTab = tab("tab_driven", "https://example.com/b");
    driven.add("tab_driven");
    const playing = tab("tab_music", "https://music.example.com", {
      audible: true,
    });
    const blank = tab("tab_blank", "about:blank");
    setTabs([plain, typedIn, agentNow, drivenTab, playing, blank]);

    await reloadOpenTabsFor({ id: "ext", manifest: MANIFEST, name: "1P" });

    expect(
      Object.entries({ agentNow, blank, drivenTab, plain, playing, typedIn })
        .filter(([, each]) => each.reload.mock.calls.length > 0)
        .map(([name]) => name),
    ).toEqual(["plain"]);
  });

  it("leaves every tab alone for an extension with no content scripts", async () => {
    const plain = tab("tab_plain", "https://example.com");
    setTabs([plain]);

    await reloadOpenTabsFor({ id: "ext", manifest: {}, name: "Theme" });

    expect(plain.reload).not.toHaveBeenCalled();
  });
});

describe("matchesPattern", () => {
  it.each([
    ["https://example.com/a", "<all_urls>", true],
    ["file:///Users/me/page.html", "<all_urls>", false],
    ["file:///Users/me/page.html", "file:///*", false],
    ["about:blank", "<all_urls>", false],
    ["chrome-extension://abc/popup.html", "<all_urls>", false],
    ["http://example.com/", "*://*/*", true],
    ["https://my.1password.com/vault", "https://*.1password.com/*", true],
    ["https://1password.com/", "https://*.1password.com/*", true],
    ["https://evil1password.com/", "https://*.1password.com/*", false],
    ["http://my.1password.com/", "https://*.1password.com/*", false],
    ["http://localhost/x", "http://localhost/*", true],
    ["https://example.com/docs/a", "https://example.com/docs/*", true],
    ["https://example.com/blog", "https://example.com/docs/*", false],
  ])("%s against %s is %s", (url, pattern, expected) => {
    expect(matchesPattern(url, pattern)).toBe(expected);
  });

  it("reads the patterns from a manifest's content scripts", () => {
    expect(contentScriptMatches(MANIFEST)).toEqual([
      "<all_urls>",
      "https://*.1password.com/*",
    ]);
  });
});
