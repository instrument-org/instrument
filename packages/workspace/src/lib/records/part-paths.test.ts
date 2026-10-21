import { describe, expect, it } from "vitest";

import { type SessionMessagePart } from "../../schemas/session/message-part";
import { localPart, portablePart } from "./part-paths";
import { at, messageId, partId, sessionId } from "./test-records";

const metadata = {
  createdAt: at(1),
  id: partId(1),
  messageId: messageId(1),
  sessionId: sessionId(1),
};

function chosen(path: string, mount?: string): SessionMessagePart.Type {
  return {
    data: {
      chosen: [
        { kind: "file", name: "plan.md", path, ...(mount && { mount }) },
      ],
      screen: "chat",
    },
    metadata,
    type: "data-viewContext",
  };
}

describe("part paths", () => {
  it.each([
    [
      "a Mac's workspace",
      "/Users/sam/Instrument",
      "/Users/sam/Instrument/Chats/Plan/plan.md",
    ],
    [
      "a Windows workspace",
      "C:\\Users\\sam\\Instrument",
      "C:\\Users\\sam\\Instrument\\Chats\\Plan\\plan.md",
    ],
  ])("keep a file in %s by its place there", (_, root, host) => {
    const kept = portablePart(chosen(host, host), root);

    expect(kept).toEqual(
      chosen("workspace:/Chats/Plan/plan.md", "workspace:/Chats/Plan/plan.md"),
    );
    expect(localPart(kept, root)).toEqual(chosen(host, host));
  });

  it("keeps a file outside the workspace at its own path", () => {
    const part = chosen("/Users/sam/Desktop/plan.md");

    expect(portablePart(part, "/Users/sam/Instrument")).toBe(part);
  });

  // A part an earlier build wrote reads as it was written.
  it("reads a part with no workspace paths as it is", () => {
    const part = chosen("/Users/sam/Instrument/plan.md");

    expect(localPart(part, "/home/sam/work")).toBe(part);
  });
});
