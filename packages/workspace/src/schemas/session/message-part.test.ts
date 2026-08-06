import { describe, expect, it } from "vitest";

import { StoreId } from "../store-id";
import { SessionMessagePart } from "./message-part";
import { type SessionMessageRelaxedPart } from "./message-relaxed-part";

function storedAttachmentsPart(
  folder: Record<string, unknown>,
): SessionMessageRelaxedPart.Type {
  return {
    data: { files: [], folders: [folder] },
    metadata: {
      createdAt: new Date(),
      id: StoreId.newPartId(),
      messageId: StoreId.newMessageId(),
      sessionId: StoreId.newSessionId(),
    },
    type: "data-attachments",
  };
}

const LEGACY_FOLDER = {
  access: "read-write",
  createdAt: 1_718_198_400_000,
  id: "01KZ9NPNZZPQF80Z7A7DG4Z5BN",
  name: "Home-Downloads",
  path: "/Users/sam/Downloads",
  source: "user",
};

function foldersOf(part: SessionMessagePart.Type): Record<string, unknown>[] {
  if (part.type !== "data-attachments") {
    throw new Error("expected an attachments part");
  }
  // The part's own types promise the current shape; this asserts what is
  // actually there, which is the whole point of the test.
  return part.data.folders as unknown as Record<string, unknown>[];
}

describe("SessionMessagePart.coerce", () => {
  // A stored part is never validated -- `data` is typed `unknown` and the
  // coercion is a cast -- so the tolerance in FolderAttachment.StoredSchema
  // never runs on history and has to be applied here instead.
  it("renames a folder attached before the mount name said what it was", () => {
    const part = SessionMessagePart.coerce(
      storedAttachmentsPart(LEGACY_FOLDER),
    );

    expect(foldersOf(part)[0]?.mountName).toBe("Home-Downloads");
  });

  it("leaves no trace of the old field for a reader to pick up", () => {
    const part = SessionMessagePart.coerce(
      storedAttachmentsPart(LEGACY_FOLDER),
    );

    expect(foldersOf(part)[0]).not.toHaveProperty("name");
  });

  it("passes a folder already carrying the current field through", () => {
    const { name, ...current } = LEGACY_FOLDER;
    const part = SessionMessagePart.coerce(
      storedAttachmentsPart({ ...current, mountName: name }),
    );

    expect(foldersOf(part)[0]?.mountName).toBe("Home-Downloads");
  });

  it("keeps the rest of the attachments part intact", () => {
    const part = SessionMessagePart.coerce(
      storedAttachmentsPart(LEGACY_FOLDER),
    );

    expect(foldersOf(part)[0]).toMatchObject({
      access: "read-write",
      path: "/Users/sam/Downloads",
      source: "user",
    });
  });

  it("leaves parts that carry no folders alone", () => {
    const part = SessionMessagePart.coerce({
      metadata: {
        createdAt: new Date(),
        id: StoreId.newPartId(),
        messageId: StoreId.newMessageId(),
        sessionId: StoreId.newSessionId(),
      },
      text: "hello",
      type: "text",
    });

    expect(part.type).toBe("text");
  });
});
