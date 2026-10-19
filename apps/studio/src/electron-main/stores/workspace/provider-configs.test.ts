import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AIProviderConfigIdSchema } from "@instrument-org/shared";
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
  logger: { error: vi.fn(), warn: vi.fn() },
}));
vi.mock("@/electron-main/rpc/publisher", () => ({
  publisher: { publish: vi.fn() },
}));
vi.mock("@/electron-main/platform-api/utils", () => ({ getToken: () => null }));
vi.mock("@/electron-main/lib/chatgpt-account", () => ({
  chatGPTAccountProviderConfigs: () => [
    { cacheIdentifier: "c", id: "acct-1", type: "chatgpt-account" },
  ],
}));
vi.mock("@/electron-main/lib/claude-account", () => ({
  claudeAccountProviderConfigs: () => [],
}));

const KEY = {
  apiKey: "sk-or-1",
  cacheIdentifier: "x",
  id: "key-1",
  type: "openrouter",
};

function writeEncrypted(value: unknown) {
  fs.writeFileSync(
    path.join(dir.value, "providers.json.enc"),
    Buffer.from(JSON.stringify(value), "utf8").toString("base64"),
  );
}

async function load() {
  const store = await import("./provider-configs");
  const configs = await import("@/electron-main/lib/get-ai-provider-configs");
  return { ...store, ...configs };
}

const ids = (configs: { id: string }[]) => configs.map(({ id }) => id);

describe("turning a provider off", () => {
  beforeEach(() => {
    vi.resetModules();
    dir.value = fs.mkdtempSync(path.join(os.tmpdir(), "provider-configs-"));
  });

  afterEach(() => {
    fs.rmSync(dir.value, { force: true, recursive: true });
  });

  it("reads a file from before the switch existed with everything on", async () => {
    writeEncrypted({ providers: [KEY] });
    const { getAIProviderConfigs, getDisabledProviderConfigIds } = await load();

    expect([...getDisabledProviderConfigIds()]).toEqual([]);
    expect(ids(getAIProviderConfigs())).toEqual(["key-1", "acct-1"]);
  });

  it("keeps the saved keys when the list of what is off is unreadable", async () => {
    writeEncrypted({ disabled: "nonsense", providers: [KEY] });
    const { getAllAIProviderConfigs } = await load();

    expect(ids(getAllAIProviderConfigs())).toEqual(["key-1", "acct-1"]);
  });

  it("leaves a turned-off key or account out of every model path, and keeps it listed for Settings", async () => {
    writeEncrypted({ providers: [KEY] });
    const {
      getAIProviderConfigs,
      getAllAIProviderConfigs,
      setProviderConfigEnabled,
    } = await load();

    setProviderConfigEnabled(AIProviderConfigIdSchema.parse(KEY.id), false);
    setProviderConfigEnabled(AIProviderConfigIdSchema.parse("acct-1"), false);
    expect(ids(getAIProviderConfigs())).toEqual([]);
    expect(ids(getAllAIProviderConfigs())).toEqual(["key-1", "acct-1"]);

    setProviderConfigEnabled(AIProviderConfigIdSchema.parse(KEY.id), true);
    expect(ids(getAIProviderConfigs())).toEqual(["key-1"]);
  });
});
