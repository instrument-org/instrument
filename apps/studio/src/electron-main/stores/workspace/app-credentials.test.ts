import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const dir = vi.hoisted(() => ({ value: "" }));

vi.mock("@electron-toolkit/utils", () => ({ is: { dev: false } }));
vi.mock("electron", () => ({
  default: {},
  safeStorage: {
    decryptString: (buffer: Buffer) => buffer.toString("utf8"),
    encryptString: (text: string) => Buffer.from(text, "utf8"),
    isEncryptionAvailable: () => true,
  },
}));
vi.mock("@/electron-main/lib/get-workspace-folder", () => ({
  workspaceKeysDir: () => dir.value,
}));
vi.mock("@/electron-main/lib/electron-logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn() },
}));

const origin = "https://api.example.com";

beforeEach(() => {
  dir.value = fs.mkdtempSync(path.join(os.tmpdir(), "app-credentials-"));
  vi.resetModules();
});

afterEach(() => {
  fs.rmSync(dir.value, { force: true, recursive: true });
});

function write(credentials: object) {
  fs.writeFileSync(
    path.join(dir.value, "app-credentials.json.enc"),
    Buffer.from(JSON.stringify({ credentials }), "utf8").toString("base64"),
  );
}

it("reads a key saved before dates were kept", async () => {
  write({ notes: { origin, value: "k3y" } });
  const store = await import("./app-credentials");
  expect(store.getAppCredentials("notes")).toEqual([{ origin, value: "k3y" }]);
});

it("keeps an app's keys apart, and from an app whose slug starts the same", async () => {
  const store = await import("./app-credentials");
  store.setAppCredentials("notes", [
    { label: "API key", origin, savedAt: 1, value: "one" },
    { label: "Key/secret", origin, savedAt: 1, value: "two" },
  ]);
  store.setAppCredentials("notes-2", [{ origin, savedAt: 1, value: "other" }]);
  store.setAppCredentials("notes", [
    { label: "API key", origin, savedAt: 2, value: "new" },
  ]);

  expect(store.getAppCredentials("notes")).toEqual([
    { label: "API key", origin, savedAt: 2, value: "new" },
    { label: "Key/secret", origin, savedAt: 1, value: "two" },
  ]);
  store.removeAppCredentials("notes");
  expect(store.getAppCredentials("notes")).toEqual([]);
  expect(store.getAppCredentials("notes-2")).toHaveLength(1);
});
