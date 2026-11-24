import { Uint8ArrayWriter, ZipWriter, TextReader } from "@zip.js/zip.js";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("./log", () => ({
  log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const { addVersion, chooseVersion, readInstalls, removeLeftoverData } =
  await import("./extension-installs");
const { extensionIdOf, verifyPackage } = await import("./extension-package");
const { compareExtensionVersions, parseStoreAnswer } =
  await import("./extension-store-updates");

const sha256 = (bytes: Buffer) =>
  crypto.createHash("sha256").update(bytes).digest();

function field(number: number, bytes: Buffer): Buffer {
  const varint = (value: number) => {
    const out: number[] = [];
    let rest = value;
    while (rest > 127) {
      out.push((rest % 128) + 128);
      rest = Math.floor(rest / 128);
    }
    return Buffer.from([...out, rest]);
  };
  return Buffer.concat([varint(number * 8 + 2), varint(bytes.length), bytes]);
}

const developer = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const store = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
const der = (key: crypto.KeyObject) =>
  key.export({ format: "der", type: "spki" });
const id = extensionIdOf(sha256(der(developer.publicKey)));
const storeKey = sha256(der(store.publicKey)).toString("hex");

async function zipOf(files: Record<string, string>): Promise<Buffer> {
  const writer = new ZipWriter(new Uint8ArrayWriter(), {
    useWebWorkers: false,
  });
  for (const [name, text] of Object.entries(files)) {
    await writer.add(name, new TextReader(text));
  }
  return Buffer.from(await writer.close());
}

function packageOf(archive: Buffer, { signStore = true } = {}) {
  const signedData = field(1, sha256(der(developer.publicKey)).subarray(0, 16));
  const size = Buffer.alloc(4);
  size.writeUInt32LE(signedData.length);
  const signed = Buffer.concat([
    Buffer.from("CRX3 SignedData\0"),
    size,
    signedData,
    archive,
  ]);
  const proof = (pair: {
    privateKey: crypto.KeyObject;
    publicKey: crypto.KeyObject;
  }) =>
    Buffer.concat([
      field(1, der(pair.publicKey)),
      field(2, crypto.sign("sha256", signed, pair.privateKey)),
    ]);
  const header = Buffer.concat([
    field(2, proof(developer)),
    ...(signStore ? [field(3, proof(store))] : []),
    field(10_000, signedData),
  ]);
  const start = Buffer.from("Cr24\0\0\0\0\0\0\0\0", "latin1");
  start.writeUInt32LE(3, 4);
  start.writeUInt32LE(header.length, 8);
  return Buffer.concat([start, header, archive]);
}

const check = (crx: Buffer, expectedId = id) =>
  verifyPackage(
    crx,
    { id: expectedId, sha256: sha256(crx).toString("hex") },
    storeKey,
  );

const manifest = (version: string, permissions: string[] = []) =>
  JSON.stringify({ manifest_version: 3, name: "T", permissions, version });

describe("verifyPackage", () => {
  it("takes a package its developer and the store signed", async () => {
    const archive = await zipOf({ "manifest.json": manifest("1.0") });
    expect(check(packageOf(archive)).archive.equals(archive)).toBe(true);
  });

  it("refuses one changed after it was signed", async () => {
    const crx = packageOf(await zipOf({ "manifest.json": manifest("1.0") }));
    const last = crx.length - 1;
    crx[last] = (crx[last] ?? 0) ^ 1;
    expect(() => check(crx)).toThrow("signature does not hold");
  });

  it("refuses one the store did not sign, another extension's, and another file", async () => {
    const archive = await zipOf({ "manifest.json": manifest("1.0") });
    expect(() => check(packageOf(archive, { signStore: false }))).toThrow(
      "not signed by the Chrome Web Store",
    );
    expect(() => check(packageOf(archive), "a".repeat(32))).toThrow(
      "another extension's",
    );
    expect(() =>
      verifyPackage(packageOf(archive), { id, sha256: "00" }, storeKey),
    ).toThrow("not the one the store named");
  });

  it("refuses a package cut short", async () => {
    const crx = packageOf(await zipOf({ "manifest.json": manifest("1.0") }));
    expect(() => check(crx.subarray(0, 200))).toThrow("malformed");
  });
});

describe("what is installed", () => {
  it("keeps the version agreed to while a newer one asks for more", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "extensions-"));
    const dir = path.join(root, "extensions");
    const key = der(developer.publicKey);
    const add = async (version: string, permissions?: string[]) =>
      await addVersion(dir, id, {
        archive: await zipOf({
          "_locales/en/messages.json": "{}",
          "manifest.json": manifest(version, permissions),
        }),
        key,
      });
    await add("8.12.44.33");
    await add("8.12.44.41");
    await add("8.12.45", ["history"]);
    const versions = (await readInstalls(dir))?.get(id) ?? [];
    const chosen = chooseVersion(versions, { origins: [], permissions: [] });
    expect(chosen.loadable?.version).toBe("8.12.44.41");
    expect(chosen.awaiting?.version.version).toBe("8.12.45");
    expect(chosen.awaiting?.lines).toEqual([
      "Read and change your browsing history",
    ]);
    expect(
      chooseVersion(versions, { origins: [], permissions: ["history"] }),
    ).toMatchObject({ awaiting: null, loadable: { version: "8.12.45" } });
    await fs.rm(root, { recursive: true });
  });

  it("deletes the data of extensions not installed, and nothing else", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "profile-"));
    const [kept, gone] = ["a".repeat(32), "b".repeat(32)];
    for (const at of [
      `Local Extension Settings/${kept}`,
      `Local Extension Settings/${gone}`,
      `IndexedDB/chrome-extension_${gone}_0.indexeddb.leveldb`,
      "IndexedDB/https_example.com_0.indexeddb.leveldb",
    ]) {
      await fs.mkdir(path.join(root, at), { recursive: true });
    }
    expect(await removeLeftoverData(root, (one) => one === kept)).toEqual([
      gone,
    ]);
    expect(
      await fs.readdir(path.join(root, "Local Extension Settings")),
    ).toEqual([kept]);
    expect(await fs.readdir(path.join(root, "IndexedDB"))).toEqual([
      "https_example.com_0.indexeddb.leveldb",
    ]);
    await fs.rm(root, { recursive: true });
  });
});

describe("the store's answer", () => {
  it("is read past its prefix, leaving out what has no package", () => {
    const answer = {
      response: {
        app: [
          {
            appid: "x",
            updatecheck: {
              manifest: {
                packages: { package: [{ hash_sha256: "ab", name: "x.crx" }] },
                version: "1.2",
              },
              status: "ok",
              urls: { url: [{ codebase: "https://example.com/x/" }] },
            },
          },
          { appid: "y", updatecheck: { status: "noupdate" } },
          { appid: "z", status: "error-unknownApplication" },
        ],
      },
    };
    expect(parseStoreAnswer(`)]}'\n${JSON.stringify(answer)}`)).toEqual([
      {
        id: "x",
        sha256: "ab",
        url: "https://example.com/x/x.crx",
        version: "1.2",
      },
    ]);
  });

  it.each([
    ["8.12.44.41", "8.12.44.33", 1],
    ["1.0", "1.0.0.0", 0],
    ["1.9", "1.10", -1],
  ])("orders %s against %s", (a, b, order) => {
    expect(Math.sign(compareExtensionVersions(a, b))).toBe(order);
  });
});
