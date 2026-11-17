import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { forgetApps, seedApp } from "../../test/helpers/seed-app";
import { newDeviceId } from "../records/device-id";
import { getWorkspaceConfig } from "../workspace-config";
import { workspaceLayout } from "../workspace-layout";
import { findAppIcon, setAppIcon } from "./icon";
import { AppManifestSchema, AppSlugSchema } from "./manifest";
import {
  appFingerprint,
  appKey,
  appsStore,
  listApps,
  loadApp,
  readAppGuide,
  readAppSetup,
  removeApp,
  setAppAccount,
  writeApp,
  writeAppGuide,
  writeAppSetup,
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

const slug = AppSlugSchema.parse("drafts");

afterEach(async () => {
  await forgetApps();
});

describe("a manifest's hash", () => {
  async function hashOf(manifest: Record<string, unknown>) {
    await seedApp("drafts", { name: "Drafts", setup: manifest });
    const loaded = await loadApp("drafts");
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
  // (`lib/app-folders-to-store.ts`). A change to what goes into it disconnects every
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
  it("lists them by name, and one whose setup cannot be read apart, saying why", async () => {
    await seedApp("linear", {
      name: "Linear",
      setup: {
        auth: { kind: "oauth" },
        type: "mcp",
        url: "https://mcp.linear.app/mcp",
      },
    });
    await seedApp("drafts", { name: "Drafts", setup: drafts });
    await seedApp("broken", { name: "Broken", setup: { type: "telepathy" } });

    const { apps, invalid } = await listApps();

    expect(apps.map((app) => `${app.slug} (${app.name})`)).toEqual([
      "drafts (Drafts)",
      "linear (Linear)",
    ]);
    expect(invalid).toHaveLength(1);
    expect(invalid[0]?.slug).toBe("broken");
    expect(invalid[0]?.message).toContain("broken's setup is invalid");
  });

  it("says no app is there by an id nothing was set up under", async () => {
    const loaded = await loadApp("nothing");
    expect(loaded.isErr() && loaded.error.reason).toBe("not-found");
  });
});

describe("writing an app", () => {
  it("lands as a line in this device's own file of the apps store", async () => {
    await writeApp({
      guide: "Mine.",
      manifest: AppManifestSchema.parse(drafts),
      name: "Drafts",
      slug,
    });
    const { deviceId, rootDir } = getWorkspaceConfig();
    const file = path.join(
      workspaceLayout(rootDir).devicesDir,
      deviceId,
      "apps.jsonl",
    );
    const lines = (await fs.readFile(file, "utf8")).trim().split("\n");
    expect(JSON.parse(lines.at(-1) ?? "{}")).toMatchObject({
      key: "app/drafts",
      t: "set",
      value: { guide: "Mine.", name: "Drafts", setup: drafts },
    });
  });

  it("numbers the name when another app already has it", async () => {
    await seedApp("gmail", {
      name: "Gmail",
      setup: { type: "web", url: "https://mail.google.com" },
    });
    const named = await writeApp({
      guide: "",
      manifest: AppManifestSchema.parse({
        type: "web",
        url: "https://mail.google.com/mail/u/1/",
      }),
      name: "Gmail",
      slug: AppSlugSchema.parse("gmail-2"),
    });
    expect(named).toBe("Gmail 2");
  });

  it("keeps the name the person gave it, the guide, and keys this build does not read", async () => {
    await seedApp("drafts", {
      guide: "Mine.",
      name: "My Drafts",
      setup: { ...drafts, note: "kept by hand" },
    });

    const named = await writeApp({
      guide: "A new guide.",
      manifest: AppManifestSchema.parse({ ...drafts, package: "other-server" }),
      name: "Drafts",
      slug,
    });

    expect(named).toBe("My Drafts");
    expect(await readAppGuide(slug)).toBe("Mine.\n");
    expect(await readAppSetup(slug)).toEqual({
      ...drafts,
      note: "kept by hand",
      package: "other-server",
    });
  });

  it("writes the guide over the one it had when the app is reached another way", async () => {
    await seedApp("drafts", { guide: "Old.", name: "Drafts", setup: drafts });
    await writeApp({
      guide: "New.",
      manifest: AppManifestSchema.parse(drafts),
      name: "Drafts",
      replacesGuide: true,
      slug,
    });
    expect(await readAppGuide(slug)).toBe("New.\n");
  });

  it("is seen by another device once it reads the store again", async () => {
    const { rootDir } = getWorkspaceConfig();
    const other = {
      device: newDeviceId(),
      devicesDir: workspaceLayout(rootDir).devicesDir,
    };
    await (
      await appsStore(other)
    ).apply([
      {
        key: appKey(slug),
        t: "set",
        value: { guide: "", name: "Drafts", setup: drafts },
      },
    ]);

    await (await appsStore()).look();

    expect((await loadApp("drafts"))._unsafeUnwrap().name).toBe("Drafts");
  });
});

describe("an app's guide and setup", () => {
  it("writes the guide, keeping the setup", async () => {
    await seedApp("drafts", { name: "Drafts", setup: drafts });
    await writeAppGuide(slug, "  Notes live in the inbox.  \n");
    expect(await readAppGuide(slug)).toBe("Notes live in the inbox.\n");
    expect(await readAppSetup(slug)).toEqual(drafts);
  });

  it("reads no guide where the app has none", async () => {
    await seedApp("drafts", { name: "Drafts", setup: drafts });
    expect(await readAppGuide(slug)).toBeNull();
  });

  it("writes the setup whole, keeping the name, the guide and a key this build does not read", async () => {
    await seedApp("drafts", { guide: "Mine.", name: "Drafts", setup: drafts });
    await writeAppSetup(slug, { ...drafts, args: ["--verbose"], note: "x" });
    expect(await readAppSetup(slug)).toEqual({
      ...drafts,
      args: ["--verbose"],
      note: "x",
    });
    expect(await readAppGuide(slug)).toBe("Mine.\n");
    expect((await loadApp(slug))._unsafeUnwrap().name).toBe("Drafts");
  });

  it("refuses a setup that is not a manifest, writing nothing", async () => {
    await seedApp("drafts", { name: "Drafts", setup: drafts });
    await expect(writeAppSetup(slug, { type: "telepathy" })).rejects.toThrow(
      /The setup is invalid/,
    );
    expect(await readAppSetup(slug)).toEqual(drafts);
  });

  it("refuses to write the guide of an app that is not there", async () => {
    await expect(writeAppGuide(slug, "x")).rejects.toThrow(/No app is/);
  });
});

describe("an app's icon", () => {
  it("is kept apart from the app, changes its fingerprint, and goes when the app does", async () => {
    await seedApp("drafts", { name: "Drafts", setup: drafts });
    const before = await appFingerprint(slug);

    await setAppIcon(slug, svgIcon, "icon.svg");

    expect(await findAppIcon(slug)).toEqual({
      bytes: Buffer.from(svgIcon),
      fileName: "icon.svg",
    });
    expect(await appFingerprint(slug)).not.toBe(before);

    await removeApp(slug);

    expect(await findAppIcon(slug)).toBeUndefined();
    expect((await loadApp(slug)).isErr()).toBe(true);
  });
});

describe("setAppAccount", () => {
  const gmail = AppSlugSchema.parse("gmail-2");

  async function gmailApp() {
    await seedApp(gmail, {
      name: "Gmail 2",
      setup: {
        service: "gmail",
        type: "web",
        url: "https://mail.google.com/mail/u/1/",
      },
    });
  }

  it("names the account and moves a Gmail app to that account's own address", async () => {
    await gmailApp();

    expect(await setAppAccount(gmail, "name@example.com"))
      .toMatchInlineSnapshot(`
      {
        "account": "name@example.com",
        "service": "gmail",
        "type": "web",
        "url": "https://mail.google.com/mail/?authuser=name%40example.com",
      }
    `);
  });

  it("moves the app again when the account is renamed, and leaves it when the name is cleared", async () => {
    await gmailApp();
    await setAppAccount(gmail, "name@example.com");

    const renamed = await setAppAccount(gmail, "ada@example.com");
    const cleared = await setAppAccount(gmail, undefined);

    expect(renamed.type === "web" && renamed.url).toBe(
      "https://mail.google.com/mail/?authuser=ada%40example.com",
    );
    expect(cleared).toMatchInlineSnapshot(`
      {
        "service": "gmail",
        "type": "web",
        "url": "https://mail.google.com/mail/?authuser=ada%40example.com",
      }
    `);
  });

  it("keeps the address of a web app the directory has no account address for", async () => {
    await seedApp("inbox", {
      name: "Inbox",
      setup: { type: "web", url: "https://inbox.example/" },
    });
    const inbox = AppSlugSchema.parse("inbox");
    const before = (await loadApp(inbox))._unsafeUnwrap().manifestHash;

    const manifest = await setAppAccount(inbox, "name@example.com");

    expect(manifest.type === "web" && manifest.url).toBe(
      "https://inbox.example/",
    );
    expect((await loadApp(inbox))._unsafeUnwrap().manifestHash).toBe(before);
  });
});
