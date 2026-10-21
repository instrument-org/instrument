import { AIGatewayModelURI } from "@instrument-org/ai-gateway";
import { AIProviderConfigIdSchema } from "@instrument-org/shared";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  carrySignIns,
  type ClaudeKeychain,
  claudeKeychainService,
  isUsableDefaultModel,
  mergeAccountStores,
  mergeProviderConfigs,
  mergeSessions,
} from "./sign-in-carry";
import { createWorkspace } from "./workspace-management";

// A packaged build's path: safeStorage stands in as a reversible base64 so the
// test reads what the carry wrote.
vi.mock("@electron-toolkit/utils", () => ({ is: { dev: false } }));
vi.mock("electron", () => ({
  default: {},
  safeStorage: {
    decryptString: (buffer: Buffer) => {
      const text = buffer.toString("utf8");
      if (!text.startsWith("{")) {
        throw new Error("Not this computer's key");
      }
      return text;
    },
    encryptString: (text: string) => Buffer.from(text, "utf8"),
    isEncryptionAvailable: () => true,
  },
}));

describe("the merge rules", () => {
  it("adds the accounts the opened workspace lacks, keeping its own on a tie", () => {
    expect(
      mergeAccountStores(
        {
          hostId: "theirs",
          registrations: {
            a: { id: "a", refreshToken: "their a" },
          },
        },
        {
          hostId: "ours",
          registrations: {
            a: { id: "a", refreshToken: "our a" },
            b: { id: "b", refreshToken: "our b" },
          },
          signInSetup: { served: true },
        },
      ),
    ).toMatchInlineSnapshot(`
      {
        "hostId": "theirs",
        "registrations": {
          "a": {
            "id": "a",
            "refreshToken": "their a",
          },
          "b": {
            "id": "b",
            "refreshToken": "our b",
          },
        },
        "signInSetup": {
          "served": true,
        },
      }
    `);
  });

  it("adds keys by provider config id, keeping what each side turned off", () => {
    expect(
      mergeProviderConfigs(
        {
          disabled: ["k1"],
          providers: [{ apiKey: "their k1", id: "k1" }],
        },
        {
          disabled: ["k1", "k3"],
          providers: [
            { apiKey: "our k1", id: "k1" },
            { apiKey: "our k2", id: "k2" },
            { apiKey: "our k3", id: "k3" },
          ],
        },
      ),
    ).toMatchInlineSnapshot(`
      {
        "disabled": [
          "k1",
          "k3",
        ],
        "providers": [
          {
            "apiKey": "their k1",
            "id": "k1",
          },
          {
            "apiKey": "our k2",
            "id": "k2",
          },
          {
            "apiKey": "our k3",
            "id": "k3",
          },
        ],
      }
    `);
  });

  it("adds an Instrument sign-in for each server the opened workspace has none for", () => {
    expect(
      mergeSessions(
        { apiBearerTokens: { "https://api.example": "theirs" } },
        {
          apiBearerTokens: {
            "https://api.example": "ours",
            "https://staging.api.example": "ours on staging",
          },
        },
      ),
    ).toMatchInlineSnapshot(`
      {
        "apiBearerTokens": {
          "https://api.example": "theirs",
          "https://staging.api.example": "ours on staging",
        },
      }
    `);
  });

  it("keeps an earlier build's one sign-in whole", () => {
    const target = { apiBearerToken: "theirs, from before origins" };
    expect(
      mergeSessions(target, {
        apiBearerTokens: { "https://api.example": "ours" },
      }),
    ).toBe(target);
  });

  it("is the same merge however often it runs", () => {
    const target = { registrations: { a: { id: "a" } } };
    const source = { registrations: { b: { id: "b" } } };
    const once = mergeAccountStores(target, source);
    expect(mergeAccountStores(once, source)).toEqual(once);
  });
});

describe("isUsableDefaultModel", () => {
  const uri = AIGatewayModelURI.fromModel({
    author: "openai",
    canonicalId: AIGatewayModelURI.CanonicalIdSchema.parse("gpt-5"),
    params: {
      provider: "chatgpt-account",
      providerConfigId: AIProviderConfigIdSchema.parse("acct-1"),
    },
  });

  it.each([
    ["no model", undefined, ["acct-1"], false],
    ["a model with its connection", uri, ["acct-1"], true],
    ["a model whose connection is gone", uri, ["acct-2"], false],
    ["something that isn't a model", "not a uri", ["acct-1"], false],
  ])("%s", (_, stored, connections, usable) => {
    expect(isUsableDefaultModel(stored, new Set(connections))).toBe(usable);
  });
});

