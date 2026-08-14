import { describe, expect, it } from "vitest";

import { FolderAttachment } from "../schemas/folder-attachment";
import { AbsolutePathSchema, RelativePathSchema } from "../schemas/paths";
import { type SessionMessage } from "../schemas/session/message";
import { StoreId } from "../schemas/store-id";
import { textForMessage } from "./text-for-message";

function messageWith(text: string): SessionMessage.WithParts {
  return {
    id: StoreId.newMessageId(),
    metadata: { createdAt: new Date(), sessionId: StoreId.newSessionId() },
    parts: [
      { metadata: partMetadata(), text, type: "text" },
      {
        data: {
          files: [
            {
              filename: "photo.png",
              filePath: RelativePathSchema.parse("attachments/photo.png"),
              mimeType: "image/png",
              modifiedAt: 0,
              size: 1,
            },
          ],
          folders: [
            {
              access: "read-write",
              createdAt: 0,
              id: FolderAttachment.IdSchema.parse("Home-Downloads"),
              mountName: "Home-Downloads",
              path: AbsolutePathSchema.parse("/Users/sam/Downloads"),
              source: "user",
            },
          ],
        },
        metadata: partMetadata(),
        type: "data-attachments",
      },
    ],
    role: "user",
  };
}

function partMetadata() {
  return {
    createdAt: new Date(),
    id: StoreId.newPartId(),
    messageId: StoreId.newMessageId(),
    sessionId: StoreId.newSessionId(),
  };
}

describe("textForMessage", () => {
  it("joins the text the user wrote", () => {
    expect(textForMessage(messageWith("wat images are in here"))).toBe(
      "wat images are in here",
    );
  });

  // The attachments a message carries name real locations on the user's disk.
  // Whoever wants them asks for them where they can say why; a general-purpose
  // reader of message text must not be a route to them.
  it("says nothing about what was attached", () => {
    const text = textForMessage(messageWith("wat images are in here"));

    expect(text).not.toContain("photo.png");
    expect(text).not.toContain("Downloads");
  });
});
