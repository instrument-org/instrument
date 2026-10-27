import Store from "electron-store";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { decryptions, encryption } = vi.hoisted(() => ({
  decryptions: { count: 0 },
  encryption: { available: true },
}));

// A packaged build's path. safeStorage stands in as a reversible base64 that
// refuses anything this "computer" did not encrypt, as a file from another
// build's keyring would be refused.
vi.mock("@electron-toolkit/utils", () => ({ is: { dev: false } }));
vi.mock("electron", () => ({
  default: {},
  safeStorage: {
    decryptString: (buffer: Buffer) => {
      decryptions.count += 1;
      if (!encryption.available) {
        throw new Error("Encryption is not available");
      }
      const text = buffer.toString("utf8");
      if (!text.startsWith("ours:")) {
        throw new Error(
          "Error while decrypting the ciphertext provided to safeStorage.decryptString.",
        );
      }
      return text.slice("ours:".length);
    },
    encryptString: (text: string) => Buffer.from(`ours:${text}`, "utf8"),
    isEncryptionAvailable: () => encryption.available,
  },
}));

const { encodeKeyFile, keyFileDeserializer } = await import("./key-file");

type Shape = { token?: string };

describe("an unreadable key file", () => {
  let dir = "";
  const log = { error: vi.fn() };

  const open = () =>
    new Store<Shape>({
      cwd: dir,
      deserialize: keyFileDeserializer<Shape>({
        fallback: () => ({}),
        log,
        lost: "its sign-ins",
        name: "the test store",
        parse: (json) => json as Shape,
      }),
      fileExtension: "json.enc",
      name: "keys",
      serialize: (value) => encodeKeyFile(JSON.stringify(value)) ?? "",
    });

  const file = () => path.join(dir, "keys.json.enc");

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "key-file-"));
    decryptions.count = 0;
    encryption.available = true;
    log.error.mockClear();
  });
  afterEach(() => {
    fs.rmSync(dir, { force: true, recursive: true });
  });

  it("logs once and stops decrypting it on every read", () => {
    fs.writeFileSync(file(), Buffer.from("theirs:{}").toString("base64"));
    const store = open();

    for (let read = 0; read < 50; read += 1) {
      expect(store.get("token")).toBeUndefined();
    }

    expect(log.error).toHaveBeenCalledTimes(1);
    expect(log.error.mock.calls[0]?.[0]).toMatch(
      /^Can't read the test store, so its sign-ins read as gone/,
    );
    expect(decryptions.count).toBe(1);
  });

  it("is left in place until a save writes over it, which reads back", () => {
    const theirs = Buffer.from('theirs:{"token":"t0"}').toString("base64");
    fs.writeFileSync(file(), theirs);
    const store = open();
    store.get("token");
    expect(fs.readFileSync(file(), "utf8")).toBe(theirs);

    store.set("token", "t1");

    expect(store.get("token")).toBe("t1");
    expect(log.error).toHaveBeenCalledTimes(1);
  });

  it("is read again once the file changes", () => {
    fs.writeFileSync(file(), Buffer.from("theirs:{}").toString("base64"));
    const store = open();
    store.get("token");

    fs.writeFileSync(
      file(),
      Buffer.from('ours:{"token":"t2"}').toString("base64"),
    );

    expect(store.get("token")).toBe("t2");
  });

  it("reads a file again once encryption becomes available", () => {
    open().set("token", "kept");
    encryption.available = false;
    const store = open();
    expect(store.get("token")).toBeUndefined();
    encryption.available = true;
    expect(store.get("token")).toBe("kept");
  });
});
