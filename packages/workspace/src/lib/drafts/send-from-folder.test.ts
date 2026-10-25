import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AbsolutePathSchema } from "../../schemas/paths";
import { type DraftFile } from "./draft-file";
import { ensureDraftFolder, writeDraftFile } from "./draft-folder";
import {
  removeSentFromDraft,
  type SentFromDraft,
  withDraftFolder,
} from "./send-from-folder";

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

/** What a manifest names, by each entry's path inside `dir`. */
const named = (dir: string, sent: SentFromDraft) => ({
  files: sent.files.map((at) => relativeOf(dir, at)).toSorted(),
  folders: sent.folders.map((at) => relativeOf(dir, at)),
});

/** A path inside `dir` with `/` between its names, whichever way this computer writes one. */
const relativeOf = (dir: string, at: string) =>
  path.relative(dir, at).split(path.sep).join("/");

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
    fs.writeFileSync(path.join(dir, "Photos", "a.jpg"), "jpg");
    fs.writeFileSync(path.join(dir, ".DS_Store"), "");

    const sending = withDraftFolder({ files: given, fromDraft: "d1", rootDir });

    expect(
      sending.files.map((file) => ("path" in file ? file.filename : "")),
    ).toEqual(["late.png", "seen.pdf"]);
    expect(sending.files[0]).toMatchObject({ mimeType: "image/png", size: 3 });
    expect(sending.folders).toEqual([{ path: path.join(dir, "Photos") }]);
    expect(named(dir, sending.sent)).toEqual({
      files: ["Photos/a.jpg", "late.png", "seen.pdf"],
      folders: ["Photos"],
    });
  });

  it("counts a paste the window sends as bytes once, by its bytes", () => {
    const { dir } = made();
    fs.writeFileSync(path.join(dir, "image 2.png"), "png");
    const sending = withDraftFolder({
      files: [{ content: "cG5n", filename: "image.png" }],
      fromDraft: "d1",
      rootDir,
    });
    expect(sending.files).toEqual([{ content: "cG5n", filename: "image.png" }]);
    expect(named(dir, sending.sent).files).toEqual(["image 2.png"]);
  });

  it("still sends a dropped file that only shares a paste's name", () => {
    const { dir } = made();
    fs.writeFileSync(path.join(dir, "image.png"), "a different picture");
    const sending = withDraftFolder({
      files: [{ content: "cG5n", filename: "image.png" }],
      fromDraft: "d1",
      rootDir,
    });
    expect(
      sending.files.map((file) => ("path" in file ? file.path : "bytes")),
    ).toEqual(["bytes", path.join(dir, "image.png")]);
    expect(named(dir, sending.sent).files).toEqual(["image.png"]);
  });

  it("sends a file another draft in a shared folder names, and leaves it for that draft", () => {
    const { dir, file } = made();
    const shared = path.join(dir, "receipt.pdf");
    fs.writeFileSync(shared, "%PDF");
    const real = fs.realpathSync(shared);
    writeDraftFile(file, { ...made().draft, context: ["receipt.pdf"] });
    writeDraftFile(path.join(dir, "DRAFT 2.md"), {
      ...made().draft,
      context: ["receipt.pdf"],
      id: "d2",
    });

    const sending = withDraftFolder({ fromDraft: "d1", rootDir });
    removeSentFromDraft(sending.sent);

    expect(sending.files).toMatchObject([{ path: real }]);
    expect(fs.existsSync(shared)).toBe(true);
  });

  it("sends a file in the folder as it is now, not as the window last saw it, and not at all once it left", () => {
    const { dir } = made();
    const edited = path.join(dir, "notes.txt");
    fs.writeFileSync(edited, "longer than it was");
    const stale = (at: string) => ({
      filename: path.basename(at),
      mimeType: "text/plain",
      path: AbsolutePathSchema.parse(at),
      size: 2,
    });

    const sending = withDraftFolder({
      files: [stale(edited), stale(path.join(dir, "gone.txt"))],
      fromDraft: "d1",
      rootDir,
    });

    expect(sending.files).toEqual([
      {
        filename: "notes.txt",
        mimeType: "text/plain",
        path: edited,
        size: 18,
      },
    ]);
  });

  it("is what the window handed over where there is no draft", () => {
    expect(
      withDraftFolder({
        folders: [{ path: "/x" }],
        fromDraft: "gone",
        rootDir,
      }),
    ).toEqual({
      files: [],
      folders: [{ path: "/x" }],
      sent: { files: [], folders: [] },
    });
  });

  it("takes out only what it read, inside a folder it sent too, and leaves what came after", () => {
    const { dir, file } = made();
    fs.writeFileSync(path.join(dir, "sent.png"), "png");
    fs.mkdirSync(path.join(dir, "Photos", "Trip"), { recursive: true });
    fs.writeFileSync(path.join(dir, "Photos", "Trip", "a.jpg"), "jpg");
    const { sent } = withDraftFolder({ fromDraft: "d1", rootDir });
    fs.writeFileSync(path.join(dir, "after.png"), "png");
    fs.writeFileSync(path.join(dir, "Photos", "Trip", "late.jpg"), "jpg");

    expect(removeSentFromDraft(sent)).toEqual([]);

    expect(fs.readdirSync(dir).toSorted()).toEqual([
      path.basename(file),
      "Photos",
      "after.png",
    ]);
    expect(fs.readdirSync(path.join(dir, "Photos", "Trip"))).toEqual([
      "late.jpg",
    ]);
  });
});
