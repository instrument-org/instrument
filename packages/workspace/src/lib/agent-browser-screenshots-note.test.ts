import { describe, expect, it } from "vitest";

import { type SessionMessagePart } from "../schemas/session/message-part";
import { StoreId } from "../schemas/store-id";
import { agentBrowserScreenshotsNote } from "./agent-browser-screenshots-note";

function obs({
  endHash,
  endUrl,
  error,
  startHash,
  startUrl,
  subcommand = "navigate https://a.example",
}: {
  endHash?: string;
  endUrl?: string;
  error?: string;
  startHash: string;
  startUrl: string;
  subcommand?: string;
}): SessionMessagePart.ToolPartContextItem {
  return {
    createdAt: new Date(0),
    endedAt: new Date(0),
    ...(endHash && endUrl
      ? {
          endScreenshot: {
            path: `.state/agent-browser/${endHash}.jpg`,
            url: endUrl,
          },
        }
      : {}),
    ...(error ? { error } : {}),
    id: StoreId.newPartContextItemId(),
    kind: "agent-browser-command",
    startScreenshot: {
      path: `.state/agent-browser/${startHash}.jpg`,
      url: startUrl,
    },
    status: "complete",
    subcommand,
  };
}

function pending(subcommand: string): SessionMessagePart.ToolPartContextItem {
  return {
    createdAt: new Date(0),
    id: StoreId.newPartContextItemId(),
    kind: "agent-browser-command",
    startScreenshot: {
      path: ".state/agent-browser/aaa.jpg",
      url: "https://a",
    },
    status: "pending",
    subcommand,
  };
}

