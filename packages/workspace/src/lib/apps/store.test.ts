import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type AbsolutePath, AbsolutePathSchema } from "../../schemas/paths";
import { absolutePathJoin } from "../absolute-path-join";
import { APP_FILE_NAME, renderAppFile } from "./app-file";
import { findAppIcon, writeAppIcon } from "./icon";
import { AppManifestSchema, AppSlugSchema } from "./manifest";
import {
  listApps,
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
  package: "@agiletortoise/drafts-mcp-server",
  runtime: "node",
  type: "mcp-local",
};

const made: string[] = [];

afterEach(async () => {
  await Promise.all(
    made.splice(0).map((dir) => fs.rm(dir, { force: true, recursive: true })),
  );
});

/** An apps folder of its own, removed when the test ends. */
async function freshApps(what: string): Promise<AbsolutePath> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `apps-${what}-`));
  made.push(dir);
  return AbsolutePathSchema.parse(dir);
}

/** An app's folder, written as the app writes it. */
async function writeApp(
  appsDir: string,
  name: string,
  front: Record<string, unknown> & { id: string },
  guide = "",
): Promise<void> {
  const { id, ...manifest } = front;
  await fs.mkdir(path.join(appsDir, name), { recursive: true });
  await fs.writeFile(
    path.join(appsDir, name, APP_FILE_NAME),
    renderAppFile({
      guide,
      id: AppSlugSchema.parse(id),
      manifest: AppManifestSchema.parse(manifest),
    }),
  );
}

describe("a manifest's hash", () => {
  let apps: AbsolutePath;

  beforeEach(async () => {
    apps = await freshApps("hash");
  });

  async function hashOf(manifest: object) {
    await writeApp(apps, "Drafts", { ...manifest, id: "drafts" });
    const loaded = await loadApp(apps, "drafts");
    return loaded._unsafeUnwrap().manifestHash;
  }

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

  // The digest the migration restamps a connected local app's approval to
  // (`lib/apps-move.ts`). A change to what goes into it disconnects every
  // app in every workspace, so it is pinned here rather than computed.
  it("is what this build's manifest keys come to", async () => {
    expect(await hashOf(drafts)).toMatchInlineSnapshot(
      `"4710b4fac77f8b3bbb46ccba4516816c"`,
    );
  });

  it("changes with what runs", async () => {
    expect(await hashOf({ ...drafts, package: "other-server" })).not.toBe(
      await hashOf(drafts),
    );
  });
});

describe("listing the apps", () => {
  let apps: AbsolutePath;

  beforeEach(async () => {
    apps = await freshApps("list");
  });

  it("names each app by its folder and knows it by the id in its file", async () => {
    await writeApp(apps, "Drafts at work", { ...drafts, id: "drafts-2" });
    await fs.mkdir(path.join(apps, "Notes I keep"), { recursive: true });
    await fs.writeFile(path.join(apps, "Notes I keep", "thoughts.md"), "Mine.");

    const { apps: listed, invalid } = await listApps(apps);

    expect(invalid).toEqual([]);
    expect(listed.map((app) => [app.slug, app.name])).toEqual([
      ["drafts-2", "Drafts at work"],
    ]);
  });

  it("takes the first of two folders with one id and says so about the other", async () => {
    await writeApp(apps, "Drafts", { ...drafts, id: "drafts" });
    await writeApp(apps, "Drafts copy", { ...drafts, id: "drafts" });

    const { apps: listed, invalid } = await listApps(apps);

    expect(listed.map((app) => app.name)).toEqual(["Drafts"]);
    expect(invalid).toMatchInlineSnapshot(`
      [
        {
          "message": ""Drafts copy" says it is "drafts", which "Drafts" already is. Give one of them an id of its own, or take it away.",
          "slug": "drafts",
        },
      ]
    `);
  });

  it("says what is wrong with a file whose setup cannot be read", async () => {
    await fs.mkdir(path.join(apps, "Linear"), { recursive: true });
    await fs.writeFile(
      path.join(apps, "Linear", APP_FILE_NAME),
      "---\nid: linear\ntype: mcp\n---\n",
    );

    const { apps: listed, invalid } = await listApps(apps);

    expect(listed).toEqual([]);
    expect(invalid[0]?.slug).toBe("linear");
    expect(invalid[0]?.message).toContain("auth");
  });
});

