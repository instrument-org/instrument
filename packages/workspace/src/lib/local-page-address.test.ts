import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { FolderAttachment } from "../schemas/folder-attachment";
import { AbsolutePathSchema, TaskDirSchema } from "../schemas/paths";
import {
  agentPathOfFileUrl,
  agentSpellingOfFileUrls,
  fileUrlOfHostPath,
  isLocalAddress,
} from "./local-page-address";
import { buildWorkspaceFsLayout } from "./workspace-fs-layout";

function layoutFor(taskRoot: string, docsRoot: string) {
  return buildWorkspaceFsLayout({
    attachedFolders: {
      docs: {
        access: "read-only",
        createdAt: 0,
        id: FolderAttachment.IdSchema.parse("docs"),
        mountName: "Docs",
        path: AbsolutePathSchema.parse(docsRoot),
        source: "user",
      },
    },
    taskHostRoot: TaskDirSchema.parse(taskRoot),
  });
}

describe("agentSpellingOfFileUrls", () => {
  const layout = layoutFor("/Users/me/Tasks/t1", "/Users/me/My Docs");

  it("spells each mount's addresses in the agent's paths", () => {
    expect(
      agentSpellingOfFileUrls(
        [
          "✓ Report",
          "  file:///Users/me/Tasks/t1/work/report.html#top",
          "  file:///Users/me/My%20Docs/page.html",
          "  file:///Users/me/Tasks/t1",
        ].join("\n"),
        layout,
      ),
    ).toMatchInlineSnapshot(`
      "✓ Report
        file:///task/work/report.html#top
        file:///mnt/Docs/page.html
        file:///task"
    `);
  });

  it("leaves out the parameter a page in Edit is loaded with", () => {
    expect(
      agentSpellingOfFileUrls(
        "file:///Users/me/Tasks/t1/work/page.html?instrument-edit=abc#top",
        layout,
      ),
    ).toBe("file:///task/work/page.html#top");
  });

  it("names a file outside every mount without its place on the computer", () => {
    expect(
      agentSpellingOfFileUrls(
        "origin=file:///Users/me/Tasks/t10/work/report.html ---",
        layout,
      ),
    ).toBe("origin=file://<a file outside your folders> ---");
  });
});

describe("agentPathOfFileUrl", () => {
  let root: string;
  let layout: ReturnType<typeof layoutFor>;

  beforeAll(async () => {
    root = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), "local-page-")),
    );
    await fs.mkdir(path.join(root, "task/work"), { recursive: true });
    await fs.mkdir(path.join(root, "task/.instrument"), { recursive: true });
    await fs.mkdir(path.join(root, "docs"), { recursive: true });
    await fs.mkdir(path.join(root, "elsewhere"), { recursive: true });
    await fs.writeFile(path.join(root, "task/work/page.html"), "");
    await fs.writeFile(path.join(root, "elsewhere/secret.txt"), "");
    await fs.symlink(
      path.join(root, "elsewhere"),
      path.join(root, "task/work/leak"),
    );
    layout = layoutFor(path.join(root, "task"), path.join(root, "docs"));
  });

  afterAll(async () => {
    await fs.rm(root, { force: true, recursive: true });
  });

  it.each([
    { expected: "/task/work/page.html", file: "task/work/page.html" },
    { expected: "/mnt/Docs/page.html", file: "docs/page.html" },
    { expected: null, file: "elsewhere/secret.txt" },
    { expected: null, file: "task/.instrument/task.db" },
    { expected: null, file: "task/work/leak/secret.txt" },
  ])("$file → $expected", ({ expected, file }) => {
    expect(
      agentPathOfFileUrl(layout, fileUrlOfHostPath(path.join(root, file))),
    ).toBe(expected);
  });

  it("finds a mount whose root is spelled through a symlink", async () => {
    const linkedRoot = path.join(root, "linked-task");
    await fs.symlink(path.join(root, "task"), linkedRoot);
    const linked = layoutFor(linkedRoot, path.join(root, "docs"));
    expect(
      agentPathOfFileUrl(
        linked,
        fileUrlOfHostPath(path.join(root, "task/work/page.html")),
      ),
    ).toBe("/task/work/page.html");
  });

  it("refuses an address that is not a file", () => {
    expect(agentPathOfFileUrl(layout, "https://example.com/")).toBeNull();
  });
});

describe("isLocalAddress", () => {
  it.each([
    ["file:///a/b.html", true],
    [" file:///a/b.html", true],
    ["file\n:///a/b.html", true],
    ["view-source:file:///a/b.html", true],
    ["https://example.com/", false],
    ["view-source:https://example.com/", false],
    ["not a url", false],
  ])("%j → %s", (url, expected) => {
    expect(isLocalAddress(url)).toBe(expected);
  });
});
