import fs from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { SessionMessagePart } from "../../schemas/session/message-part";
import { withTempDir } from "../../test/helpers/temp-dir";
import { blobPath, writeBlob } from "./blobs";
import {
  type LoadBlob,
  partFromRecord,
  partToRecord,
  type SaveBlob,
} from "./part-blobs";
import { at, messageId, partId, sessionId, textPart } from "./test-records";

const dir = withTempDir("records-part-blobs");

const IMAGE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3, 250, 251]);

const save: SaveBlob = (bytes, mediaType) =>
  writeBlob(dir.path, bytes, mediaType);
const load: LoadBlob = (name) => fs.readFile(blobPath(dir.path, name));

describe("partToRecord", () => {
  it("moves an image a tool read into a blob and back", async () => {
    const part = readFilePart({
      base64Data: IMAGE.toString("base64"),
      filePath: "/a.png",
      mimeType: "image/png",
      modifiedAt: 1,
      state: "image",
    });

    const record = await partToRecord(part, save);

    expect(record).toMatchObject({
      output: {
        blob: expect.stringMatching(/^sha256-[0-9a-f]{64}\.png$/),
        bytes: IMAGE.length,
        filePath: "/a.png",
        mediaType: "image/png",
        mimeType: "image/png",
      },
    });
    expect(JSON.stringify(record)).not.toContain("base64Data");
    await expect(partFromRecord(record, load)).resolves.toEqual(part);
  });

  it("finds bytes anywhere in the output", async () => {
    const part = readFilePart({
      pages: [{ base64Data: IMAGE.toString("base64"), mimeType: "image/png" }],
    });

    const record = await partToRecord(part, save);

    expect(JSON.stringify(record)).not.toContain("base64Data");
    await expect(partFromRecord(record, load)).resolves.toEqual(part);
  });

  it.each([
    [
      "an object with a media type of its own",
      { base64Data: IMAGE.toString("base64"), mediaType: "image/png" },
    ],
    ["base64 Node would not write", { base64Data: "iVBOR w0K" }],
  ])("keeps bytes inline in %s", async (_name, output) => {
    const part = readFilePart(output);

    await expect(partToRecord(part, save)).resolves.toBe(part);
  });

  it("leaves a part with no output as it is", async () => {
    const part = textPart(sessionId(1), messageId(1), partId(1), "hi", at(1));

    await expect(partToRecord(part, save)).resolves.toBe(part);
    await expect(partFromRecord(part, load)).resolves.toBe(part);
  });
});

function readFilePart(output: unknown): SessionMessagePart.Type {
  return SessionMessagePart.coerce({
    input: { filePath: "/a.png" },
    metadata: {
      createdAt: at(1),
      id: partId(1),
      messageId: messageId(1),
      sessionId: sessionId(1),
    },
    output,
    state: "output-available",
    toolCallId: "call-1",
    type: "tool-read_file",
  });
}
