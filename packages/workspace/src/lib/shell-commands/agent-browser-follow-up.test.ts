import { Script } from "node:vm";
import { describe, expect, it, vi } from "vitest";

import {
  activeTab,
  BrowserFollowUp,
  LIVE_REGION_SETTLE_MS,
  liveRegionsArgs,
  liveRegionText,
  pageAfterText,
  pageEffect,
  parseFollowUpSnapshot,
  readsLiveRegionsFirst,
  savedScreenshotPath,
  showsPageText,
} from "./agent-browser-follow-up";

// Recorded from agent-browser 0.38.1 (`snapshot -i --delta`) against a local
// fixture page.
const FULL = [
  '- heading "Form" [level=1, ref=e1]',
  '- button "Add" [ref=e2]',
  '- link "Next page" [ref=e4]',
  '- checkbox "Agree" [checked=false, ref=e5]',
  "",
].join("\n");
const UNCHANGED = "unchanged (revision 7)\n";
const DELTA = `{
  "baseRevision": 8,
  "changes": [
    {
      "node": {
        "name": "Confirm",
        "role": "button"
      },
      "op": "add",
      "ref": "@e50"
    },
    {
      "op": "remove",
      "ref": "@e8"
    }
  ],
  "kind": "delta",
  "revision": 9,
  "treeChange": {
    "deleteCount": 1,
    "lines": [
      "- button \\"Confirm\\" [ref=e50]"
    ],
    "startLine": 2
  }
}
`;

describe("pageEffect", () => {
  it.each([
    { args: ["open", "https://example.com"], effect: "changes" },
    { args: ["--headed", "open", "https://example.com"], effect: "changes" },
    { args: ["back"], effect: "changes" },
    { args: ["click", "@e3"], effect: "changes" },
    { args: ["press", "Enter"], effect: "changes" },
    { args: ["check", "@e5"], effect: "changes" },
    {
      args: ["find", "role", "button", "click", "--name", "Save"],
      effect: "changes",
    },
    { args: ["find", "label", "Email", "fill", "a@b.c"], effect: "none" },
    { args: ["tab", "new", "https://example.com"], effect: "changes" },
    { args: ["tab", "list"], effect: "none" },
    { args: ["dialog", "accept"], effect: "changes" },
    { args: ["fill", "@e2", "text"], effect: "none" },
    { args: ["wait", "--url", "**/done"], effect: "none" },
    { args: ["get", "url"], effect: "none" },
    { args: ["get", "title"], effect: "none" },
    { args: ["get", "text", "body"], effect: "reads" },
    { args: ["snapshot", "-i", "--urls"], effect: "reads" },
    { args: ["screenshot"], effect: "reads" },
    { args: ["eval", "document.title"], effect: "reads" },
    { args: ["read"], effect: "reads" },
    { args: [], effect: "none" },
  ])("$args -> $effect", ({ args, effect }) => {
    expect(pageEffect(args)).toBe(effect);
  });
});

