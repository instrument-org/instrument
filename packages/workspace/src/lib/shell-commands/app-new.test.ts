import {
  createCommandContext,
  EMPTY_BYTES,
  encodeUtf8ToBytes,
  InMemoryFs,
} from "just-bash";
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TaskIdSchema } from "../../schemas/task-id";
import { AppManifestSchema } from "../apps/manifest";
import { createMemoryAppsConfig } from "../apps/memory-config";
import { loadApp } from "../apps/store";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { createAppCommand } from "./app";
import { knowTask } from "../../test/helpers/mock-task-config";

const taskId = TaskIdSchema.parse("app-new-task");
const apps = getWorkspaceConfig().apps;

beforeEach(() => {
  knowTask(taskId);
});

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

describe("app new --mac-app", () => {
  it("names the Mac app a local server drives", async () => {
    await app(
      "new",
      "drafts",
      "--name",
      "Drafts",
      "--local",
      "@agiletortoise/drafts-mcp-server",
      "--mac-app",
      "com.agiletortoise.Drafts-OSX",
    );
    expect(await manifestOf("drafts")).toMatchObject({
      macApp: "com.agiletortoise.Drafts-OSX",
      type: "mcp-local",
    });
  });

  it.each([
    [
      "a hosted server",
      ["--mcp", "https://mcp.example.com/mcp"],
      "Drafts",
      "--mac-app goes with --local",
    ],
    [
      "an app name",
      ["--local", "@agiletortoise/drafts-mcp-server"],
      "Drafts",
      "macApp must be a bundle identifier",
    ],
  ])("refuses it for %s", async (_, endpoint, macApp, message) => {
    const result = await app(
      "new",
      "drafts-bad",
      "--name",
      "Drafts",
      ...endpoint,
      "--mac-app",
      macApp,
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(message);
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

  it.each([
    // A hosted MCP server that takes a key carries it, or the card it makes
    // offers a sign-in the server cannot do.
    ["render", "--mcp https://mcp.render.com/mcp --auth bearer"],
    // One whose sign-in needs a client Instrument has not registered falls
    // through to the key that works.
    ["slack", "--api https://slack.com/api --auth bearer"],
    ["hubspot", "--api https://api.hubapi.com --auth bearer"],
    // One that wants a sign-in gets the card, not --auth none.
    ["semgrep", "--mcp https://mcp.semgrep.ai/mcp\n"],
  ])("sets %s up the way it actually connects", async (slug, line) => {
    const result = await app("catalog", slug);

    expect(`${result.stdout}\n`).toContain(line);
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
      apps: createMemoryAppsConfig({
        credentials: {
          "stored-key": { origin: "https://api.wakatime.com", value: "k3y" },
        },
      }),
    });

    const result = await newApiApp("stored-key", "--auth", "basic", "--force");

    expect(result.stdout).toContain(
      "A key for this app is already stored for https://api.wakatime.com: run `app test stored-key`",
    );
    expect(result.stdout).not.toContain(
      "Ask the user for the key with connect_app",
    );
  });

  // The manifest is the agent's to write, so a key reused against whatever
  // base URL it names would go wherever the agent points it.
  it("asks the user again when the manifest points the key at another origin", async () => {
    setWorkspaceConfig({
      ...getWorkspaceConfig(),
      apps: createMemoryAppsConfig({
        credentials: {
          "moved-key": { origin: "https://api.wakatime.com", value: "k3y" },
        },
      }),
    });

    const result = await app(
      "new",
      "moved-key",
      "--name",
      "WakaTime",
      "--api",
      "https://collector.example",
      "--auth",
      "bearer",
      "--test",
      "/users/current",
    );

    expect(result.stdout).toContain(
      "The stored key was approved for https://api.wakatime.com, and this manifest would send it to https://collector.example.",
    );
    expect(result.stdout).not.toContain("already stored");
  });

  it("asks for the key when none is stored", async () => {
    const result = await newApiApp("no-key", "--auth", "basic");
    expect(result.stdout).toContain(
      "Ask the user for the key with connect_app",
    );
  });
});

describe("app icon", () => {
  async function setIcon(slug: string, file: string, svg: string) {
    const taskFs = new InMemoryFs();
    await taskFs.writeFile(`/task/${file}`, svg);
    return createAppCommand({ taskId }).execute(
      ["icon", slug, file],
      createCommandContext({
        cwd: "/task",
        env: new Map<string, string>(),
        fs: taskFs,
        stdin: EMPTY_BYTES,
      }),
    );
  }

  it("puts a square SVG in the app's folder, replacing a PNG", async () => {
    await app(
      "new",
      "drafts-icon",
      "--name",
      "Drafts",
      "--local",
      "@agiletortoise/drafts-mcp-server",
    );
    const appDir = path.join(getWorkspaceConfig().appsDir, "drafts-icon");
    await fs.writeFile(path.join(appDir, "icon.png"), "old");

    const result = await setIcon(
      "drafts-icon",
      "mark.svg",
      '<svg viewBox="0 0 64 64"><rect width="64" height="64"/></svg>',
    );

    expect(result.exitCode).toBe(0);
    expect(await fs.readdir(appDir)).toEqual(
      expect.arrayContaining(["icon.svg"]),
    );
    expect(await fs.readdir(appDir)).not.toContain("icon.png");
  });

  it("refuses a file that would not draw as a square", async () => {
    const result = await setIcon(
      "drafts-icon",
      "wide.svg",
      '<svg viewBox="0 0 120 40"></svg>',
    );

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("an icon is square");
  });
});

describe("app new --web", () => {
  it("writes a web app with its sign-in page and points at connect_app", async () => {
    const result = await app(
      "new",
      "zoom-web",
      "--name",
      "Zoom",
      "--web",
      "https://zoom.us",
      "--sign-in",
      "https://zoom.us/signin",
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      "Ask the user to sign in with connect_app: the card opens https://zoom.us/signin in Instrument's browser",
    );
    expect(await manifestOf("zoom-web")).toEqual({
      name: "Zoom",
      signIn: "https://zoom.us/signin",
      type: "web",
      url: "https://zoom.us",
    });
    expect(await guideOf("zoom-web")).toContain(
      "Worked on the web at https://zoom.us",
    );
  });

  it.each([
    [["--web", "https://zoom.us", "--auth", "bearer"], "takes no --auth"],
    [
      [
        "--mcp",
        "https://mcp.zoom.us/mcp",
        "--sign-in",
        "https://zoom.us/signin",
      ],
      "--sign-in goes with --web",
    ],
    [
      ["--web", "https://zoom.us", "--mcp", "https://mcp.zoom.us/mcp"],
      "exactly one of",
    ],
  ])("refuses %j", async (extra, message) => {
    const result = await app("new", "zoom-bad", "--name", "Zoom", ...extra);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(message);
  });

  it("refuses a call, saying how a web app is worked", async () => {
    await app("new", "zoom-call", "--name", "Zoom", "--web", "https://zoom.us");
    const { manifestHash } = (
      await loadApp(getWorkspaceConfig().appsDir, "zoom-call")
    )._unsafeUnwrap();
    await getWorkspaceConfig().apps.connections.set("zoom-call", {
      manifestHash,
      status: "connected",
      updatedAt: 1,
    });
    const result = await app("call", "zoom-call", "list_meetings");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatchInlineSnapshot(`
      "app: "zoom-call" is a web app: the user is signed in to it in Instrument's browser, and no \`app\` call reaches it. Work it in a tab: brief a task with https://zoom.us, or hand it a tab already open there with \`task new --tab <id>\`.
      "
    `);
  });
});
