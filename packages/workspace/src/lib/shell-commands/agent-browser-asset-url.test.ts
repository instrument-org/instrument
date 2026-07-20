import { InMemoryFs } from "just-bash";
import { describe, expect, it } from "vitest";

import { TaskIdSchema } from "../../schemas/task-id";
import { rewriteNavigationArgToAssetUrl } from "./agent-browser-asset-url";

const taskId = TaskIdSchema.parse("test-task");

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
  return await rewriteNavigationArgToAssetUrl(args, taskId, await makeCtx());
}

describe("rewriteNavigationArgToAssetUrl", () => {
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
  ])("rewrites a $name onto the asset origin", async ({ url }) => {
    const result = await rewrite(["open", url]);

    expect(result[1]).toMatchInlineSnapshot(
      `"http://assets.test-task.localhost:48500/output/report.html"`,
    );
  });

  it("keeps query and hash from a file url", async () => {
    const result = await rewrite([
      "open",
      "file:///task/output/report.html?tab=2#summary",
    ]);

    expect(result[1]).toMatchInlineSnapshot(
      `"http://assets.test-task.localhost:48500/output/report.html?tab=2#summary"`,
    );
  });

  it("percent-encodes path segments", async () => {
    const result = await rewrite(["open", "output/quarterly report.html"]);

    expect(result[1]).toMatchInlineSnapshot(
      `"http://assets.test-task.localhost:48500/output/quarterly%20report.html"`,
    );
  });

  it("serves attached folders from their mount path", async () => {
    const result = await rewrite(["open", "/mnt/Docs/notes.html"]);

    expect(result[1]).toMatchInlineSnapshot(
      `"http://assets.test-task.localhost:48500/mnt/Docs/notes.html"`,
    );
  });

  it("rewrites a missing task file so the agent gets a 404, not a host miss", async () => {
    const result = await rewrite(["open", "file:///task/output/absent.html"]);

    expect(result[1]).toMatchInlineSnapshot(
      `"http://assets.test-task.localhost:48500/output/absent.html"`,
    );
  });

  it.each([
    { arg: "https://example.com/pricing", name: "remote url" },
    { arg: "example.com/pricing", name: "bare host" },
    { arg: "//example.com", name: "protocol-relative url" },
    { arg: "about:blank", name: "about page" },
    { arg: "data:text/html,<p>hi</p>", name: "data url" },
    { arg: "output/absent.html", name: "relative path with no matching file" },
    { arg: "/etc/hosts", name: "path outside every mount" },
    {
      arg: "file://elsewhere/task/output/report.html",
      name: "file url on another host",
    },
  ])("leaves a $name untouched", async ({ arg }) => {
    const result = await rewrite(["open", arg]);

    expect(result).toEqual(["open", arg]);
  });

  it.each([
    { subcommand: "goto" },
    { subcommand: "navigate" },
    { subcommand: "read" },
  ])("rewrites for the $subcommand subcommand", async ({ subcommand }) => {
    const result = await rewrite([subcommand, "output/report.html"]);

    expect(result[1]).toContain("http://assets.");
  });

  it.each([
    { args: ["screenshot", "output/report.html"] },
    { args: ["pdf", "output/report.html"] },
    { args: ["download", "@e1", "output/report.html"] },
    { args: ["get", "text", "body"] },
    // A same-origin history entry, not a document to fetch.
    { args: ["pushstate", "output/report.html"] },
  ])("leaves non-navigation subcommand $args.0 untouched", async ({ args }) => {
    expect(await rewrite(args)).toEqual(args);
  });

  it("leaves read with no target untouched", async () => {
    expect(await rewrite(["read"])).toEqual(["read"]);
  });

  it("skips leading flags to reach the target", async () => {
    const result = await rewrite(["open", "--raw", "output/report.html"]);

    expect(result[2]).toContain("http://assets.");
    expect(result[1]).toBe("--raw");
  });

  it.each([
    { args: ["--profile", "Default", "open", "output/report.html"] },
    { args: ["--cdp", "9222", "open", "output/report.html"] },
    { args: ["--auto-connect", "open", "output/report.html"] },
  ])(
    "reaches the subcommand past the connection flags in $args",
    async ({ args }) => {
      const result = await rewrite(args);

      expect(result.at(-1)).toContain("http://assets.");
    },
  );

  it("preserves surrounding flags", async () => {
    const result = await rewrite([
      "open",
      "output/report.html",
      "--timeout",
      "5000",
    ]);

    expect(result.slice(2)).toEqual(["--timeout", "5000"]);
  });
});