describe("BrowserFollowUp", () => {
  const signal = new AbortController().signal;

  function run(steps: { args: string[]; exitCode?: number }[]) {
    const followUp = new BrowserFollowUp();
    const read = vi.fn(() => Promise.resolve({ snapshot: FULL }));
    for (const { args, exitCode = 0 } of steps) {
      followUp.note({ args, exitCode, read, startedAt: 0 });
    }
    return { followUp, read };
  }

  it("snapshots after a chain that ends in a change", async () => {
    const { followUp, read } = run([
      { args: ["click", "@e1"] },
      { args: ["wait", "--load", "load"] },
      { args: ["get", "url"] },
    ]);
    expect(await followUp.take(signal)).toMatchObject({
      after: "click",
      kind: "full",
    });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      name: "a read of the page's text after the change",
      steps: [{ args: ["open", "x.html"] }, { args: ["get", "text", "body"] }],
    },
    {
      name: "a change that failed",
      steps: [{ args: ["click", "@e9"], exitCode: 1 }],
    },
    { name: "no change at all", steps: [{ args: ["get", "url"] }] },
  ])("attaches nothing after $name", async ({ steps }) => {
    const { followUp, read } = run(steps);
    expect(await followUp.take(signal)).toBeUndefined();
    expect(read).not.toHaveBeenCalled();
  });

  it("names the last change, not the first", async () => {
    const { followUp } = run([
      { args: ["open", "x.html"] },
      { args: ["get", "text", "body"] },
      { args: ["click", "@e2"] },
    ]);
    expect((await followUp.take(signal))?.after).toBe("click");
  });

  it("reads the page's messages from the first change since it was last read", async () => {
    const followUp = new BrowserFollowUp();
    const read = vi.fn(() => Promise.resolve({ snapshot: FULL }));
    followUp.note({ args: ["click", "@e1"], exitCode: 0, read, startedAt: 10 });
    followUp.note({
      args: ["get", "text", "body"],
      exitCode: 0,
      read,
      startedAt: 20,
    });
    followUp.note({ args: ["click", "@e2"], exitCode: 0, read, startedAt: 30 });
    followUp.note({ args: ["click", "@e3"], exitCode: 0, read, startedAt: 40 });
    await followUp.take(signal);
    expect(read).toHaveBeenCalledWith(expect.any(AbortSignal), {
      messages: { settleMs: LIVE_REGION_SETTLE_MS, since: 30 },
      snapshot: true,
    });
  });

  it.each([
    { name: "`open`", args: ["open", "https://example.com"] },
    { name: "`back`", args: ["back"] },
    { name: "`reload`", args: ["reload"] },
    { name: "a tab switch", args: ["tab", "2"] },
  ])("reads no messages after $name", async ({ args }) => {
    const followUp = new BrowserFollowUp();
    const read = vi.fn(() => Promise.resolve({ snapshot: FULL }));
    followUp.note({ args: ["click", "@e1"], exitCode: 0, read, startedAt: 1 });
    followUp.note({ args, exitCode: 0, read, startedAt: 5 });
    expect(await followUp.take(signal)).toMatchObject({ kind: "full" });
    expect(read).toHaveBeenCalledWith(expect.any(AbortSignal), {
      snapshot: true,
    });
  });

  it("passes the document read before the action to the reading after it", async () => {
    const followUp = new BrowserFollowUp();
    const read = vi.fn(() => Promise.resolve({ snapshot: FULL }));
    const before = { loadedAt: 3, url: "http://x/contacts" };
    followUp.note({
      args: ["click", "@e1"],
      before,
      exitCode: 0,
      read,
      startedAt: 10,
    });
    followUp.note({
      args: ["click", "@e2"],
      before,
      exitCode: 0,
      read,
      startedAt: 20,
    });
    await followUp.take(signal);
    expect(read).toHaveBeenCalledWith(expect.any(AbortSignal), {
      messages: { before, settleMs: LIVE_REGION_SETTLE_MS, since: 10 },
      snapshot: true,
    });
  });

  it.each([
    {
      name: "loaded after the earlier click began",
      second: { loadedAt: 12, url: "http://x/contacts/3" },
    },
    {
      name: "at another address",
      second: { loadedAt: 3, url: "http://x/contacts/3" },
    },
  ])(
    "reads from the later click when the earlier one left a document $name",
    async ({ second }) => {
      const followUp = new BrowserFollowUp();
      const read = vi.fn(() => Promise.resolve({ snapshot: FULL }));
      followUp.note({
        args: ["click", "@e1"],
        before: { loadedAt: 3, url: "http://x/contacts" },
        exitCode: 0,
        read,
        startedAt: 10,
      });
      followUp.note({
        args: ["click", "@e2"],
        before: second,
        exitCode: 0,
        read,
        startedAt: 20,
      });
      await followUp.take(signal);
      expect(read).toHaveBeenCalledWith(expect.any(AbortSignal), {
        messages: {
          before: second,
          settleMs: LIVE_REGION_SETTLE_MS,
          since: 20,
        },
        snapshot: true,
      });
    },
  );

  it("reads only the page's messages after a call that read the controls itself", async () => {
    const followUp = new BrowserFollowUp();
    const read = vi.fn(() =>
      Promise.resolve({ said: "Saved Ada as contact #1.", snapshot: "" }),
    );
    followUp.note({ args: ["click", "@e11"], exitCode: 0, read, startedAt: 7 });
    followUp.note({ args: ["get", "url"], exitCode: 0, read, startedAt: 8 });
    followUp.note({
      args: ["snapshot", "-i"],
      exitCode: 0,
      read,
      startedAt: 9,
    });
    expect(await followUp.take(signal)).toEqual({
      after: "click",
      kind: "messages",
      said: "Saved Ada as contact #1.",
      text: "",
    });
    expect(read).toHaveBeenCalledWith(expect.any(AbortSignal), {
      messages: { settleMs: LIVE_REGION_SETTLE_MS, since: 7 },
      snapshot: false,
    });
  });

  it("attaches nothing after a read of the controls when the page said nothing", async () => {
    const { followUp, read } = run([
      { args: ["click", "@e1"] },
      { args: ["snapshot", "-i"] },
    ]);
    expect(await followUp.take(signal)).toBeUndefined();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("reads nothing after `open` and the model's own read of the controls", async () => {
    const { followUp, read } = run([
      { args: ["open", "x.html"] },
      { args: ["snapshot", "-i"] },
    ]);
    expect(await followUp.take(signal)).toBeUndefined();
    expect(read).not.toHaveBeenCalled();
  });

  it("carries the page's messages onto the attachment", async () => {
    const followUp = new BrowserFollowUp();
    followUp.note({
      args: ["click", "@e1"],
      exitCode: 0,
      read: () =>
        Promise.resolve({
          said: "Saved.",
          showing: "3 items",
          snapshot: UNCHANGED,
        }),
      startedAt: 0,
    });
    expect(await followUp.take(signal)).toEqual({
      after: "click",
      kind: "unchanged",
      said: "Saved.",
      showing: "3 items",
      text: "",
    });
  });

  it("attaches nothing when the page cannot be read", async () => {
    const followUp = new BrowserFollowUp();
    followUp.note({
      args: ["click", "@e1"],
      exitCode: 0,
      read: () => Promise.reject(new Error("daemon gone")),
      startedAt: 0,
    });
    expect(await followUp.take(signal)).toBeUndefined();
  });
});

describe("parseFollowUpSnapshot", () => {
  it("keeps a full snapshot inside its markers", () => {
    expect(parseFollowUpSnapshot(FULL, "open")).toEqual({
      after: "open",
      kind: "full",
      text: FULL.trimEnd(),
    });
  });

  it("reads an unchanged page", () => {
    expect(parseFollowUpSnapshot(UNCHANGED, "click")).toEqual({
      after: "click",
      kind: "unchanged",
      text: "",
    });
  });

  it("keeps a delta's tree lines and removed refs", () => {
    expect(parseFollowUpSnapshot(DELTA, "click")?.text).toMatchInlineSnapshot(`
      "No longer on the page: @e8
      - button "Confirm" [ref=e50]"
    `);
  });

  it("tells a delta with a long changed region as the controls it changed", () => {
    const long = JSON.stringify({
      baseRevision: 3,
      changes: [
        { node: { name: "Save", role: "button" }, op: "add", ref: "@e90" },
        { field: "name", op: "replace", ref: "@e4", value: "Page 2" },
        { op: "remove", ref: "@e7" },
      ],
      kind: "delta",
      revision: 4,
      treeChange: {
        deleteCount: 300,
        lines: Array.from(
          { length: 300 },
          (_, index) => `- link "Row ${index}" [ref=e${index + 100}]`,
        ),
        startLine: 1,
      },
    });
    const parsed = parseFollowUpSnapshot(long, "click");
    expect(parsed).toMatchObject({ kind: "delta", summarized: true });
    expect(parsed?.text).toMatchInlineSnapshot(`
      "No longer on the page: @e7
      - button "Save" [ref=e90]
      - @e4 name is now "Page 2""
    `);
    expect(parsed && pageAfterText(parsed)).toMatchInlineSnapshot(`
      "Page after \`click\` (\`agent-browser snapshot -i --delta\`, run for you): much of the page changed since its last snapshot, so below are only the controls added, removed or renamed. A control's state (checked, expanded, its value) is not compared here. Run \`agent-browser snapshot -i\` for the page as it is now, or add \`-s <selector>\` for one region.
      No longer on the page: @e7
      - button "Save" [ref=e90]
      - @e4 name is now "Page 2""
    `);
  });

  it("counts the removed refs past what fits rather than listing them all", () => {
    const removedMany = JSON.stringify({
      baseRevision: 3,
      changes: Array.from({ length: 300 }, (_, index) => ({
        op: "remove",
        ref: `@e${index + 1}`,
      })),
      kind: "delta",
      revision: 4,
      treeChange: { deleteCount: 300, lines: [], startLine: 0 },
    });
    const text = parseFollowUpSnapshot(removedMany, "click")?.text ?? "";
    expect(text.length).toBeLessThan(600);
    expect(text).toMatch(/, and \d+ more$/);
  });

  it("cuts a long full snapshot and counts what it left out", () => {
    const lines = Array.from(
      { length: 500 },
      (_, index) => `- link "Item ${index}" [ref=e${index + 10}]`,
    );
    const parsed = parseFollowUpSnapshot(lines.join("\n"), "open");
    expect(parsed?.omittedLines).toBeGreaterThan(0);
    expect(parsed?.text.length).toBeLessThan(10_000);
  });

  it("attaches nothing for a page with no controls", () => {
    expect(
      parseFollowUpSnapshot("(no interactive elements)\n", "click"),
    ).toBeUndefined();
  });

  it("passes unexpected output through whole", () => {
    expect(parseFollowUpSnapshot("something else\n", "click")).toEqual({
      after: "click",
      kind: "full",
      text: "something else",
    });
  });
});

// Recorded from `agent-browser tab list --json` against the same build.
const TABS = JSON.stringify({
  data: {
    tabs: [
      { active: false, title: "Other", url: "http://127.0.0.1:8731/" },
      {
        active: true,
        title: "Sign in",
        url: "http://127.0.0.1:8731/signin.html",
      },
    ],
  },
  success: true,
});

describe("readsLiveRegionsFirst", () => {
  it.each([
    { args: ["click", "@e3"], reads: true },
    { args: ["press", "Enter"], reads: true },
    { args: ["check", "@e5"], reads: true },
    {
      args: ["find", "role", "button", "click", "--name", "Save"],
      reads: true,
    },
    { args: ["find", "role", "alert", "text"], reads: false },
    { args: ["open", "https://example.com"], reads: false },
    { args: ["tab", "2"], reads: false },
    { args: ["fill", "@e2", "text"], reads: false },
    { args: [], reads: false },
  ])("$args -> $reads", ({ args, reads }) => {
    expect(readsLiveRegionsFirst(args)).toBe(reads);
  });
});

describe("showsPageText", () => {
  it.each([
    { args: ["snapshot"], shows: true },
    { args: ["snapshot", "-i"], shows: false },
    { args: ["snapshot", "--interactive", "--urls"], shows: false },
    { args: ["get", "text", "body"], shows: true },
    { args: ["get", "value", "@e2"], shows: false },
    { args: ["read"], shows: true },
    { args: ["eval", "document.title"], shows: true },
    { args: ["screenshot"], shows: true },
    { args: ["get", "url"], shows: false },
  ])("$args -> $shows", ({ args, shows }) => {
    expect(showsPageText(args)).toBe(shows);
  });
});

describe("liveRegionsArgs", () => {
  it("evaluates the script with when the step began and how long to wait", () => {
    const args = liveRegionsArgs({ settleMs: 500, since: 1_700_000_000_000 });
    expect(args.slice(0, 2)).toEqual(["--json", "eval"]);
    expect(args[2]).toMatch(/^\(async \(since, settleMs\) => \{/);
    expect(args[2]).toMatch(/\}\)\(1700000000000, 500\)$/);
    // The script is the page's to run, so it has to parse as JavaScript.
    expect(() => new Script(args[2] ?? "")).not.toThrow();
  });
});

describe("liveRegionText", () => {
  const since = 1000;
  function output(
    regions: {
      changedAt?: number | null;
      read?: boolean;
      same?: boolean;
      text: string;
    }[],
    loadedAt = 500,
    url = "http://x/contacts",
  ) {
    return JSON.stringify({
      data: {
        result: {
          loadedAt,
          url,
          regions: regions.map(
            ({ changedAt = null, read = true, same = true, text }) => ({
              changedAt,
              read,
              same,
              text,
            }),
          ),
        },
      },
      success: true,
    });
  }

  it.each([
    {
      name: "a region the step changed",
      regions: [{ changedAt: 1200, text: "Saved Ada as contact #3." }],
      expected: { said: "Saved Ada as contact #3." },
    },
    {
      name: "a message the step wrote again in the same words",
      regions: [{ changedAt: 1001, same: true, text: "Saved." }],
      expected: { said: "Saved." },
    },
    {
      name: "a region whose text the step changed without a change seen in it",
      regions: [{ same: false, text: "Email is required." }],
      expected: { said: "Email is required." },
    },
    {
      name: "a message from before the step",
      regions: [{ changedAt: 400, text: "Saved Grace as contact #2." }],
      expected: {},
    },
    {
      name: "a region with no earlier reading",
      regions: [{ read: false, text: "Last saved two days ago." }],
      expected: { showing: "Last saved two days ago." },
    },
  ])("reads $name", ({ expected, regions }) => {
    expect(liveRegionText(output(regions), since)).toEqual(expected);
  });

  it("reports a change in the document read before the step", () => {
    expect(
      liveRegionText(
        output([{ changedAt: 1200, text: "Saved Ada as contact #3." }]),
        since,
        { loadedAt: 500, url: "http://x/contacts" },
      ),
    ).toEqual({ said: "Saved Ada as contact #3." });
  });

  it.each([
    {
      name: "a document the step loaded",
      given: output(
        [{ read: false, text: "Free shipping on orders over $35" }],
        1500,
        "http://x/cart",
      ),
      before: undefined,
    },
    {
      name: "another document than the one read before the step",
      given: output(
        [{ changedAt: 1200, text: "Sign in or create account" }],
        800,
        "http://x/signin",
      ),
      before: { loadedAt: 500, url: "http://x/" },
    },
    {
      name: "an address the step moved to in the same document",
      given: output(
        [{ changedAt: 1200, text: "Recommended for you" }],
        500,
        "http://x/product/7",
      ),
      before: { loadedAt: 500, url: "http://x/" },
    },
  ])("reports nothing from $name", ({ before, given }) => {
    expect(liveRegionText(given, since, before)).toEqual({});
  });

  it("keeps several messages inside the budget and counts the rest", () => {
    const { said } = liveRegionText(
      output([
        { changedAt: 1100, text: "a".repeat(300) },
        { changedAt: 1100, text: "b".repeat(150) },
        { changedAt: 1100, text: "Third" },
        { changedAt: 1100, text: "Fourth" },
      ]),
      since,
    );
    // The second is cut to what is left of the budget, with an ellipsis.
    expect(said?.split("\n").map((line) => line.length)).toEqual([
      300, 100, 10,
    ]);
    expect(said?.split("\n").at(-1)).toBe("and 2 more");
  });

  it.each(["", "not json", JSON.stringify({ success: false, data: null })])(
    "reads nothing from %j",
    (given) => {
      expect(liveRegionText(given, since)).toEqual({});
    },
  );
});

describe("savedScreenshotPath", () => {
  it.each([
    [
      "✓ Screenshot saved to /work/screenshots/shot-1.png\n",
      "/work/screenshots/shot-1.png",
    ],
    ['✓ Screenshot saved to map.png\n   [1] @e1 button "Save"\n', "map.png"],
    [
      "✓ Screenshot unchanged (revision 3, 0.0000% pixels changed)\n",
      undefined,
    ],
    ["✗ Element not found\n", undefined],
  ])("reads %j", (stdout, expected) => {
    expect(savedScreenshotPath(stdout)).toBe(expected);
  });
});

describe("BrowserFollowUp screenshots", () => {
  it("hands over the last screenshot once", () => {
    const followUp = new BrowserFollowUp();
    followUp.noteScreenshot("/a.png");
    followUp.noteScreenshot("/b.png");
    expect(followUp.takeScreenshot()).toBe("/b.png");
    expect(followUp.takeScreenshot()).toBeUndefined();
  });
});

describe("activeTab", () => {
  it("takes the tab the commands are acting on", () => {
    expect(activeTab(TABS)).toEqual({
      title: "Sign in",
      url: "http://127.0.0.1:8731/signin.html",
    });
  });

  it("falls back to the only tab when none says it is active", () => {
    expect(
      activeTab(JSON.stringify({ data: { tabs: [{ url: "http://x/" }] } })),
    ).toEqual({ url: "http://x/" });
  });

  it.each([
    { name: "output that is not JSON", output: "✓ Done" },
    { name: "JSON of another shape", output: '{"ok":true}' },
    { name: "no tabs at all", output: '{"data":{"tabs":[]}}' },
    {
      name: "a tab that reports neither",
      output: '{"data":{"tabs":[{"active":true}]}}',
    },
  ])("says nothing about $name", ({ output }) => {
    expect(activeTab(output)).toEqual({});
  });

  it("leaves out a title that is only whitespace", () => {
    expect(
      activeTab(
        '{"data":{"tabs":[{"active":true,"title":"  ","url":"http://x/"}]}}',
      ),
    ).toEqual({ url: "http://x/" });
  });
});

describe("pageAfterText", () => {
  function rendered(
    output: string,
    after: string,
    extra: {
      said?: string;
      showing?: string;
      title?: string;
      url?: string;
    } = {},
  ) {
    const parsed = parseFollowUpSnapshot(output, after);
    if (!parsed) {
      throw new Error("expected a page");
    }
    return pageAfterText({ ...parsed, ...extra });
  }

  it("renders a full snapshot", () => {
    expect(rendered(FULL, "open")).toMatchInlineSnapshot(`
      "Page after \`open\` (\`agent-browser snapshot -i --delta\`, run for you). Act on these refs directly instead of taking another snapshot; run one only for what this leaves out (\`snapshot -i --urls\` for link addresses).
      - heading "Form" [level=1, ref=e1]
      - button "Add" [ref=e2]
      - link "Next page" [ref=e4]
      - checkbox "Agree" [checked=false, ref=e5]"
    `);
  });

  it("renders an unchanged page", () => {
    expect(rendered(UNCHANGED, "click")).toMatchInlineSnapshot(
      `"Page after \`click\` (\`agent-browser snapshot -i --delta\`, run for you): no interactive element changed since the page's last snapshot. Text outside the controls is compared only where the page announces it (below, when it did); read the rest with \`get text\` if the action should have changed it."`,
    );
  });

  it("names the page it is of", () => {
    expect(
      rendered(UNCHANGED, "click", {
        title: "Sign in",
        url: "http://127.0.0.1:8731/signin.html",
      }),
    ).toMatchInlineSnapshot(
      `"Page after \`click\` on “Sign in”, http://127.0.0.1:8731/signin.html (\`agent-browser snapshot -i --delta\`, run for you): no interactive element changed since the page's last snapshot. Text outside the controls is compared only where the page announces it (below, when it did); read the rest with \`get text\` if the action should have changed it."`,
    );
  });

  it("names the page by its address where it has no title", () => {
    expect(
      rendered(UNCHANGED, "click", { url: "http://127.0.0.1:8731/" }),
    ).toMatchInlineSnapshot(
      `"Page after \`click\` on http://127.0.0.1:8731/ (\`agent-browser snapshot -i --delta\`, run for you): no interactive element changed since the page's last snapshot. Text outside the controls is compared only where the page announces it (below, when it did); read the rest with \`get text\` if the action should have changed it."`,
    );
  });

  it("carries what the page said about the action, above the controls", () => {
    expect(
      rendered(DELTA, "click", {
        said: "That password is wrong.",
        title: "Sign in",
        url: "http://127.0.0.1:8731/signin.html",
      }),
    ).toMatchInlineSnapshot(`
      "Page after \`click\` on “Sign in”, http://127.0.0.1:8731/signin.html (\`agent-browser snapshot -i --delta\`, run for you): only what changed since the page's last snapshot is below, and every other element and ref is as it was. If you no longer have that snapshot, run \`agent-browser snapshot -i\`.
      The page's own message: That password is wrong.
      No longer on the page: @e8
      - button "Confirm" [ref=e50]"
    `);
  });

  it("renders the page's messages alone", () => {
    expect(
      pageAfterText({
        after: "click",
        kind: "messages",
        said: "Saved Ada Okafor as contact #1.",
        text: "",
      }),
    ).toMatchInlineSnapshot(`
      "Messages on the page after \`click\` (its live regions, read for you, since \`snapshot -i\` leaves out text):
      The page's own message: Saved Ada Okafor as contact #1."
    `);
  });

  it("lists several messages, and says which may be from before the step", () => {
    expect(
      rendered(UNCHANGED, "click", {
        said: "Saved Ada Lovelace as contact #3.\nThe list has 3 contacts.",
        showing: "Last synced 2 minutes ago.",
      }),
    ).toMatchInlineSnapshot(`
      "Page after \`click\` (\`agent-browser snapshot -i --delta\`, run for you): no interactive element changed since the page's last snapshot. Text outside the controls is compared only where the page announces it (below, when it did); read the rest with \`get text\` if the action should have changed it.
      The page's own messages:
      - Saved Ada Lovelace as contact #3.
      - The list has 3 contacts.
      The page's status text, which may be from before this step: Last synced 2 minutes ago."
    `);
  });

  it("renders a delta", () => {
    expect(rendered(DELTA, "click")).toMatchInlineSnapshot(`
      "Page after \`click\` (\`agent-browser snapshot -i --delta\`, run for you): only what changed since the page's last snapshot is below, and every other element and ref is as it was. If you no longer have that snapshot, run \`agent-browser snapshot -i\`.
      No longer on the page: @e8
      - button "Confirm" [ref=e50]"
    `);
  });
});
