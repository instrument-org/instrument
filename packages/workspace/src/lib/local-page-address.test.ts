import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MountedFolder } from "../schemas/mounted-folder";
import {
  AbsolutePathSchema,
  ChatDirSchema,
  WorkDirSchema,
} from "../schemas/paths";
import {
  agentPathOfFileUrl,
  agentSpellingOfFileUrls,
  fileUrlOfHostPath,
  isLocalAddress,
} from "./local-page-address";
import { getWorkspaceConfig } from "./workspace-config";
import { workspaceLayout } from "./workspace-layout";
import { buildWorkspaceFsLayout, shellPath } from "./workspace-fs-layout";

function layoutFor(chatRoot: string, docsRoot: string, recordRoot?: string) {
  return buildWorkspaceFsLayout({
    folders: {
      docs: {
        access: "read-only",
        id: MountedFolder.IdSchema.parse("docs"),
        path: AbsolutePathSchema.parse(docsRoot),
      },
    },
    chatHostRoot: WorkDirSchema.parse(chatRoot),
    ...(recordRoot && { recordHostRoot: ChatDirSchema.parse(recordRoot) }),
  });
}

describe("agentSpellingOfFileUrls", () => {
  // The folders as this computer spells them (`C:\Users\me\...` on
  // Windows), which the browser's addresses carry, and the agent's spelling
  // of the same addresses, which differs there (`file:///c/Users/me/...`).
  const task = path.resolve("/Users/me/Tasks/t1");
  const docs = path.resolve("/Users/me/My Docs");
  const layout = layoutFor(task, docs);
  const hostUrl = (root: string, rest = "") =>
    `${pathToFileURL(root).href}${rest}`;
  const agentUrl = (root: string, rest = "") =>
    `file://${shellPath(root)}${rest}`;

  it("spells each mount's addresses in the agent's paths", () => {
    expect(
      agentSpellingOfFileUrls(
        [
          "✓ Report",
          `  ${hostUrl(task, "/work/report.html#top")}`,
          `  ${hostUrl(docs, "/page.html")}`,
          `  ${hostUrl(task)}`,
        ].join("\n"),
        layout,
      ),
    ).toBe(
      [
        "✓ Report",
        `  ${agentUrl(task, "/work/report.html#top")}`,
        `  ${agentUrl(docs, "/page.html")}`,
        `  ${agentUrl(task)}`,
      ].join("\n"),
    );
  });

  it("leaves out the parameter a page in Edit is loaded with", () => {
    expect(
      agentSpellingOfFileUrls(
        hostUrl(task, "/work/page.html?instrument-edit=abc#top"),
        layout,
      ),
    ).toBe(agentUrl(task, "/work/page.html#top"));
  });

  it("names a file outside every mount without its place on the computer", () => {
    expect(
      agentSpellingOfFileUrls(
        `origin=${hostUrl(path.resolve("/Users/me/Tasks/t10"), "/work/report.html")} ---`,
        layout,
      ),
    ).toBe("origin=file://<a file outside your folders> ---");
  });
});

describe("agentPathOfFileUrl", () => {
  let root: string;
  // The chat's record folder, in the workspace, which the rules keep hidden
  // but for what the person sent.
  let record: string;
  let layout: ReturnType<typeof layoutFor>;

  beforeAll(async () => {
    root = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), "local-page-")),
    );
    await fs.mkdir(path.join(root, "task/work"), { recursive: true });
    record = path.join(
      workspaceLayout(getWorkspaceConfig().rootDir).chatsDir,
      path.basename(root),
    );
    await fs.mkdir(path.join(record, "attachments"), { recursive: true });
    await fs.writeFile(path.join(record, "attachments/sent.html"), "");
    await fs.writeFile(path.join(record, "chat.db"), "");
    await fs.mkdir(path.join(root, "docs"), { recursive: true });
    await fs.mkdir(path.join(root, "elsewhere"), { recursive: true });
    await fs.writeFile(path.join(root, "task/work/page.html"), "");
    await fs.writeFile(path.join(root, "elsewhere/secret.txt"), "");
    await fs.symlink(
      path.join(root, "elsewhere"),
      path.join(root, "task/work/leak"),
    );
    layout = layoutFor(
      path.join(root, "task"),
      path.join(root, "docs"),
      record,
    );
  });

  afterAll(async () => {
    await fs.rm(root, { force: true, recursive: true });
    await fs.rm(record, { force: true, recursive: true });
  });

  it.each([
    { file: "task/work/page.html", reachable: true },
    { file: "docs/page.html", reachable: true },
    { file: "elsewhere/secret.txt", reachable: false },
    { file: "task/work/leak/secret.txt", reachable: false },
  ])("$file → reachable: $reachable", ({ file, reachable }) => {
    expect(
      agentPathOfFileUrl(layout, fileUrlOfHostPath(path.join(root, file))),
    ).toBe(reachable ? shellPath(path.join(root, file)) : null);
  });

  it.each([
    { file: "attachments/sent.html", reachable: true },
    { file: "chat.db", reachable: false },
  ])("record folder's $file → reachable: $reachable", ({ file, reachable }) => {
    expect(
      agentPathOfFileUrl(layout, fileUrlOfHostPath(path.join(record, file))),
    ).toBe(reachable ? shellPath(path.join(record, file)) : null);
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
    ).toBe(shellPath(path.join(linkedRoot, "work/page.html")));
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
