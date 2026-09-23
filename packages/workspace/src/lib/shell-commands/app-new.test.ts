import {
  createCommandContext,
  EMPTY_BYTES,
  encodeUtf8ToBytes,
  InMemoryFs,
} from "just-bash";
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { TaskIdSchema } from "../../schemas/task-id";
import { AppManifestSchema } from "../apps/manifest";
import { createMemoryAppsConfig } from "../apps/memory-config";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { createAppCommand } from "./app";

const taskId = TaskIdSchema.parse("app-new-task");
const apps = getWorkspaceConfig().apps;

afterEach(() => {
  setWorkspaceConfig({ ...getWorkspaceConfig(), apps });
});

async function app(...args: string[]) {
  return appWithStdin(undefined, ...args);
}

async function appWithStdin(stdin: string | undefined, ...args: string[]) {
  return createAppCommand({ taskId }).execute(
    args,
    createCommandContext({
      cwd: "/task",
      env: new Map<string, string>(),
      fs: new InMemoryFs(),
      stdin: stdin === undefined ? EMPTY_BYTES : encodeUtf8ToBytes(stdin),
    }),
  );
}

async function guideOf(slug: string) {
  return fs.readFile(
    path.join(getWorkspaceConfig().appsDir, slug, "guide.md"),
    "utf8",
  );
}

/** The manifest `app new` just wrote, parsed the way the app loader parses it. */
async function manifestOf(slug: string) {
  const file = path.join(getWorkspaceConfig().appsDir, slug, "app.json");
  return AppManifestSchema.parse(JSON.parse(await fs.readFile(file, "utf8")));
}

async function newApiApp(slug: string, ...extra: string[]) {
  return app(
    "new",
    slug,
    "--name",
    "WakaTime",
    "--api",
    "https://api.wakatime.com/api/v1",
    "--test",
    "/users/current",
    ...extra,
  );
}

describe("app new --auth basic", () => {
  // The encoding has to happen in the manifest because nothing upstream can do
  // it: the conversation's shell has no base64, and the card asks the user to
  // paste the key, not to prefix or encode it.
  it("writes the key-alone form", async () => {
    await newApiApp("basic-alone", "--auth", "basic");
    expect(await manifestOf("basic-alone")).toMatchObject({
      auth: { kind: "basic" },
    });
  });

  it("writes the user:key form", async () => {
    await newApiApp("basic-user", "--auth", "basic:acct");
    expect(await manifestOf("basic-user")).toMatchObject({
      auth: { kind: "basic", user: "acct" },
    });
  });

  it("names every placement an API app takes when the value is not one", async () => {
    const result = await newApiApp("basic-bad", "--auth", "apiKey");
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(
      'takes bearer, basic, basic:<user>, header:<Name>, query:<param>, or none (got "apiKey")',
    );
  });
});