describe("writing an app's folder", () => {
  let apps: AbsolutePath;

  beforeEach(async () => {
    apps = await freshApps("write");
  });

  it("numbers the folder when another app already has the name", async () => {
    const manifest = AppManifestSchema.parse(drafts);

    const first = await writeAppFolder({
      appsDir: apps,
      guide: "One.",
      manifest,
      name: "Drafts",
      slug: AppSlugSchema.parse("drafts"),
    });
    const second = await writeAppFolder({
      appsDir: apps,
      guide: "Two.",
      manifest,
      name: "Drafts",
      slug: AppSlugSchema.parse("drafts-2"),
    });

    expect([path.basename(first), path.basename(second)]).toEqual([
      "Drafts",
      "Drafts 2",
    ]);
  });

  it("keeps the folder the person renamed, and the guide, when the app is written again", async () => {
    await writeApp(apps, "My Drafts", { ...drafts, id: "drafts" }, "Mine.");

    const written = await writeAppFolder({
      appsDir: apps,
      guide: "A skeleton nobody answered.",
      manifest: AppManifestSchema.parse({ ...drafts, service: "drafts" }),
      name: "Drafts",
      slug: AppSlugSchema.parse("drafts"),
    });

    expect(path.basename(written)).toBe("My Drafts");
    expect(await readAppGuide(written)).toBe("Mine.\n");
  });
});

describe("an app's guide", () => {
  it("is the body of the file, and writing it keeps every key above it", async () => {
    const apps = await freshApps("guide");
    const dir = absolutePathJoin(apps, "Notion");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, APP_FILE_NAME),
      [
        "---",
        "id: notion",
        "type: api",
        "url: https://api.notion.com/v1",
        "auth:",
        "  kind: bearer",
        "test:",
        "  path: /users/me",
        "color: aubergine",
        "---",
        "",
        "What it was for.",
        "",
      ].join("\n"),
    );

    writeAppGuide(dir, "What it is for now.");

    expect(await fs.readFile(path.join(dir, APP_FILE_NAME), "utf8"))
      .toMatchInlineSnapshot(`
      "---
      id: notion
      type: api
      url: https://api.notion.com/v1
      auth:
        kind: bearer
      test:
        path: /users/me
      color: aubergine
      ---

      What it is for now.
      "
    `);
  });
});

describe("setWebAppAccount", () => {
  it("names the account and moves a Gmail app to that account's own address", async () => {
    const apps = await freshApps("account");
    await writeApp(apps, "Gmail 2", {
      id: "gmail-2",
      service: "gmail",
      type: "web",
      url: "https://mail.google.com/mail/u/1/",
    });

    const manifest = await setWebAppAccount(
      apps,
      AppSlugSchema.parse("gmail-2"),
      "jeremy@example.com",
    );

    expect(manifest).toMatchInlineSnapshot(`
      {
        "account": "jeremy@example.com",
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
      made.push(root);
      apps = AbsolutePathSchema.parse(path.join(root, "Apps"));
      secret = path.join(root, "closed", "secret.json");
      await fs.mkdir(path.dirname(secret), { recursive: true });
      await fs.writeFile(secret, "SECRET-VALUE\n");
      await writeApp(apps, "Drafts", { ...drafts, id: slug }, "Mine.");
    });

    it.each([
      {
        label: "the app's own file",
        name: APP_FILE_NAME,
        touch: async (dir: AbsolutePath) => {
          const loaded = await loadApp(apps, slug);
          expect(loaded.isErr() && loaded.error.message).not.toContain(
            "SECRET",
          );
          expect(await readAppGuide(dir)).toBeNull();
          expect(() => {
            writeAppGuide(dir, "overwritten");
          }).toThrow();
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
        const at = path.join(apps, "Drafts", name);
        await fs.rm(at, { force: true });
        await fs.symlink(secret, at);

        await touch(absolutePathJoin(apps, "Drafts"));

        expect(await fs.readFile(secret, "utf8")).toBe("SECRET-VALUE\n");
      },
    );

    it("reads, writes and removes nothing through a link at the app's folder", async () => {
      const closed = path.dirname(secret);
      await fs.writeFile(path.join(closed, APP_FILE_NAME), "SECRET");
      await fs.writeFile(path.join(closed, "icon.png"), "keep");
      await fs.rm(path.join(apps, "Drafts"), { recursive: true });
      await fs.symlink(closed, path.join(apps, "Drafts"));
      const dir = absolutePathJoin(apps, "Drafts");

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
          name: "Drafts",
          slug,
        }),
      ).rejects.toThrow();

      expect(await fs.readdir(closed)).toEqual([
        APP_FILE_NAME,
        "icon.png",
        "secret.json",
      ]);
      expect(await fs.readFile(path.join(closed, "icon.png"), "utf8")).toBe(
        "keep",
      );
    });
  },
);
