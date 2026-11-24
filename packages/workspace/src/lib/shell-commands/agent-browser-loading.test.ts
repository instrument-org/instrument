import { describe, expect, it } from "vitest";

import { needsLoadedDocument } from "./agent-browser-loading";

describe("needsLoadedDocument", () => {
  it.each([
    [["eval", "document.body.innerText"]],
    [["click", "@e1410"]],
    [["select", "@e280", "2025"]],
    [["snapshot", "-i", "-c"]],
    [["read"]],
    [["get", "text", "body"]],
    [["get", "count", "button"]],
    [["is", "visible", "#save"]],
    [["find", "text", "Save", "click"]],
    [["fill", "@e3", "Ada"]],
    [["press", "Enter"]],
    [["screenshot"]],
    [["--json", "eval", "1"]],
    [["--session", "s1", "snapshot"]],
  ])("waits for a loading document before %j", (args) => {
    expect(needsLoadedDocument(args)).toBe(true);
  });

  it.each([
    // They load a page and wait for it themselves.
    [["open", "https://example.com"]],
    [["back"]],
    [["reload"]],
    // The agent's own waiting.
    [["wait", "--text", "Refund"]],
    [["wait", "2000"]],
    // Right in a document that is still loading.
    [["get", "url"]],
    [["get", "title"]],
    [["get"]],
    // No document to wait for.
    [["tab", "list"]],
    [["dialog", "accept"]],
    [["close"]],
    [["--version"]],
    [[]],
  ])("runs %j at once", (args) => {
    expect(needsLoadedDocument(args)).toBe(false);
  });
});
