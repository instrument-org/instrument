import { describe, expect, it } from "vitest";

import { type SessionMessagePart } from "../schemas/session/message-part";
import { StoreId } from "../schemas/store-id";
import { stateNotes } from "./state-notes";

const metadata = {
  createdAt: new Date(0),
  id: StoreId.newPartId(),
  messageId: StoreId.newMessageId(),
  sessionId: StoreId.newSessionId(),
};

function topic(name: string | null): SessionMessagePart.DataPart {
  return {
    data: { topic: name === null ? null : { name } },
    metadata,
    type: "data-topic",
  };
}

function instructions(text?: string): SessionMessagePart.DataPart {
  return {
    data: { file: "AGENTS.md", ...(text ? { instructions: text } : {}) },
    metadata,
    type: "data-workspaceInstructions",
  };
}

describe("stateNotes", () => {
  it("says a picture once, says an empty one only after something was said, and says it once", () => {
    const said = stateNotes();
    expect(
      [
        topic(null),
        topic("Trips"),
        topic("Trips"),
        topic(null),
        topic(null),
        topic("Trips"),
      ].map((part) => said(part)?.split(".")[0]),
    ).toMatchInlineSnapshot(`
      [
        undefined,
        "
      <instrument-system-note>
      This chat is filed under the topic "Trips"",
        undefined,
        "
      <instrument-system-note>
      This chat has no topic now",
        undefined,
        "
      <instrument-system-note>
      This chat is filed under the topic "Trips"",
      ]
    `);
  });

  it("keeps each part's picture apart", () => {
    const said = stateNotes();
    expect(said(instructions("Use metric units."))).toContain(
      "Use metric units.",
    );
    expect(said(topic(null))).toBeUndefined();
    expect(said(instructions())).toContain(
      "Stop applying the previous workspace instructions.",
    );
  });

  it("starts each sequence with nothing said", () => {
    stateNotes()(topic("Trips"));
    expect(stateNotes()(topic("Trips"))).toBeDefined();
  });

  it("says nothing of a part that is not a picture", () => {
    expect(
      stateNotes()({
        data: { text: "Book it." },
        metadata,
        type: "data-intent",
      }),
    ).toBeUndefined();
  });

  it("tells a task its tabs are gone after it held some", () => {
    const said = stateNotes();
    const tabs = (
      held: { id: string; openedBy: "task"; url: string }[],
    ): SessionMessagePart.DataPart => ({
      data: { status: "tabs", tabs: held },
      metadata,
      type: "data-browserStatus",
    });
    expect(said(tabs([]))).toBeUndefined();
    expect(
      said(tabs([{ id: "t1", openedBy: "task", url: "https://example.com" }])),
    ).toContain("t1 at https://example.com");
    expect(said(tabs([]))).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      Your browser has no tabs of the user's chat now.
      </instrument-system-note>"
    `);
  });
});
