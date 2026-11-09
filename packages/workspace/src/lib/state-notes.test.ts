import { describe, expect, it } from "vitest";

import { type SessionMessagePart } from "../schemas/session/message-part";
import { StoreId } from "../schemas/store-id";
import { SessionMessage } from "../schemas/session/message";
import { goesUnsaid, stateNotes } from "./state-notes";

const metadata = {
  createdAt: new Date(0),
  id: StoreId.newPartId(),
  messageId: StoreId.newMessageId(),
  sessionId: StoreId.newSessionId(),
};

function project(name: string | null): SessionMessagePart.DataPart {
  return {
    data: { project: name === null ? null : { name } },
    metadata,
    type: "data-project",
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
        project(null),
        project("Trips"),
        project("Trips"),
        project(null),
        project(null),
        project("Trips"),
      ].map((part) => said(part)?.split(".")[0]),
    ).toMatchInlineSnapshot(`
      [
        undefined,
        "
      <instrument-system-note>
      This chat is filed under the project "Trips"; read the chat through it",
        undefined,
        "
      <instrument-system-note>
      This chat has no project now",
        undefined,
        "
      <instrument-system-note>
      This chat is filed under the project "Trips"; read the chat through it",
      ]
    `);
  });

  it("keeps each part's picture apart", () => {
    const said = stateNotes();
    expect(said(instructions("Use metric units."))).toContain(
      "Use metric units.",
    );
    expect(said(project(null))).toBeUndefined();
    expect(said(instructions())).toContain(
      "Stop applying the previous workspace instructions.",
    );
  });

  it("starts each sequence with nothing said", () => {
    stateNotes()(project("Trips"));
    expect(stateNotes()(project("Trips"))).toBeDefined();
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
      This chat has no tabs open now.
      </instrument-system-note>"
    `);
  });
});

describe("goesUnsaid", () => {
  const message = (
    part: SessionMessagePart.DataPart | undefined,
  ): SessionMessage.WithParts => ({
    id: StoreId.newMessageId(),
    metadata: { createdAt: new Date(0), sessionId: metadata.sessionId },
    parts: part ? [part] : [],
    role: "user",
  });

  /** Each part, or nothing where a writer may leave it off. */
  function written(parts: SessionMessagePart.DataPart[]) {
    const history: SessionMessage.WithParts[] = [];
    return parts.map((part) => {
      const kept = goesUnsaid(part, history) ? undefined : part;
      history.push(message(kept));
      return kept;
    });
  }

  function said(parts: (SessionMessagePart.DataPart | undefined)[]) {
    const note = stateNotes();
    return parts.map((part) => part && note(part));
  }

  it.each([
    [[project(null), project(null), instructions(), instructions()]],
    [[project(null), project("Trips"), project(null), project(null)]],
    [[instructions(), instructions("Use metric units."), instructions()]],
    [
      [
        project("Trips"),
        instructions(),
        project(null),
        instructions("Be brief."),
      ],
    ],
  ])(
    "leaves off only parts that say nothing in the history or any stretch of it",
    (parts) => {
      const kept = written(parts);
      for (let start = 0; start < parts.length; start++) {
        expect(said(kept.slice(start))).toEqual(said(parts.slice(start)));
      }
    },
  );

  it("sends the same model request with the parts left off", async () => {
    const parts = [
      project(null),
      instructions(),
      project("Trips"),
      instructions("Use metric units."),
      project(null),
      instructions(),
    ];
    const ids = parts.map(() => StoreId.newMessageId());
    const turns = (stated: (SessionMessagePart.DataPart | undefined)[]) =>
      stated.map((part, index): SessionMessage.WithParts => {
        const turn = message(part);
        turn.parts.unshift({
          metadata: { ...metadata, id: StoreId.newPartId() },
          text: `Message ${index}`,
          type: "text",
        });
        return { ...turn, id: ids[index] ?? turn.id };
      });
    const request = async (messages: SessionMessage.WithParts[]) =>
      JSON.stringify(await SessionMessage.toModelMessages(messages, {}));
    const all = turns(parts);
    const kept = turns(written(parts));
    for (let start = 0; start < parts.length; start++) {
      expect(await request(kept.slice(start))).toBe(
        await request(all.slice(start)),
      );
    }
  });

  it("leaves off an empty picture until the session had something in it", () => {
    expect(
      written([
        project(null),
        instructions(),
        project("Trips"),
        project(null),
        instructions(),
      ]).map((part) => part !== undefined),
    ).toEqual([false, false, true, true, false]);
  });

  it("keeps a picture with something in it, and one never empty", () => {
    expect(goesUnsaid(project("Trips"), [])).toBe(false);
    expect(
      goesUnsaid(
        { data: { screen: "browser" }, metadata, type: "data-viewContext" },
        [],
      ),
    ).toBe(false);
  });
});
