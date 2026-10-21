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
  workspaceKeysDir: () => dir.value,
}));
vi.mock("@/electron-main/lib/electron-logger", () => ({
  logger: { error: vi.fn() },
}));
vi.mock("@/electron-main/rpc/publisher", () => ({
  publisher: { publish: vi.fn() },
}));
vi.stubEnv("MAIN_VITE_APP_API_BASE_URL", "https://api.example/");

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
      apiBearerTokens: { "https://api.example": "bearer" },
      providerAccessToken: "google-access",
      providerRefreshToken: "google-refresh",
    });
    const { getSessionStore } = await import("./session");

    expect(getSessionStore().store).toEqual({
      apiBearerTokens: { "https://api.example": "bearer" },
    });
    expect(readEncrypted()).toEqual({
      apiBearerTokens: { "https://api.example": "bearer" },
    });
  });

  it("keeps the old keys out of later writes", async () => {
    writeEncrypted({ apiBearerTokens: {}, providerIdToken: "id" });
    const { getSessionStore, setSessionToken } = await import("./session");
    getSessionStore();

    setSessionToken("https://api.example", "next");

    expect(readEncrypted()).toEqual({
      apiBearerTokens: { "https://api.example": "next" },
    });
  });

  it("moves an earlier build's one token under the build's own server", async () => {
    writeEncrypted({ apiBearerToken: "bearer" });
    const { getSessionStore, getSessionToken } = await import("./session");

    expect(getSessionToken("https://api.example")).toBe("bearer");
    expect(getSessionStore().store).toEqual({
      apiBearerTokens: { "https://api.example": "bearer" },
    });
    expect(readEncrypted()).toEqual({
      apiBearerTokens: { "https://api.example": "bearer" },
    });
  });

  it("keeps a token already kept for the build's server over an earlier build's", async () => {
    writeEncrypted({
      apiBearerToken: "older",
      apiBearerTokens: { "https://api.example": "newer" },
    });
    const { getSessionToken } = await import("./session");

    expect(getSessionToken("https://api.example")).toBe("newer");
  });

  it("keeps each server's sign-in apart", async () => {
    const { forgetSessionToken, getSessionToken, setSessionToken } =
      await import("./session");

    setSessionToken("https://api.example", "production");
    setSessionToken("https://staging.example", "staging");
    forgetSessionToken("https://api.example");

    expect(getSessionToken("https://api.example")).toBeUndefined();
    expect(getSessionToken("https://staging.example")).toBe("staging");
    expect(readEncrypted()).toEqual({
      apiBearerTokens: { "https://staging.example": "staging" },
    });
  });

  it("reads another workspace's bearer tokens without opening its store", async () => {
    writeEncrypted({
      apiBearerToken: "elsewhere",
      apiBearerTokens: { "https://staging.example": "staging" },
    });
    const { readBearerTokensIn } = await import("./session");

    expect(readBearerTokensIn(dir.value)).toEqual({
      "https://api.example": "elsewhere",
      "https://staging.example": "staging",
    });
    expect(readBearerTokensIn(path.join(dir.value, "missing"))).toEqual({});
  });
});
