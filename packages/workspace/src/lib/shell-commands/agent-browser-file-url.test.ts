import { InMemoryFs } from "just-bash";
import { describe, expect, it } from "vitest";

import { FolderAttachment } from "../../schemas/folder-attachment";
import { AbsolutePathSchema, TaskDirSchema } from "../../schemas/paths";
import { buildWorkspaceFsLayout } from "../workspace-fs-layout";
import { rewriteNavigationArgToFileUrl } from "./agent-browser-file-url";

const layout = buildWorkspaceFsLayout({
  attachedFolders: {
    docs: {
      access: "read-only",
      createdAt: 0,
      id: FolderAttachment.IdSchema.parse("docs"),
      mountName: "Docs",
      path: AbsolutePathSchema.parse("/Users/me/My Docs"),
      source: "user",
    },
  },
  taskHostRoot: TaskDirSchema.parse("/Users/me/Tasks/test-task"),
});

async function makeCtx() {
  const fs = new InMemoryFs();
  await fs.mkdir("/task/output", { recursive: true });
  await fs.writeFile("/task/output/report.html", "<html></html>");
  await fs.writeFile("/task/output/quarterly report.html", "<html></html>");
  await fs.mkdir("/mnt/Docs", { recursive: true });
  await fs.writeFile("/mnt/Docs/notes.html", "<html></html>");
  return { cwd: "/task", fs };
}

async function rewrite(args: string[]) {
  return await rewriteNavigationArgToFileUrl(args, layout, await makeCtx());
}

async function rewritten(args: string[]) {
  const result = await rewrite(args);
  if ("error" in result) {
    throw new Error(result.error);
  }
  return result.args;
}

describe("rewriteNavigationArgToFileUrl", () => {
  it.each([
    {
      name: "file url under the task mount",
      url: "file:///task/output/report.html",
    },
    {
      name: "file url with a localhost host",
      url: "file://localhost/task/output/report.html",
    },
    { name: "virtual absolute path", url: "/task/output/report.html" },
    { name: "task-relative path", url: "output/report.html" },
    { name: "dot-relative path", url: "./output/report.html" },
  ])("opens a $name at the file's own address", async ({ url }) => {
    const result = await rewritten(["open", url]);

    expect(result[1]).toMatchInlineSnapshot(
      `"file:///Users/me/Tasks/test-task/output/report.html"`,
    );
  });

  it("keeps query and hash from a file url", async () => {
    const result = await rewritten([
      "open",
      "file:///task/output/report.html?tab=2#summary",
    ]);

    expect(result[1]).toMatchInlineSnapshot(
      `"file:///Users/me/Tasks/test-task/output/report.html?tab=2#summary"`,
    );
  });

  it("percent-encodes the path", async () => {
    const result = await rewritten(["open", "output/quarterly report.html"]);

    expect(result[1]).toMatchInlineSnapshot(
      `"file:///Users/me/Tasks/test-task/output/quarterly%20report.html"`,
    );
  });

  it("opens an attached folder's file where it lives", async () => {
    const result = await rewritten(["open", "/mnt/Docs/notes.html"]);

    expect(result[1]).toMatchInlineSnapshot(
      `"file:///Users/me/My%20Docs/notes.html"`,
    );
  });

  it("opens a missing task file so the agent sees the browser's not-found page", async () => {
    const result = await rewritten(["open", "file:///task/output/absent.html"]);

    expect(result[1]).toMatchInlineSnapshot(
      `"file:///Users/me/Tasks/test-task/output/absent.html"`,
    );
  });

  it.each([
    { arg: "file:///etc/hosts", name: "file outside every mount" },
    {
      arg: "file:///task/.instrument/task.db",
      name: "file in the task's private directory",
    },
    {
      arg: "file:///Users/me/Tasks/test-task/output/report.html",
      name: "host address, which the agent never has",
    },
    { arg: "/etc/hosts", name: "path outside every mount" },
    {
      arg: "/Users/me/Tasks/test-task/output/report.html",
      name: "host path, which the CLI would read as a host name",
    },
  ])("refuses a $name", async ({ arg }) => {
    expect(await rewrite(["open", arg])).toHaveProperty("error");
  });

  it.each([
    { arg: "https://example.com/pricing", name: "remote url" },
    { arg: "example.com/pricing", name: "bare host" },
    { arg: "//example.com", name: "protocol-relative url" },
    { arg: "about:blank", name: "about page" },
    { arg: "data:text/html,<p>hi</p>", name: "data url" },
    { arg: "output/absent.html", name: "relative path with no matching file" },
  ])("leaves a $name untouched", async ({ arg }) => {
    expect(await rewritten(["open", arg])).toEqual(["open", arg]);
  });

  it.each([
    { subcommand: "goto" },
    { subcommand: "navigate" },
    { subcommand: "read" },
  ])("rewrites for the $subcommand subcommand", async ({ subcommand }) => {
    const result = await rewritten([subcommand, "output/report.html"]);

    expect(result[1]).toContain("file:///Users/me/Tasks/");
  });

  it.each([
    { args: ["screenshot", "output/report.html"] },
    { args: ["pdf", "output/report.html"] },
    { args: ["download", "@e1", "output/report.html"] },
    { args: ["get", "text", "body"] },
    // A same-document history entry, not a document to load.
    { args: ["pushstate", "output/report.html"] },
  ])("leaves non-navigation subcommand $args.0 untouched", async ({ args }) => {
    expect(await rewritten(args)).toEqual(args);
  });

  it("leaves read with no target untouched", async () => {
    expect(await rewritten(["read"])).toEqual(["read"]);
  });

  it("skips leading flags to reach the target", async () => {
    const result = await rewritten(["open", "--raw", "output/report.html"]);

    expect(result[2]).toContain("file:///Users/me/Tasks/");
    expect(result[1]).toBe("--raw");
  });

  it.each([
    { args: ["--profile", "Default", "open", "output/report.html"] },
    { args: ["--cdp", "9222", "open", "output/report.html"] },
    { args: ["--auto-connect", "open", "output/report.html"] },
  ])(
    "reaches the subcommand past the connection flags in $args",
    async ({ args }) => {
      const result = await rewritten(args);

      expect(result.at(-1)).toContain("file:///Users/me/Tasks/");
    },
  );

  it("rewrites the target, not a preceding global flag's value", async () => {
    const result = await rewritten([
      "--headers",
      "{}",
      "open",
      "output/report.html",
    ]);

    expect(result[3]).toContain("file:///Users/me/Tasks/");
    expect(result.slice(0, 3)).toEqual(["--headers", "{}", "open"]);
  });

  it("preserves surrounding flags", async () => {
    const result = await rewritten([
      "open",
      "output/report.html",
      "--timeout",
      "5000",
    ]);

    expect(result.slice(2)).toEqual(["--timeout", "5000"]);
  });
});