describe("app test and the guide skeleton", () => {
  // `app new` writes the guide as a form, and the check that gated connecting
  // only asked whether the file was non-empty, so the form passed. The cost
  // landed one turn later: the first request in a task is answered with the
  // guide, and an unanswered one teaches the agent nothing about the service.
  it("refuses to connect an API app the directory does not know while its guide is the form", async () => {
    const made = await app(
      "new",
      "stub-guide",
      "--name",
      "Unknown",
      "--api",
      "https://api.unknown.invalid/v1",
      "--test",
      "/me",
    );
    expect(made.stdout).toContain("The guide has 3 prompts to answer");

    const result = await app("test", "stub-guide");

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("FAIL guide:");
    expect(result.stderr).toContain("3 unanswered");
    expect(result.stderr).toContain("app guide stub-guide <<'EOF'");
  });

  it("passes the guide check once the guide is written through app guide", async () => {
    await app(
      "new",
      "real-guide",
      "--name",
      "Unknown",
      "--api",
      "https://api.unknown.invalid/v1",
      "--test",
      "/me",
    );

    const written = await appWithStdin(
      "# Unknown\n\nA test service.\n\n## Endpoints\n\nGET /things\n\n## Conventions\n\nNone known.\n",
      "guide",
      "real-guide",
    );
    expect(written.stdout).toContain("Wrote /apps/real-guide/guide.md.");
    expect(await guideOf("real-guide")).toContain("GET /things");

    const result = await app("test", "real-guide");

    expect(result.stderr).toContain("PASS guide:");
  });

  it("says which prompts a written guide still carries", async () => {
    await app(
      "new",
      "half-guide",
      "--name",
      "Unknown",
      "--api",
      "https://api.unknown.invalid/v1",
      "--test",
      "/me",
    );
    const skeleton = await guideOf("half-guide");

    const written = await appWithStdin(
      skeleton.replace(
        "What this app is for, in a sentence or two.",
        "Things.",
      ),
      "guide",
      "half-guide",
    );

    expect(written.stdout).toContain("but these prompts are still in it");
    expect(written.stdout).not.toContain("What this app is for");
  });

  it("fills an MCP app's guide from the directory and does not gate on it", async () => {
    const made = await app(
      "new",
      "paper",
      "--name",
      "Paper",
      "--mcp",
      "http://127.0.0.1:29979/mcp",
      "--auth",
      "none",
    );
    expect(made.stdout).not.toContain("prompts to answer");
    expect(await guideOf("paper")).toContain(
      "Paper's MCP server runs inside Paper Desktop",
    );

    // Paper Desktop answering on this machine passes the whole test, which
    // reports on stdout rather than stderr.
    const result = await app("test", "paper");

    expect(`${result.stdout}${result.stderr}`).toContain("PASS guide:");
  });

  it("does not gate an MCP app the directory does not know on its guide", async () => {
    await app(
      "new",
      "unknown-mcp",
      "--name",
      "Unknown",
      "--mcp",
      "https://mcp.unknown.invalid/mcp",
    );

    expect(await guideOf("unknown-mcp")).toMatchInlineSnapshot(`
      "# Unknown

      Reached through its MCP server at https://mcp.unknown.invalid/mcp: \`app tools <slug>\` lists what it can do, \`app call <slug> <tool> '<json>'\` runs one.
      "
    `);

    const result = await app("test", "unknown-mcp");

    expect(result.stderr).toContain("PASS guide:");
  });

  it("finds the directory's entry by endpoint when the slug differs", async () => {
    await newApiApp("my-waka", "--auth", "basic");

    expect(await guideOf("my-waka")).toContain(
      "WakaTime records time spent coding",
    );
  });

  it("writes a directory API app's guide whole, with nothing left to answer", async () => {
    const made = await newApiApp("wakatime", "--auth", "basic");
    expect(made.stdout).not.toContain("prompts to answer");
    expect(await guideOf("wakatime")).toContain(
      "`GET /users/current/summaries`",
    );

    const result = await app("test", "wakatime");

    expect(result.stderr).toContain("PASS guide:");
  });

  it("puts the directory's key test in the set-up line", async () => {
    const result = await app("catalog", "github");

    expect(result.stdout).toContain(
      "app new github --name 'GitHub' --api https://api.github.com --auth bearer --test /user",
    );
  });
});

describe("app new with a key already stored", () => {
  // Rewriting a manifest to try another auth placement is the ordinary way a
  // 401 gets diagnosed, and the key that is already stored is what the retest
  // needs. Sending the agent back to connect_app is how one wrong placement
  // turned into four trips to the card.
  it("says to test the stored key rather than ask for it again", async () => {
    setWorkspaceConfig({
      ...getWorkspaceConfig(),
      apps: createMemoryAppsConfig({ credentials: { "stored-key": "k3y" } }),
    });

    const result = await newApiApp("stored-key", "--auth", "basic", "--force");

    expect(result.stdout).toContain(
      "A key for this app is already stored: run `app test stored-key`",
    );
    expect(result.stdout).not.toContain(
      "Ask the user for the key with connect_app",
    );
  });

  it("asks for the key when none is stored", async () => {
    const result = await newApiApp("no-key", "--auth", "basic");
    expect(result.stdout).toContain(
      "Ask the user for the key with connect_app",
    );
  });
});
