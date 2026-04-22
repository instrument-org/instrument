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
            path: `tool-results/agent-browser-${endHash}.jpg`,
            url: endUrl,
          },
        }
      : {}),
    ...(error ? { error } : {}),
    id: StoreId.newPartContextItemId(),
    kind: "agent-browser-command",
    startScreenshot: {
      path: `tool-results/agent-browser-${startHash}.jpg`,
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
      path: "tool-results/agent-browser-aaa.jpg",
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
      agent-browser screenshots (written after each call, one per call, deduped by content; full path is \`tool-results/agent-browser<suffix>\`):
      - navigate -> -b1c2d3.jpg
      - click -> -e4f5a6.jpg
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
      agent-browser screenshots (written after each call, one per call, deduped by content; full path is \`tool-results/agent-browser<suffix>\`):
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
      agent-browser screenshots (written after each call, one per call, deduped by content; full path is \`tool-results/agent-browser<suffix>\`):
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
      agent-browser screenshots (written after each call, one per call, deduped by content; full path is \`tool-results/agent-browser<suffix>\`):
      - navigate -> -a1b2c3.jpg
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
      agent-browser screenshots (written after each call, one per call, deduped by content; full path is \`tool-results/agent-browser<suffix>\`):
      - ... 6 earlier call(s) omitted
      - navigate -> -000100000006.jpg
      - navigate -> -000100000007.jpg
      - navigate -> -000100000008.jpg
      - navigate -> -000100000009.jpg
      - navigate -> -00010000000a.jpg
      - navigate -> -00010000000b.jpg
      - navigate -> -00010000000c.jpg
      - navigate -> -00010000000d.jpg
      - navigate -> -00010000000e.jpg
      - navigate -> -00010000000f.jpg
      - navigate -> -000100000010.jpg
      - navigate -> -000100000011.jpg
      - navigate -> -000100000012.jpg
      - navigate -> -000100000013.jpg
      - navigate -> -000100000014.jpg
      - navigate -> -000100000015.jpg
      - navigate -> -000100000016.jpg
      - navigate -> -000100000017.jpg
      - navigate -> -000100000018.jpg
      - navigate -> -000100000019.jpg
      - navigate -> -00010000001a.jpg
      - navigate -> -00010000001b.jpg
      - navigate -> -00010000001c.jpg
      - navigate -> -00010000001d.jpg
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
