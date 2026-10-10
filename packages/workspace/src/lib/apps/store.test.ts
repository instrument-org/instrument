import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { AbsolutePathSchema } from "../../schemas/paths";
import { AppSlugSchema } from "./manifest";
import { loadApp, setWebAppAccount } from "./store";

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

  it("leaves the service out, so saying what an app is keeps it connected", async () => {
    expect(await hashOf({ ...drafts, service: "drafts" })).toBe(
      await hashOf(drafts),
    );
  });

  it("changes with what runs", async () => {
    expect(await hashOf({ ...drafts, package: "other-server" })).not.toBe(
      await hashOf(drafts),
    );
  });
});

describe("setWebAppAccount", () => {
  it("names the account and moves a Gmail app to that account's own address", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "apps-account-"));
    await fs.mkdir(path.join(dir, "gmail-2"));
    await fs.writeFile(
      path.join(dir, "gmail-2", "app.json"),
      JSON.stringify({
        name: "Gmail",
        service: "gmail",
        type: "web",
        url: "https://mail.google.com/mail/u/1/",
      }),
    );

    const manifest = await setWebAppAccount(
      AbsolutePathSchema.parse(dir),
      AppSlugSchema.parse("gmail-2"),
      "jeremy@example.com",
    );
    await fs.rm(dir, { force: true, recursive: true });

    expect(manifest).toMatchInlineSnapshot(`
      {
        "account": "jeremy@example.com",
        "name": "Gmail",
        "service": "gmail",
        "type": "web",
        "url": "https://mail.google.com/mail/?authuser=jeremy%40example.com",
      }
    `);
  });
});