describe("agentBrowserScreenshotsNote", () => {
  it("returns undefined for empty / missing input", () => {
    expect(agentBrowserScreenshotsNote(undefined)).toBeUndefined();
    expect(agentBrowserScreenshotsNote([])).toBeUndefined();
  });

  it("returns undefined when only pending items are present", () => {
    expect(
      agentBrowserScreenshotsNote([pending("navigate https://a")]),
    ).toBeUndefined();
  });

  it("renders one terse line per observation", () => {
    expect(
      agentBrowserScreenshotsNote([
        obs({
          endHash: "b1c2d3",
          endUrl: "https://b.example",
          startHash: "a1b2c3",
          startUrl: "https://a.example",
          subcommand: "navigate https://b.example",
        }),
        obs({
          endHash: "e4f5a6",
          endUrl: "https://b.example/done",
          startHash: "b1c2d3",
          startUrl: "https://b.example",
          subcommand: "click #submit",
        }),
      ]),
    ).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      \`agent-browser\` capture metadata (one entry per call, deduped by content).

      The Instrument UI renders these screenshots inline for the user. Do NOT
      mention, summarize, or narrate them in your reply (e.g. no "I captured a
      screenshot", "the screenshot shows…", etc.).

      You MAY silently read the underlying files when you need to inspect a prior
      page state instead of re-capturing: each \`<hash>\` resolves to
      \`.state/agent-browser/<hash>.jpg\`.

      - navigate -> b1c2d3
      - click -> e4f5a6
      </instrument-system-note>"
    `);
  });

  it("collapses no-op observations to (no change)", () => {
    expect(
      agentBrowserScreenshotsNote([
        obs({
          endHash: "a1b2c3",
          endUrl: "https://a.example",
          startHash: "a1b2c3",
          startUrl: "https://a.example",
          subcommand: "get title",
        }),
      ]),
    ).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      \`agent-browser\` capture metadata (one entry per call, deduped by content).

      The Instrument UI renders these screenshots inline for the user. Do NOT
      mention, summarize, or narrate them in your reply (e.g. no "I captured a
      screenshot", "the screenshot shows…", etc.).

      You MAY silently read the underlying files when you need to inspect a prior
      page state instead of re-capturing: each \`<hash>\` resolves to
      \`.state/agent-browser/<hash>.jpg\`.

      - get (no change)
      </instrument-system-note>"
    `);
  });

  it("renders failures with the error message", () => {
    expect(
      agentBrowserScreenshotsNote([
        obs({
          error: "Element not found",
          startHash: "a1b2c3",
          startUrl: "https://a.example",
          subcommand: "click #missing",
        }),
      ]),
    ).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      \`agent-browser\` capture metadata (one entry per call, deduped by content).

      The Instrument UI renders these screenshots inline for the user. Do NOT
      mention, summarize, or narrate them in your reply (e.g. no "I captured a
      screenshot", "the screenshot shows…", etc.).

      You MAY silently read the underlying files when you need to inspect a prior
      page state instead of re-capturing: each \`<hash>\` resolves to
      \`.state/agent-browser/<hash>.jpg\`.

      - click failed: Element not found
      </instrument-system-note>"
    `);
  });

  it("ignores pending items mixed in with completed ones", () => {
    expect(
      agentBrowserScreenshotsNote([
        obs({
          endHash: "a1b2c3",
          endUrl: "https://a.example",
          startHash: "000000",
          startUrl: "about:blank",
          subcommand: "navigate https://a.example",
        }),
        pending("navigate https://c"),
      ]),
    ).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      \`agent-browser\` capture metadata (one entry per call, deduped by content).

      The Instrument UI renders these screenshots inline for the user. Do NOT
      mention, summarize, or narrate them in your reply (e.g. no "I captured a
      screenshot", "the screenshot shows…", etc.).

      You MAY silently read the underlying files when you need to inspect a prior
      page state instead of re-capturing: each \`<hash>\` resolves to
      \`.state/agent-browser/<hash>.jpg\`.

      - navigate -> a1b2c3
      </instrument-system-note>"
    `);
  });

  it("caps the list at the most recent observations and notes the omission", () => {
    const items = Array.from({ length: 30 }, (_, i) =>
      obs({
        endHash: hexHash(i),
        endUrl: `https://example.com/${i}`,
        startHash: hexHash(i - 1),
        startUrl: `https://example.com/${i - 1}`,
        subcommand: `navigate https://example.com/${i}`,
      }),
    );
    expect(agentBrowserScreenshotsNote(items)).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      \`agent-browser\` capture metadata (one entry per call, deduped by content).

      The Instrument UI renders these screenshots inline for the user. Do NOT
      mention, summarize, or narrate them in your reply (e.g. no "I captured a
      screenshot", "the screenshot shows…", etc.).

      You MAY silently read the underlying files when you need to inspect a prior
      page state instead of re-capturing: each \`<hash>\` resolves to
      \`.state/agent-browser/<hash>.jpg\`.

      - ... 6 earlier call(s) omitted
      - navigate -> 000100000006
      - navigate -> 000100000007
      - navigate -> 000100000008
      - navigate -> 000100000009
      - navigate -> 00010000000a
      - navigate -> 00010000000b
      - navigate -> 00010000000c
      - navigate -> 00010000000d
      - navigate -> 00010000000e
      - navigate -> 00010000000f
      - navigate -> 000100000010
      - navigate -> 000100000011
      - navigate -> 000100000012
      - navigate -> 000100000013
      - navigate -> 000100000014
      - navigate -> 000100000015
      - navigate -> 000100000016
      - navigate -> 000100000017
      - navigate -> 000100000018
      - navigate -> 000100000019
      - navigate -> 00010000001a
      - navigate -> 00010000001b
      - navigate -> 00010000001c
      - navigate -> 00010000001d
      </instrument-system-note>"
    `);
  });
});

function hexHash(n: number): string {
  // Match what the prod hasher emits: 12 lowercase hex chars. We only need
  // determinism here, not real entropy.
  const hex = (n + 0x1_00_00_00_00).toString(16).padStart(12, "0");
  return hex.slice(-12);
}
