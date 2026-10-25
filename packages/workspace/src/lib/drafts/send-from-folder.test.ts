import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AbsolutePathSchema } from "../../schemas/paths";
import { type DraftFile } from "./draft-file";
import { ensureDraftFolder } from "./draft-folder";
import { removeSentFromDraft, withDraftFolder } from "./send-from-folder";

let rootDir: string;

beforeEach(() => {
  rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "drafts-send-folder-"));
});

afterEach(() => {
  fs.rmSync(rootDir, { force: true, recursive: true });
});

function made(more: Partial<DraftFile> = {}) {
  const created = new Date("2026-10-14T18:22:04.000Z");
  return ensureDraftFolder({
    draft: { created, id: "d1", updated: created, words: "Look", ...more },
    rootDir,
    timeZone: "UTC",
  });
}

describe("a message sent from a draft", () => {
  it("carries a file that landed in the folder after the window last heard of it", () => {
    const { dir } = made();
    const seen = path.join(dir, "seen.pdf");
    fs.writeFileSync(seen, "%PDF");
    // What the window hands over: only what it had heard of.
    const given = [
      {
        filename: "seen.pdf",
        mimeType: "application/pdf",
        path: AbsolutePathSchema.parse(seen),
        size: 4,
      },
    ];
    // Lands a beat before the press, before the watcher told any window.
    fs.writeFileSync(path.join(dir, "late.png"), "png");
    fs.mkdirSync(path.join(dir, "Photos"));
    fs.writeFileSync(path.join(dir, ".DS_Store"), "");

    const sending = withDraftFolder({ files: given, fromDraft: "d1", rootDir });

    expect(
      sending.files.map((file) => ("path" in file ? file.filename : "")),
    ).toEqual(["seen.pdf", "late.png"]);
    expect(sending.files[1]).toMatchObject({ mimeType: "image/png", size: 3 });
    expect(sending.folders).toEqual([{ path: path.join(dir, "Photos") }]);
    expect(sending.sent.map((at) => path.basename(at)).toSorted()).toEqual([
      "Photos",
      "late.png",
      "seen.pdf",
    ]);
  });

  it("sends a paste the window sends as bytes once, under its name in the folder", () => {
    const { dir } = made();
    fs.writeFileSync(path.join(dir, "image.png"), "png");
    const sending = withDraftFolder({
      files: [{ content: "cG5n", filename: "image.png" }],
      fromDraft: "d1",
      rootDir,
    });
    expect(sending.files).toEqual([{ content: "cG5n", filename: "image.png" }]);
    expect(sending.sent).toEqual([path.join(dir, "image.png")]);
  });

  it("is what the window handed over where there is no draft", () => {
    expect(
      withDraftFolder({
        folders: [{ path: "/x" }],
        fromDraft: "gone",
        rootDir,
      }),
    ).toEqual({ files: [], folders: [{ path: "/x" }], sent: [] });
    expect(withDraftFolder({ fromDraft: undefined, rootDir }).sent).toEqual([]);
  });

  it("takes out what it sent once the message is written, and leaves what came after", () => {
    const { dir, file } = made();
    fs.writeFileSync(path.join(dir, "sent.png"), "png");
    fs.mkdirSync(path.join(dir, "Photos"));
    fs.writeFileSync(path.join(dir, "Photos", "a.jpg"), "jpg");
    const { sent } = withDraftFolder({ fromDraft: "d1", rootDir });
    fs.writeFileSync(path.join(dir, "after.png"), "png");

    removeSentFromDraft(sent);

    expect(fs.readdirSync(dir).toSorted()).toEqual([
      path.basename(file),
      "after.png",
    ]);
  });
});
