import { describe, expect, it, vi } from "vitest";

import {
  activeTab,
  BrowserFollowUp,
  pageAfterText,
  pageEffect,
  parseFollowUpSnapshot,
  savedScreenshotPath,
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
      followUp.note({ args, exitCode, read });
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
      name: "a read after the change",
      steps: [{ args: ["open", "x.html"] }, { args: ["snapshot", "-i"] }],
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

  it("attaches nothing when the page cannot be read", async () => {
    const followUp = new BrowserFollowUp();
    followUp.note({
      args: ["click", "@e1"],
      exitCode: 0,
      read: () => Promise.reject(new Error("daemon gone")),
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
      "Page after \`click\` (\`agent-browser snapshot -i --delta\`, run for you): much of the page changed since its last snapshot, so below are only the controls added, removed or renamed, and every other ref is as it was. Run \`agent-browser snapshot -i\` for the page as it is now, or add \`-s <selector>\` for one region.
      No longer on the page: @e7
      - button "Save" [ref=e90]
      - @e4 name is now "Page 2""
    `);
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

describe("savedScreenshotPath", () => {
  it.each([
    ["✓ Screenshot saved to /work/screenshots/shot-1.png\n", "/work/screenshots/shot-1.png"],
    [
      "✓ Screenshot saved to map.png\n   [1] @e1 button \"Save\"\n",
      "map.png",
    ],
    ["✓ Screenshot unchanged (revision 3, 0.0000% pixels changed)\n", undefined],
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
    extra: { said?: string; title?: string; url?: string } = {},
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
      `"Page after \`click\` (\`agent-browser snapshot -i --delta\`, run for you): no interactive element changed since the page's last snapshot. Text outside the controls is not compared; read it with \`get text\` if the action should have changed it."`,
    );
  });

  it("names the page it is of", () => {
    expect(
      rendered(UNCHANGED, "click", {
        title: "Sign in",
        url: "http://127.0.0.1:8731/signin.html",
      }),
    ).toMatchInlineSnapshot(
      `"Page after \`click\` on “Sign in”, http://127.0.0.1:8731/signin.html (\`agent-browser snapshot -i --delta\`, run for you): no interactive element changed since the page's last snapshot. Text outside the controls is not compared; read it with \`get text\` if the action should have changed it."`,
    );
  });

  it("names the page by its address where it has no title", () => {
    expect(
      rendered(UNCHANGED, "click", { url: "http://127.0.0.1:8731/" }),
    ).toMatchInlineSnapshot(
      `"Page after \`click\` on http://127.0.0.1:8731/ (\`agent-browser snapshot -i --delta\`, run for you): no interactive element changed since the page's last snapshot. Text outside the controls is not compared; read it with \`get text\` if the action should have changed it."`,
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

  it("renders a delta", () => {
    expect(rendered(DELTA, "click")).toMatchInlineSnapshot(`
      "Page after \`click\` (\`agent-browser snapshot -i --delta\`, run for you): only what changed since the page's last snapshot is below, and every other element and ref is as it was. If you no longer have that snapshot, run \`agent-browser snapshot -i\`.
      No longer on the page: @e8
      - button "Confirm" [ref=e50]"
    `);
  });
});
