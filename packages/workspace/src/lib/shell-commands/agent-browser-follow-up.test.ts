import { describe, expect, it, vi } from "vitest";

import {
  BrowserFollowUp,
  pageAfterText,
  pageEffect,
  parseFollowUpSnapshot,
} from "./agent-browser-follow-up";

// Recorded from agent-browser 0.38.1 (`snapshot -i --delta`) against a local
// fixture page, with the origin shortened.
const START =
  "--- AGENT_BROWSER_PAGE_CONTENT nonce=469ca6aabe5e4dfc5d0cd502feceeb4f origin=file:///task/work/big.html ---";
const END =
  "--- END_AGENT_BROWSER_PAGE_CONTENT nonce=469ca6aabe5e4dfc5d0cd502feceeb4f ---";
const FULL = [
  START,
  '- heading "Form" [level=1, ref=e1]',
  '- button "Add" [ref=e2]',
  '- link "Next page" [ref=e4]',
  '- checkbox "Agree" [checked=false, ref=e5]',
  END,
  "",
].join("\n");
const UNCHANGED = "unchanged (revision 7)\n";
const DELTA = `${START}
{
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
${END}
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
    const snapshot = vi.fn(() => Promise.resolve(FULL));
    for (const { args, exitCode = 0 } of steps) {
      followUp.note({ args, exitCode, snapshot });
    }
    return { followUp, snapshot };
  }

  it("snapshots after a chain that ends in a change", async () => {
    const { followUp, snapshot } = run([
      { args: ["click", "@e1"] },
      { args: ["wait", "--load", "load"] },
      { args: ["get", "url"] },
    ]);
    expect(await followUp.take(signal)).toMatchObject({
      after: "click",
      kind: "full",
    });
    expect(snapshot).toHaveBeenCalledTimes(1);
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
    const { followUp, snapshot } = run(steps);
    expect(await followUp.take(signal)).toBeUndefined();
    expect(snapshot).not.toHaveBeenCalled();
  });

  it("names the last change, not the first", async () => {
    const { followUp } = run([
      { args: ["open", "x.html"] },
      { args: ["get", "text", "body"] },
      { args: ["click", "@e2"] },
    ]);
    expect((await followUp.take(signal))?.after).toBe("click");
  });

  it("attaches nothing when the snapshot fails", async () => {
    const followUp = new BrowserFollowUp();
    followUp.note({
      args: ["click", "@e1"],
      exitCode: 0,
      snapshot: () => Promise.reject(new Error("daemon gone")),
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
      "--- AGENT_BROWSER_PAGE_CONTENT nonce=469ca6aabe5e4dfc5d0cd502feceeb4f origin=file:///task/work/big.html ---
      - button "Confirm" [ref=e50]
      --- END_AGENT_BROWSER_PAGE_CONTENT nonce=469ca6aabe5e4dfc5d0cd502feceeb4f ---
      No longer on the page: @e8"
    `);
  });

  it("cuts a long full snapshot and counts what it left out", () => {
    const lines = Array.from(
      { length: 500 },
      (_, index) => `- link "Item ${index}" [ref=e${index + 10}]`,
    );
    const parsed = parseFollowUpSnapshot(
      [START, ...lines, END].join("\n"),
      "open",
    );
    expect(parsed?.omittedLines).toBeGreaterThan(0);
    expect(parsed?.text.length).toBeLessThan(
      10_000 + START.length + END.length + 2,
    );
    expect(parsed?.text.endsWith(END)).toBe(true);
  });

  it("attaches nothing for a page with no controls", () => {
    expect(
      parseFollowUpSnapshot(
        `${START}\n(no interactive elements)\n${END}\n`,
        "click",
      ),
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

describe("pageAfterText", () => {
  function rendered(output: string, after: string) {
    const parsed = parseFollowUpSnapshot(output, after);
    if (!parsed) {
      throw new Error("expected a page");
    }
    return pageAfterText(parsed);
  }

  it("renders a full snapshot", () => {
    expect(rendered(FULL, "open")).toMatchInlineSnapshot(`
      "Page after \`open\` (\`agent-browser snapshot -i --delta\`, run for you). Act on these refs directly instead of taking another snapshot; run one only for what this leaves out (\`snapshot -i --urls\` for link addresses).
      --- AGENT_BROWSER_PAGE_CONTENT nonce=469ca6aabe5e4dfc5d0cd502feceeb4f origin=file:///task/work/big.html ---
      - heading "Form" [level=1, ref=e1]
      - button "Add" [ref=e2]
      - link "Next page" [ref=e4]
      - checkbox "Agree" [checked=false, ref=e5]
      --- END_AGENT_BROWSER_PAGE_CONTENT nonce=469ca6aabe5e4dfc5d0cd502feceeb4f ---"
    `);
  });

  it("renders an unchanged page", () => {
    expect(rendered(UNCHANGED, "click")).toMatchInlineSnapshot(
      `"Page after \`click\` (\`agent-browser snapshot -i --delta\`, run for you): no interactive element changed since the page's last snapshot. Text outside the controls is not compared; read it with \`get text\` if the action should have changed it."`,
    );
  });

  it("renders a delta", () => {
    expect(rendered(DELTA, "click")).toMatchInlineSnapshot(`
      "Page after \`click\` (\`agent-browser snapshot -i --delta\`, run for you): only what changed since the page's last snapshot is below, and every other element and ref is as it was. If you no longer have that snapshot, run \`agent-browser snapshot -i\`.
      --- AGENT_BROWSER_PAGE_CONTENT nonce=469ca6aabe5e4dfc5d0cd502feceeb4f origin=file:///task/work/big.html ---
      - button "Confirm" [ref=e50]
      --- END_AGENT_BROWSER_PAGE_CONTENT nonce=469ca6aabe5e4dfc5d0cd502feceeb4f ---
      No longer on the page: @e8"
    `);
  });
});
