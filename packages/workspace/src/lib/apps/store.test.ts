import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { AbsolutePathSchema } from "../../schemas/paths";
import { loadApp } from "./store";

const drafts = {
  auth: { kind: "none" },
  name: "Drafts",
  package: "@agiletortoise/drafts-mcp-server",
  runtime: "node",
  type: "mcp-local",
};

let appsDir: string | undefined;

afterEach(async () => {
  if (appsDir) {
    await fs.rm(appsDir, { force: true, recursive: true });
  }
});

async function hashOf(manifest: object) {
  appsDir ??= await fs.mkdtemp(path.join(os.tmpdir(), "apps-store-"));
  await fs.mkdir(path.join(appsDir, "drafts"), { recursive: true });
  await fs.writeFile(
    path.join(appsDir, "drafts", "app.json"),
    JSON.stringify(manifest),
  );
  const app = await loadApp(AbsolutePathSchema.parse(appsDir), "drafts");
  return app._unsafeUnwrap().manifestHash;
}

describe("a manifest's hash", () => {
  it("leaves a local app's macApp out, so naming its icon keeps it connected", async () => {
    expect(
      await hashOf({ ...drafts, macApp: "com.agiletortoise.Drafts-OSX" }),
    ).toBe(await hashOf(drafts));
  });

  it("changes with what runs", async () => {
    expect(await hashOf({ ...drafts, package: "other-server" })).not.toBe(
      await hashOf(drafts),
    );
  });
});
