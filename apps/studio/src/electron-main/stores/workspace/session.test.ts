import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dir = vi.hoisted(() => ({ value: "" }));

// A packaged build's path: safeStorage stands in as a reversible base64 so the
// test reads what the store wrote.
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
  workspaceSettingsDir: () => dir.value,
}));
vi.mock("@/electron-main/lib/electron-logger", () => ({
  logger: { error: vi.fn() },
}));
vi.mock("@/electron-main/rpc/publisher", () => ({
  publisher: { publish: vi.fn() },
}));

function writeEncrypted(value: unknown) {
  fs.writeFileSync(
    path.join(dir.value, "session.json.enc"),
    Buffer.from(JSON.stringify(value), "utf8").toString("base64"),
  );
}

function readEncrypted(): unknown {
  return JSON.parse(
    Buffer.from(
      fs.readFileSync(path.join(dir.value, "session.json.enc"), "utf8"),
      "base64",
    ).toString("utf8"),
  );
}

beforeEach(() => {
  dir.value = fs.mkdtempSync(path.join(os.tmpdir(), "session-store-"));
  vi.resetModules();
});

afterEach(() => {
  fs.rmSync(dir.value, { force: true, recursive: true });
});

describe("session store", () => {
  it("drops keys it does not know from the file when it opens", async () => {
    writeEncrypted({
      apiBearerToken: "bearer",
      providerAccessToken: "google-access",
      providerRefreshToken: "google-refresh",
    });
    const { getSessionStore } = await import("./session");

    expect(getSessionStore().store).toEqual({ apiBearerToken: "bearer" });
    expect(readEncrypted()).toEqual({ apiBearerToken: "bearer" });
  });

  it("keeps the old keys out of later writes", async () => {
    writeEncrypted({ apiBearerToken: "bearer", providerIdToken: "id" });
    const { getSessionStore } = await import("./session");

    getSessionStore().set("apiBearerToken", "next");

    expect(readEncrypted()).toEqual({ apiBearerToken: "next" });
  });

  it("reads another workspace's bearer token without opening its store", async () => {
    writeEncrypted({ apiBearerToken: "elsewhere" });
    const { readBearerTokenIn } = await import("./session");

    expect(readBearerTokenIn(dir.value)).toBe("elsewhere");
    expect(readBearerTokenIn(path.join(dir.value, "missing"))).toBeNull();
  });
});
