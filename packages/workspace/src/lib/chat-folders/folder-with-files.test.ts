import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { hasFilesBesideChatFile } from "./folder-with-files";

describe("hasFilesBesideChatFile", () => {
  let folder: string;
  beforeEach(async () => {
    folder = await fs.mkdtemp(path.join(os.tmpdir(), "chat-folder-"));
  });
  afterEach(async () => {
    await fs.rm(folder, { force: true, recursive: true });
  });

  it.each([
    { names: [], has: false },
    { names: ["CHAT.md"], has: false },
    { names: ["CHAT.md", ".DS_Store", ".tmp/", "~$draft.docx"], has: false },
    { names: ["CHAT.md", "pricing-comparison.html"], has: true },
    { names: ["attachments/"], has: true },
  ])("$names → $has", async ({ names, has }) => {
    for (const name of names) {
      await (name.endsWith("/")
        ? fs.mkdir(path.join(folder, name))
        : fs.writeFile(path.join(folder, name), ""));
    }
    expect(await hasFilesBesideChatFile(folder)).toBe(has);
  });

  it("answers false for a folder not made yet", async () => {
    expect(await hasFilesBesideChatFile(path.join(folder, "missing"))).toBe(
      false,
    );
  });
});
