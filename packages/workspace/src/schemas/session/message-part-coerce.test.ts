import { describe, expect, it } from "vitest";

import { StoreId } from "../store-id";
import { SessionMessagePart } from "./message-part";

/**
 * What a stored part becomes on the way out of the store.
 *
 * Everything here is a task outliving a schema, which is the only way these
 * shapes occur: the relaxed schema the store round-trips validates a data part's
 * `type` prefix and nothing about its payload, so whatever was written stays
 * written and turns up years later against a schema that has moved.
 */
function storedPart(type: string, data: unknown) {
  return {
    data,
    metadata: {
      createdAt: new Date(0),
      id: StoreId.newPartId(),
      messageId: StoreId.newMessageId(),
      sessionId: StoreId.newSessionId(),
    },
    type,
  };
}

describe("coercing a stored data part", () => {
  it("fills in a field added since the part was written", () => {
    // accessChanged shipped with writable folders, months after this shape was
    // the whole of the part. Reading it used to hand every consumer a payload
    // whose type promised three lists and whose value had two.
    const part = SessionMessagePart.coerce(
      storedPart("data-attachedFolderChanges", {
        removed: [{ name: "Photos", path: "/base/Photos" }],
        renamed: [],
      }),
    );

    expect(part.type).toBe("data-attachedFolderChanges");
    expect(part).toHaveProperty("data.accessChanged", []);
  });

  it("fills in an attachment's modifiedAt, added after the part was written", () => {
    // modifiedAt shipped as a cache-buster for asset URLs. Without a default,
    // every attachment a pre-2026-06-18 build stored fails its schema, the part
    // becomes data-unknown, and the transcript loses the files the user sent.
    const part = SessionMessagePart.coerce(
      storedPart("data-attachments", {
        files: [
          {
            filename: "budget.xlsx",
            filePath: "attachments/budget.xlsx",
            mimeType:
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            size: 4096,
          },
        ],
      }),
    );

    expect(part.type).toBe("data-attachments");
    expect(part).toHaveProperty("data.files.0.modifiedAt", 0);
  });

  it("keeps a type this build has no schema for, as unknown", () => {
    // data-gitCommit outlived git-based file versioning and is still sitting in
    // tasks. It used to reach the renderer, which returned the part itself.
    const part = SessionMessagePart.coerce(
      storedPart("data-gitCommit", { ref: "abc123" }),
    );

    expect(part.type).toBe("data-unknown");
    expect(part).toHaveProperty("data.originalType", "data-gitCommit");
  });

  it("keeps a payload it cannot read, as unknown", () => {
    const part = SessionMessagePart.coerce(
      storedPart("data-maxSteps", { maxStepCount: "not a number" }),
    );

    expect(part.type).toBe("data-unknown");
    expect(part).toHaveProperty("data.originalType", "data-maxSteps");
  });

  // Parts are coerced on the way out of the store and again by the rpc output
  // schema, so the repair meets its own output. A second pass that re-wrapped it
  // would report the wrapper's type instead of the one that could not be read.
  it("says the same thing when it coerces its own output", () => {
    const once = SessionMessagePart.coerce(
      storedPart("data-gitCommit", { ref: "abc123" }),
    );
    const twice = SessionMessagePart.coerce(once);

    expect(twice).toStrictEqual(once);
  });

  // setParsedStorageItem persists a schema's output, so a repair on the write
  // path would store data-unknown over whatever failed to validate. Writes still
  // go through CoercedSchema, which only checks the shape.
  it("does not repair a part on its way in to storage", () => {
    const parsed = SessionMessagePart.CoercedSchema.parse(
      storedPart("data-maxSteps", { maxStepCount: "not a number" }),
    );

    expect(parsed.type).toBe("data-maxSteps");
    expect(parsed).toHaveProperty("data.maxStepCount", "not a number");
  });

  it("leaves a part that is not a data part alone", () => {
    const part = SessionMessagePart.coerce({
      metadata: {
        createdAt: new Date(0),
        id: StoreId.newPartId(),
        messageId: StoreId.newMessageId(),
        sessionId: StoreId.newSessionId(),
      },
      state: "done",
      text: "Revenue grew.",
      type: "text",
    });

    expect(part.type).toBe("text");
  });
});