describe("carrySignIns", () => {
  let userDataDir: string;
  let fromMachineDir: string;

  const encrypted = (value: unknown) =>
    Buffer.from(JSON.stringify(value), "utf8").toString("base64");
  const decrypted = (file: string): unknown =>
    JSON.parse(Buffer.from(fs.readFileSync(file, "utf8"), "base64").toString());

  /** A fake keychain, by service name, as Claude Code files items. */
  function fakeKeychain(items: Record<string, string> = {}) {
    const keychain: ClaudeKeychain = {
      read: (dir) => {
        const secret = items[claudeKeychainService(dir)];
        return secret === undefined
          ? undefined
          : { account: "mac-user", secret };
      },
      write: (dir, { secret }) => {
        items[claudeKeychainService(dir)] = secret;
      },
    };
    return { items, keychain };
  }

  function opened() {
    return createWorkspace({
      color: "teal",
      copySignInsFrom: null,
      developerMode: false,
      name: "Opened",
      userDataDir,
    });
  }

  const machineDirOf = (workspace: { id: string }) =>
    path.join(userDataDir, "machine", workspace.id);

  function write(file: string, text: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }

  beforeEach(() => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sign-in-carry-"));
    fromMachineDir = path.join(userDataDir, "machine", "default");
  });

  afterEach(() => {
    fs.rmSync(userDataDir, { force: true, recursive: true });
  });

  it("brings setup's accounts, key and model into a workspace that has none", () => {
    const model = AIGatewayModelURI.fromModel({
      author: "openai",
      canonicalId: AIGatewayModelURI.CanonicalIdSchema.parse("gpt-5"),
      params: { provider: "openai", providerConfigId: AIProviderConfigIdSchema.parse("k1") },
    });
    write(
      path.join(fromMachineDir, "keys", "providers.json.enc"),
      encrypted({ disabled: [], providers: [{ apiKey: "sk", id: "k1" }] }),
    );
    write(
      path.join(fromMachineDir, "keys", "chatgpt-account.json.enc"),
      encrypted({ registrations: { a: { id: "a", refreshToken: "r" } } }),
    );
    write(
      path.join(fromMachineDir, "claude-account", ".claude.json"),
      JSON.stringify({ machineID: "ours", oauthAccount: { email: "e" } }),
    );
    const { items, keychain } = fakeKeychain({
      [claudeKeychainService(path.join(fromMachineDir, "claude-account"))]:
        "our claude",
    });
    const workspace = opened();
    const to = machineDirOf(workspace);
    write(
      path.join(to, "claude-account", ".claude.json"),
      JSON.stringify({ machineID: "theirs" }),
    );

    const done = carrySignIns({
      fromMachineDir,
      keychain,
      model,
      userDataDir,
      workspace,
    });

    expect(done).toMatchInlineSnapshot(`
      [
        "brought chatgpt-account.json.enc in",
        "brought providers.json.enc in",
        "brought the Claude account in",
        "set the main model chosen in setup",
      ]
    `);
    expect(
      decrypted(path.join(to, "keys", "providers.json.enc")),
    ).toMatchInlineSnapshot(`
      {
        "disabled": [],
        "providers": [
          {
            "apiKey": "sk",
            "id": "k1",
          },
        ],
      }
    `);
    expect(
      decrypted(path.join(to, "keys", "chatgpt-account.json.enc")),
    ).toMatchInlineSnapshot(`
      {
        "registrations": {
          "a": {
            "id": "a",
            "refreshToken": "r",
          },
        },
      }
    `);
    expect(
      JSON.parse(
        fs.readFileSync(
          path.join(to, "claude-account", ".claude.json"),
          "utf8",
        ),
      ),
    ).toMatchInlineSnapshot(`
      {
        "machineID": "theirs",
        "oauthAccount": {
          "email": "e",
        },
      }
    `);
    expect(items[claudeKeychainService(path.join(to, "claude-account"))]).toBe(
      "our claude",
    );
    expect(
      JSON.parse(fs.readFileSync(path.join(to, "preferences.json"), "utf8"))
        .defaultModelURI,
    ).toBe(model);
  });

  it("keeps the opened workspace's Claude account and a model it can run", () => {
    const theirs = AIGatewayModelURI.fromModel({
      author: "anthropic",
      canonicalId: AIGatewayModelURI.CanonicalIdSchema.parse("claude"),
      params: {
        provider: "claude-account",
        providerConfigId: AIProviderConfigIdSchema.parse("claude-account"),
      },
    });
    write(
      path.join(fromMachineDir, "claude-account", ".credentials.json"),
      "our claude",
    );
    const workspace = opened();
    const to = machineDirOf(workspace);
    write(path.join(to, "claude-account", ".credentials.json"), "their claude");
    const preferences = path.join(to, "preferences.json");
    write(preferences, JSON.stringify({ defaultModelURI: theirs }));

    const done = carrySignIns({
      fromMachineDir,
      keychain: undefined,
      model: AIGatewayModelURI.fromModel({
        author: "openai",
        canonicalId: AIGatewayModelURI.CanonicalIdSchema.parse("gpt-5"),
        params: { provider: "openai", providerConfigId: AIProviderConfigIdSchema.parse("k1") },
      }),
      userDataDir,
      workspace,
    });

    expect(done).toEqual([]);
    expect(
      fs.readFileSync(
        path.join(to, "claude-account", ".credentials.json"),
        "utf8",
      ),
    ).toBe("their claude");
    expect(JSON.parse(fs.readFileSync(preferences, "utf8"))).toEqual({
      defaultModelURI: theirs,
    });
  });

  it("never writes over a key store it can't read", () => {
    write(
      path.join(fromMachineDir, "keys", "providers.json.enc"),
      encrypted({ providers: [{ id: "k1" }] }),
    );
    const workspace = opened();
    const file = path.join(
      machineDirOf(workspace),
      "keys",
      "providers.json.enc",
    );
    write(file, "another computer's ciphertext");

    const done = carrySignIns({
      fromMachineDir,
      keychain: undefined,
      model: undefined,
      userDataDir,
      workspace,
    });

    expect(done).toEqual(["left providers.json.enc alone: it can't be read"]);
    expect(fs.readFileSync(file, "utf8")).toBe("another computer's ciphertext");
  });
});
