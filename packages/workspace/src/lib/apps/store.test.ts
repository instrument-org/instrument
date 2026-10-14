import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type AbsolutePath, AbsolutePathSchema } from "../../schemas/paths";
import { absolutePathJoin } from "../absolute-path-join";
import { findAppIcon, writeAppIcon } from "./icon";
import {
  APP_GUIDE_FILE_NAME,
  APP_MANIFEST_FILE_NAME,
  AppManifestSchema,
  AppSlugSchema,
} from "./manifest";
import {
  loadApp,
  readAppGuide,
  setAppAccount,
  setWebAppAccount,
  writeAppFolder,
  writeAppGuide,
} from "./store";

const svgIcon = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>',
);

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

  // Hashes recorded by approvals given before a local app's manifest lost
  // its `env`: the same Drafts manifest with no env, and with one.
  const approvedWithout = "fc359c7061cb109d6b00a302a9909c39";
  const approvedWithEnv = "a198bbb2ad1371ee55caec5ac840057f";

  it("keeps the hash an approval recorded for a manifest with no env", async () => {
    expect(await hashOf(drafts)).toBe(approvedWithout);
  });

  it("reads a manifest still carrying env without it, so its approval is asked for again", async () => {
    const hash = await hashOf({
      ...drafts,
      env: { NODE_OPTIONS: "--require ./preload.js" },
    });

    expect(hash).toBe(approvedWithout);
    expect(hash).not.toBe(approvedWithEnv);
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

// The apps folder is open to the programs a chat runs, which can put a link
// at any name in it. The app reads and writes these files itself, outside
// every sandbox, so it follows none: a link at a file's name or at the app's
// folder leads nowhere.
describe.skipIf(process.platform === "win32")(
  "an app's files reached through a link",
  () => {
    let root: string;
    let apps: AbsolutePath;
    let secret: string;
    const slug = AppSlugSchema.parse("drafts");

    beforeEach(async () => {
      root = await fs.realpath(
        await fs.mkdtemp(path.join(os.tmpdir(), "apps-links-")),
      );
      apps = AbsolutePathSchema.parse(path.join(root, "apps"));
      secret = path.join(root, "closed", "secret.json");
      await fs.mkdir(path.dirname(secret), { recursive: true });
      await fs.writeFile(secret, "SECRET-VALUE\n");
      await fs.mkdir(path.join(apps, slug), { recursive: true });
      await fs.writeFile(
        path.join(apps, slug, APP_MANIFEST_FILE_NAME),
        JSON.stringify(drafts),
      );
    });

    afterEach(async () => {
      await fs.rm(root, { force: true, recursive: true });
    });

    it.each([
      {
        label: "the guide",
        name: APP_GUIDE_FILE_NAME,
        touch: async (dir: AbsolutePath) => {
          expect(await readAppGuide(dir)).toBeNull();
          expect(() => {
            writeAppGuide(dir, "overwritten");
          }).toThrow(/symbolic link|ELOOP/);
        },
      },
      {
        label: "the manifest",
        name: APP_MANIFEST_FILE_NAME,
        touch: async () => {
          const loaded = await loadApp(apps, slug);
          expect(loaded.isErr() && loaded.error.message).not.toContain(
            "SECRET",
          );
          await expect(
            setAppAccount(apps, slug, "someone@example.com"),
          ).rejects.toThrow();
        },
      },
      {
        label: "the icon",
        name: "icon.svg",
        touch: async (dir: AbsolutePath) => {
          expect(await findAppIcon(dir)).toBeUndefined();
          await expect(writeAppIcon(dir, svgIcon, "icon.svg")).rejects.toThrow(
            /ELOOP|symbolic link/,
          );
        },
      },
    ])(
      "reads and writes nothing through a link at $label",
      async ({ name, touch }) => {
        const at = path.join(apps, slug, name);
        await fs.rm(at, { force: true });
        await fs.symlink(secret, at);

        await touch(absolutePathJoin(apps, slug));

        expect(await fs.readFile(secret, "utf8")).toBe("SECRET-VALUE\n");
      },
    );

    it("reads, writes and removes nothing through a link at the app's folder", async () => {
      const closed = path.dirname(secret);
      await fs.writeFile(path.join(closed, APP_MANIFEST_FILE_NAME), "SECRET");
      await fs.writeFile(path.join(closed, "icon.png"), "keep");
      await fs.rm(path.join(apps, slug), { recursive: true });
      await fs.symlink(closed, path.join(apps, slug));
      const dir = absolutePathJoin(apps, slug);

      const loaded = await loadApp(apps, slug);
      expect(loaded.isErr() ? loaded.error.message : "").not.toContain(
        "SECRET",
      );
      await expect(writeAppIcon(dir, svgIcon, "icon.svg")).rejects.toThrow();
      await expect(
        writeAppFolder({
          appsDir: apps,
          guide: "g",
          manifest: AppManifestSchema.parse(drafts),
          slug,
        }),
      ).rejects.toThrow();

      expect(await fs.readdir(closed)).toEqual([
        APP_MANIFEST_FILE_NAME,
        "icon.png",
        "secret.json",
      ]);
      expect(await fs.readFile(path.join(closed, "icon.png"), "utf8")).toBe(
        "keep",
      );
    });
  },
);
