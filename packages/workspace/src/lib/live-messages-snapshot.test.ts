import { describe, expect, it } from "vitest";

import { type SessionMessage } from "../schemas/session/message";
import { StoreId } from "../schemas/store-id";
import { LiveMessagesSnapshot } from "./live-messages-snapshot";

const sessionId = StoreId.newSessionId();

function message(text: string): SessionMessage.WithParts {
  const messageId = StoreId.newMessageId();
  return {
    id: messageId,
    metadata: {
      createdAt: new Date("2024-01-01T10:00:00Z"),
      sessionId,
    },
    parts: [
      {
        metadata: {
          createdAt: new Date("2024-01-01T10:00:00Z"),
          id: StoreId.newPartId(),
          messageId,
          sessionId,
        },
        state: "done",
        text,
        type: "text",
      },
    ],
    role: "user",
  };
}

function texts(messages: SessionMessage.WithParts[]) {
  return messages.map((m) =>
    m.parts.map((p) => (p.type === "text" ? p.text : p.type)).join(""),
  );
}

describe("LiveMessagesSnapshot", () => {
  it("keeps messages ordered by id regardless of insertion order", () => {
    const first = message("first");
    const second = message("second");
    const third = message("third");

    // Upsert out of id order; ids are monotonic ULIDs, so first < second < third.
    const snapshot = new LiveMessagesSnapshot();
    snapshot.upsert(third);
    snapshot.upsert(first);
    snapshot.upsert(second);

    expect(texts(snapshot.toArray())).toEqual(["first", "second", "third"]);
  });

  it("replaces a message in place when upserting the same id", () => {
    const original = message("streaming...");
    const snapshot = new LiveMessagesSnapshot([original]);

    snapshot.upsert({ ...original, parts: message("streaming... done").parts });

    expect(texts(snapshot.toArray())).toEqual(["streaming... done"]);
  });

  it("drops a removed message and leaves the rest ordered", () => {
    const first = message("first");
    const second = message("second");
    const snapshot = new LiveMessagesSnapshot([first, second]);

    snapshot.remove(first.id);

    expect(texts(snapshot.toArray())).toEqual(["second"]);
  });

  it("removing an unknown id is a no-op", () => {
    const only = message("only");
    const snapshot = new LiveMessagesSnapshot([only]);

    snapshot.remove(StoreId.newMessageId());

    expect(texts(snapshot.toArray())).toEqual(["only"]);
  });

  it("reset replaces the whole contents", () => {
    const snapshot = new LiveMessagesSnapshot([message("stale")]);

    snapshot.reset([message("fresh-a"), message("fresh-b")]);

    expect(texts(snapshot.toArray())).toEqual(["fresh-a", "fresh-b"]);
  });
});
