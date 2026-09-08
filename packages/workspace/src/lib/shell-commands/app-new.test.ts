import { createCommandContext, EMPTY_BYTES, InMemoryFs } from "just-bash";
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
  return createAppCommand({ taskId }).execute(
    args,
    createCommandContext({
      cwd: "/task",
      env: new Map<string, string>(),
      fs: new InMemoryFs(),
      stdin: EMPTY_BYTES,
    }),
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
  it("refuses to connect an app whose guide is still the form", async () => {
    await newApiApp("stub-guide", "--auth", "basic");

    const result = await app("test", "stub-guide");

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("FAIL guide:");
    expect(result.stderr).toContain("is still the skeleton");
    expect(result.stderr).toContain("3 of its prompts are unanswered");
  });

  it("passes the guide check once the prompts are answered", async () => {
    await newApiApp("real-guide", "--auth", "basic");
    await fs.writeFile(
      path.join(getWorkspaceConfig().appsDir, "real-guide", "guide.md"),
      "# WakaTime\n\nCoding time recorded by an editor plugin.\n\n## Endpoints\n\nGET /users/current/summaries?range=Today\n",
      "utf8",
    );

    const result = await app("test", "real-guide");

    expect(result.stderr).toContain("PASS guide:");
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
