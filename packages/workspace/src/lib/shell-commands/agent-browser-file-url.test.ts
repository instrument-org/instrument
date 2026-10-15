import { InMemoryFs } from "just-bash";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

import { MountedFolder } from "../../schemas/mounted-folder";
import {
  AbsolutePathSchema,
  ChatDirSchema,
  WorkDirSchema,
} from "../../schemas/paths";
import { getWorkspaceConfig } from "../workspace-config";
import { workspaceLayout } from "../workspace-layout";
import { buildWorkspaceFsLayout, shellPath } from "../workspace-fs-layout";
import { rewriteNavigationArgToFileUrl } from "./agent-browser-file-url";

// The folders as this computer spells them (`C:\Users\me\...` on Windows),
// and as the agent's shell does, which is the spelling it hands the command.
const TASK_HOST = path.resolve("/Users/me/Tasks/test-task");
const DOCS_HOST = path.resolve("/Users/me/My Docs");
const TASK = shellPath(TASK_HOST);
const DOCS = shellPath(DOCS_HOST);
// The chat's record folder, in the workspace, which the rules keep hidden.
const RECORD = path.join(
  workspaceLayout(getWorkspaceConfig().rootDir).chatsDir,
  "test-task",
);

/** The address the browser loads a file in one of the folders at. */
function addressOf(hostRoot: string, ...segments: string[]) {
  return pathToFileURL(path.join(hostRoot, ...segments)).href;
}

const layout = buildWorkspaceFsLayout({
  folders: {
    docs: {
      access: "read-only",
      id: MountedFolder.IdSchema.parse("docs"),
      path: AbsolutePathSchema.parse(DOCS_HOST),
    },
  },
  chatHostRoot: WorkDirSchema.parse(TASK_HOST),
  recordHostRoot: ChatDirSchema.parse(RECORD),
});

async function makeCtx() {
  const fs = new InMemoryFs();
  await fs.mkdir(`${TASK}/output`, { recursive: true });
  await fs.writeFile(`${TASK}/output/report.html`, "<html></html>");
  await fs.writeFile(`${TASK}/output/quarterly report.html`, "<html></html>");
  await fs.mkdir(DOCS, { recursive: true });
  await fs.writeFile(`${DOCS}/notes.html`, "<html></html>");
  return { cwd: TASK, fs };
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
      url: `file://${TASK}/output/report.html`,
    },
    {
      name: "file url with a localhost host",
      url: `file://localhost${TASK}/output/report.html`,
    },
    {
      name: "absolute path",
      url: `${TASK}/output/report.html`,
    },
    { name: "path relative to the chat's folder", url: "output/report.html" },
    { name: "dot-relative path", url: "./output/report.html" },
  ])("opens a $name at the file's own address", async ({ url }) => {
    const result = await rewritten(["open", url]);

    expect(result[1]).toBe(addressOf(TASK_HOST, "output", "report.html"));
  });

  it("keeps query and hash from a file url", async () => {
    const result = await rewritten([
      "open",
      `file://${TASK}/output/report.html?tab=2#summary`,
    ]);

    expect(result[1]).toBe(
      `${addressOf(TASK_HOST, "output", "report.html")}?tab=2#summary`,
    );
  });

  it("percent-encodes the path", async () => {
    const result = await rewritten(["open", "output/quarterly report.html"]);

    expect(result[1]).toBe(
      addressOf(TASK_HOST, "output", "quarterly report.html"),
    );
    expect(result[1]).toMatch(/\/quarterly%20report\.html$/);
  });

  it("opens a folder mount's file where it lives", async () => {
    const result = await rewritten(["open", `${DOCS}/notes.html`]);

    expect(result[1]).toBe(addressOf(DOCS_HOST, "notes.html"));
  });

  it("opens a missing file in the chat's folder so the agent sees the browser's not-found page", async () => {
    const result = await rewritten([
      "open",
      `file://${TASK}/output/absent.html`,
    ]);

    expect(result[1]).toBe(addressOf(TASK_HOST, "output", "absent.html"));
  });

  it.each([
    { arg: "file:///etc/hosts", name: "file outside every mount" },
    {
      arg: `file://${shellPath(RECORD)}/chat.db`,
      name: "file in the chat's record folder",
    },
    { arg: "/etc/hosts", name: "path outside every mount" },
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

    expect(result[1]).toContain(addressOf(TASK_HOST));
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

    expect(result[2]).toContain(addressOf(TASK_HOST));
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

      expect(result.at(-1)).toContain(addressOf(TASK_HOST));
    },
  );

  it("rewrites the target, not a preceding global flag's value", async () => {
    const result = await rewritten([
      "--headers",
      "{}",
      "open",
      "output/report.html",
    ]);

    expect(result[3]).toContain(addressOf(TASK_HOST));
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
