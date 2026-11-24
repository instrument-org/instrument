import { Uint8ArrayReader, Uint8ArrayWriter, ZipReader } from "@zip.js/zip.js";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

/**
 * The SHA-256 of the Chrome Web Store's own signing key, which signs every
 * package the store serves beside the developer's. Chromium's
 * `kPublisherKeyHash` (`components/crx_file/crx_verifier.cc`).
 */
const STORE_KEY_SHA256 =
  "61f7f2a6bfcf74cd0bc1fe2497cc9b04254c658f79f2145392867ea8366367cf";

const SIGNED_DATA_PREFIX = Buffer.from("CRX3 SignedData\0");

/** The fields of `CrxFileHeader`, `AsymmetricKeyProof` and `SignedData` read here. */
const FIELD = {
  crxId: 1,
  proofKey: 1,
  proofsEcdsa: 3,
  proofsRsa: 2,
  proofSignature: 2,
  signedData: 10_000,
} as const;

/** A protobuf message's length-delimited fields, by number; a message here has no other kind. */
function readFields(message: Buffer): Map<number, Buffer[]> {
  const fields = new Map<number, Buffer[]>();
  let at = 0;
  const varint = () => {
    let value = 0;
    for (let shift = 0; shift < 32; shift += 7) {
      const byte = message[at];
      if (byte === undefined) {
        break;
      }
      at += 1;
      value += (byte & 0x7f) * 2 ** shift;
      if (byte < 0x80) {
        return value;
      }
    }
    throw new Error("the package's header is malformed");
  };
  while (at < message.length) {
    const tag = varint();
    const length = varint();
    if (tag % 8 !== 2 || at + length > message.length) {
      throw new Error("the package's header is malformed");
    }
    const field = Math.floor(tag / 8);
    fields.set(field, [
      ...(fields.get(field) ?? []),
      message.subarray(at, at + length),
    ]);
    at += length;
  }
  return fields;
}

/** An extension's id as Chrome writes it: 16 bytes in the letters a to p. */
export function extensionIdOf(bytes: Buffer): string {
  return bytes
    .subarray(0, 16)
    .toString("hex")
    .replaceAll(/./g, (digit) =>
      String.fromCodePoint(97 + Number.parseInt(digit, 16)),
    );
}

function sha256(bytes: Buffer): Buffer {
  return crypto.createHash("sha256").update(bytes).digest();
}

/**
 * Checks a CRX3 package the way Chromium does one from the store: every
 * signature in it holds, one is by the key the extension's id is drawn from,
 * and one is the store's own. Gives the extension's key and its files' zip.
 * `storeKey` is the store's key hash, which only a test sets.
 */
export function verifyPackage(
  crx: Buffer,
  expected: { id: string; sha256: string },
  storeKey: string = STORE_KEY_SHA256,
): { archive: Buffer; key: Buffer } {
  if (sha256(crx).toString("hex") !== expected.sha256.toLowerCase()) {
    throw new Error("the package is not the one the store named");
  }
  if (
    crx.length < 12 ||
    crx.toString("latin1", 0, 4) !== "Cr24" ||
    crx.readUInt32LE(4) !== 3
  ) {
    throw new Error("the package is not a CRX3 file");
  }
  const headerEnd = 12 + crx.readUInt32LE(8);
  if (headerEnd > crx.length) {
    throw new Error("the package's header is malformed");
  }
  const header = readFields(crx.subarray(12, headerEnd));
  const archive = crx.subarray(headerEnd);
  const signedData = header.get(FIELD.signedData)?.[0];
  const crxId = signedData && readFields(signedData).get(FIELD.crxId)?.[0];
  if (!signedData || crxId?.length !== 16) {
    throw new Error("the package's header is malformed");
  }
  if (extensionIdOf(crxId) !== expected.id) {
    throw new Error("the package is another extension's");
  }
  const size = Buffer.alloc(4);
  size.writeUInt32LE(signedData.length);
  const signed = Buffer.concat([SIGNED_DATA_PREFIX, size, signedData, archive]);

  let developerKey: Buffer | undefined;
  let isFromStore = false;
  for (const proof of [
    ...(header.get(FIELD.proofsRsa) ?? []),
    ...(header.get(FIELD.proofsEcdsa) ?? []),
  ]) {
    const fields = readFields(proof);
    const key = fields.get(FIELD.proofKey)?.[0];
    const signature = fields.get(FIELD.proofSignature)?.[0];
    if (
      !key ||
      !signature ||
      !crypto.verify(
        "sha256",
        signed,
        { format: "der", key, type: "spki" },
        signature,
      )
    ) {
      throw new Error("the package's signature does not hold");
    }
    const hash = sha256(key);
    if (hash.subarray(0, 16).equals(crxId)) {
      developerKey = key;
    }
    isFromStore ||= hash.toString("hex") === storeKey;
  }
  if (!developerKey) {
    throw new Error("the package is not signed by the extension's developer");
  }
  if (!isFromStore) {
    throw new Error("the package is not signed by the Chrome Web Store");
  }
  return { archive, key: developerKey };
}

/**
 * Writes a verified package's files into a new folder, with its key in the
 * manifest, which is what gives the loaded extension its id.
 */
export async function unpackPackage(
  { archive, key }: { archive: Buffer; key: Buffer },
  dir: string,
): Promise<void> {
  const reader = new ZipReader(new Uint8ArrayReader(new Uint8Array(archive)), {
    useWebWorkers: false,
  });
  try {
    for (const entry of await reader.getEntries()) {
      const file = path.resolve(dir, entry.filename);
      if (!file.startsWith(path.resolve(dir) + path.sep)) {
        throw new Error("the package names a file outside its folder");
      }
      if (entry.directory) {
        await fs.mkdir(file, { recursive: true });
        continue;
      }
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, await entry.getData(new Uint8ArrayWriter()));
    }
  } finally {
    await reader.close();
  }
  const manifestPath = path.join(dir, "manifest.json");
  const manifest = z
    .looseObject({})
    .parse(parseManifest(await fs.readFile(manifestPath, "utf8")));
  await fs.writeFile(
    manifestPath,
    JSON.stringify({ ...manifest, key: key.toString("base64") }, null, 2),
  );
}

/** A manifest's JSON, which may open with a byte order mark. */
export function parseManifest(text: string): unknown {
  return JSON.parse(text.replace(/^\uFEFF/, ""));
}
