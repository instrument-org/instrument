import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { computerFileTitles, markdownTitle } from "./computer-titles";

describe("markdownTitle", () => {
  it.each([
    ['---\ntitle: "From front matter"\n---\n# Heading', "From front matter"],
    [
      "---\ndate: 2026-10-27\n---\n\n## The **first** heading ##",
      "The first heading",
    ],
    ["Some words\n\n# Later heading", "Later heading"],
    ["#hashtag is not a heading", null],
  ])("%j reads as %j", (markdown, title) => {
    expect(markdownTitle(markdown)).toBe(title);
  });
});

describe("computerFileTitles", () => {
  let folder: string;
  beforeEach(async () => {
    folder = await fs.mkdtemp(path.join(os.tmpdir(), "titles-"));
  });
  afterEach(async () => {
    await fs.rm(folder, { force: true, recursive: true });
  });

  it("reads pages and Markdown, and leaves out files with no title", async () => {
    const page = path.join(folder, "a.html");
    const notes = path.join(folder, "b.md");
    const data = path.join(folder, "c.csv");
    const untitled = path.join(folder, "d.html");
    await fs.writeFile(page, "<title>A page</title>");
    await fs.writeFile(notes, "# Notes");
    await fs.writeFile(data, "# not read");
    await fs.writeFile(untitled, "<p>hi</p>");
    expect(
      await computerFileTitles([
        page,
        notes,
        data,
        untitled,
        path.join(folder, "gone.md"),
      ]),
    ).toEqual({ [notes]: "Notes", [page]: "A page" });
  });

  it("finds a title behind a long inline script", async () => {
    const page = path.join(folder, "a.html");
    await fs.writeFile(
      page,
      `<head><script>${"x".repeat(60_000)}</script><title>Late</title>`,
    );
    expect(await computerFileTitles([page])).toEqual({ [page]: "Late" });
  });

  it("reads a file again once it is written", async () => {
    const page = path.join(folder, "a.html");
    await fs.writeFile(page, "<title>First</title>");
    expect(await computerFileTitles([page])).toEqual({ [page]: "First" });
    await fs.writeFile(page, "<title>Second, longer</title>");
    expect(await computerFileTitles([page])).toEqual({
      [page]: "Second, longer",
    });
  });
});
