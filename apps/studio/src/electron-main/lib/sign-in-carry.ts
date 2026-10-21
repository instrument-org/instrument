import {
  decodeKeyFile,
  encodeKeyFile,
  KEY_STORE_NAMES,
  keyFileName,
} from "@/electron-main/lib/key-file";
import {
  MACHINE_DATA_FORMAT_VERSION,
  machineDirOwnedBy,
  openElsewhereBy,
  readWorkspaceIdentity,
  settleWorkspace,
  workspaceMachineDirOf,
} from "@/electron-main/lib/workspaces";
import { AIGatewayModelURI } from "@instrument-org/ai-gateway";
import {
  CLAUDE_ACCOUNT_PROVIDER_CONFIG,
  OUR_PROVIDER_CONFIG,
  WORKSPACE_MACHINE_ENTRIES,
} from "@instrument-org/shared";
import { workspaceLayout } from "@instrument-org/workspace/layout";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isEqual } from "radashi";

/**
 * Bringing the sign-ins of the workspace setup ran in into a workspace setup
 * opens in its place, so the accounts the person just connected come along.
 * What the opened workspace has wins: it gets only what it lacks, merged by
 * account, and nothing of its own is removed or replaced.
 */

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function listOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function objectOf(value: unknown): JsonObject {
  return isObject(value) ? value : {};
}

/** `source`'s keys added to `target`, `target`'s value kept on a tie. */
function withKeysAdded(target: unknown, source: unknown): JsonObject {
  return { ...objectOf(source), ...objectOf(target) };
}

/**
 * A ChatGPT or Grok account store: each registration `target` lacks, by id,
 * added after its own, and every other field `target` has kept (the host id
 * and the served sign-in setup), with `source`'s only where `target` has none.
 */
export function mergeAccountStores(
  target: JsonObject,
  source: JsonObject,
): JsonObject {
  return {
    ...withKeysAdded(target, source),
    registrations: withKeysAdded(target.registrations, source.registrations),
  };
}

function idOf(entry: unknown): unknown {
  return isObject(entry) ? entry.id : undefined;
}

/**
 * The provider keys: each key `target` lacks, by provider config id, added
 * after its own. A key added that was turned off where it came from stays
 * off; what `target` turned off stays off.
 */
export function mergeProviderConfigs(
  target: JsonObject,
  source: JsonObject,
): JsonObject {
  const own = listOf(target.providers);
  const ownIds = new Set(own.map(idOf));
  const added = listOf(source.providers).filter(
    (entry) => idOf(entry) !== undefined && !ownIds.has(idOf(entry)),
  );
  const addedIds = new Set(added.map(idOf));
  const disabled = listOf(target.disabled);
  const disabledAdded = listOf(source.disabled).filter(
    (id) => addedIds.has(id) && !disabled.includes(id),
  );
  return {
    ...withKeysAdded(target, source),
    disabled: [...disabled, ...disabledAdded],
    providers: [...own, ...added],
  };
}

/**
 * The Instrument sign-in: a token for each server `target` has none for,
 * by the server's origin. A `target` an earlier build wrote, with its one
 * token not yet filed under an origin, is signed in already and kept whole.
 */
export function mergeSessions(
  target: JsonObject,
  source: JsonObject,
): JsonObject {
  if (typeof target.apiBearerToken === "string" && target.apiBearerToken) {
    return target;
  }
  return {
    ...withKeysAdded(target, source),
    apiBearerTokens: withKeysAdded(
      target.apiBearerTokens,
      source.apiBearerTokens,
    ),
  };
}

/** The key stores carried, by store name, each with its merge. */
const KEY_STORES: [
  name: string,
  merge: (target: JsonObject, source: JsonObject) => JsonObject,
][] = [
  [KEY_STORE_NAMES.chatgptAccount, mergeAccountStores],
  [KEY_STORE_NAMES.grokAccount, mergeAccountStores],
  [KEY_STORE_NAMES.providerConfigs, mergeProviderConfigs],
  [KEY_STORE_NAMES.session, mergeSessions],
];

type KeyStoreRead =
  | { kind: "missing" }
  | { kind: "read"; value: JsonObject }
  | { kind: "unreadable" };

function readKeyStore(file: string): KeyStoreRead {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return { kind: "missing" };
  }
  // An empty file is what a store writes where there is no keyring.
  if (text === "") {
    return { kind: "read", value: {} };
  }
  try {
    const value: unknown = JSON.parse(decodeKeyFile(text));
    return isObject(value) ? { kind: "read", value } : { kind: "unreadable" };
  } catch {
    return { kind: "unreadable" };
  }
}

function writeAtomic(file: string, text: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid.toString()}`;
  fs.writeFileSync(temporary, text, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

/**
 * Each key store in `fromKeys` merged into the one in `toKeys`. A store that
 * can't be read on either side is left alone, so a file this computer can't
 * decrypt is never written over.
 */
function carryKeyStores(fromKeys: string, toKeys: string, done: string[]) {
  for (const [name, merge] of KEY_STORES) {
    const file = keyFileName(name);
    const source = readKeyStore(path.join(fromKeys, file));
    if (source.kind !== "read") {
      continue;
    }
    const target = readKeyStore(path.join(toKeys, file));
    if (target.kind === "unreadable") {
      done.push(`left ${file} alone: it can't be read`);
      continue;
    }
    const current = target.kind === "read" ? target.value : {};
    const merged = merge(current, source.value);
    if (target.kind === "read" && isEqual(merged, current)) {
      continue;
    }
    const encoded = encodeKeyFile(JSON.stringify(merged));
    if (encoded === undefined) {
      done.push(`left ${file} alone: there is no keyring to encrypt with`);
      continue;
    }
    writeAtomic(path.join(toKeys, file), encoded);
    done.push(`brought ${file} in`);
  }
}

/**
 * Where Claude Code keeps the credential of a config folder outside it: on
 * macOS, a keychain item named for the folder's path. Elsewhere it is
 * `.credentials.json` in the folder, which a copy of the folder carries.
 */
export interface ClaudeKeychain {
  read: (configDir: string) => undefined | { account: string; secret: string };
  write: (configDir: string, item: { account: string; secret: string }) => void;
}

/** The service Claude Code files a config folder's credential under. */
export function claudeKeychainService(configDir: string): string {
  const hash = createHash("sha256").update(configDir).digest("hex");
  return `Claude Code-credentials-${hash.slice(0, 8)}`;
}

/**
 * The login keychain through `security`, as Claude Code reads and writes it,
 * so the item stays one Claude Code opens without asking. The secret goes in
 * on standard input, never on a command line.
 */
export const macClaudeKeychain: ClaudeKeychain = {
  read: (configDir) => {
    const service = claudeKeychainService(configDir);
    try {
      const attributes = execFileSync(
        "security",
        ["find-generic-password", "-s", service],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      );
      const account = /"acct"<blob>="([^"]*)"/.exec(attributes)?.[1];
      const secret = execFileSync(
        "security",
        ["find-generic-password", "-s", service, "-w"],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      ).replace(/\n$/, "");
      return account === undefined || secret === ""
        ? undefined
        : { account, secret };
    } catch {
      return undefined;
    }
  },
  write: (configDir, { account, secret }) => {
    const hex = Buffer.from(secret, "utf8").toString("hex");
    execFileSync("security", ["-i"], {
      input: `add-generic-password -U -a ${JSON.stringify(account)} -s ${JSON.stringify(claudeKeychainService(configDir))} -X ${hex}\n`,
      stdio: ["pipe", "ignore", "ignore"],
    });
  },
};

const CLAUDE_CONFIG = ".claude.json";
const CLAUDE_CREDENTIALS = ".credentials.json";

function readJsonObject(file: string): JsonObject | undefined {
  try {
    const value: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    return isObject(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Whether a Claude Code config folder is signed in to an account. */
function claudeSignedIn(
  configDir: string,
  keychain: ClaudeKeychain | undefined,
): boolean {
  return (
    readJsonObject(path.join(configDir, CLAUDE_CONFIG))?.oauthAccount !==
      undefined ||
    fs.existsSync(path.join(configDir, CLAUDE_CREDENTIALS)) ||
    keychain?.read(configDir) !== undefined
  );
}

/**
 * The Claude account, which a workspace has one of: the opened workspace's
 * when it has one, ours otherwise. Ours comes as its credential and the
 * config Claude Code read it with, merged under what the folder already
 * says; the chats' transcripts beside them stay where they were made.
 */
function carryClaudeAccount(
  fromMachine: string,
  toMachine: string,
  keychain: ClaudeKeychain | undefined,
  done: string[],
) {
  const from = path.join(fromMachine, WORKSPACE_MACHINE_ENTRIES.claudeAccount);
  const to = path.join(toMachine, WORKSPACE_MACHINE_ENTRIES.claudeAccount);
  if (claudeSignedIn(to, keychain) || !claudeSignedIn(from, keychain)) {
    return;
  }
  fs.mkdirSync(to, { recursive: true });
  const config = readJsonObject(path.join(from, CLAUDE_CONFIG));
  if (config !== undefined) {
    writeAtomic(
      path.join(to, CLAUDE_CONFIG),
      `${JSON.stringify(
        withKeysAdded(readJsonObject(path.join(to, CLAUDE_CONFIG)), config),
        null,
        2,
      )}\n`,
    );
  }
  if (fs.existsSync(path.join(from, CLAUDE_CREDENTIALS))) {
    fs.copyFileSync(
      path.join(from, CLAUDE_CREDENTIALS),
      path.join(to, CLAUDE_CREDENTIALS),
    );
  }
  const item = keychain?.read(from);
  if (item !== undefined) {
    keychain?.write(to, item);
  }
  done.push("brought the Claude account in");
}

/**
 * The provider config ids a workspace's machine folder has a connection
 * for: its keys not turned off, its ChatGPT and Grok accounts still signed
 * in, the Claude account and the Instrument sign-in.
 */
function connectionIdsIn(
  machineDir: string,
  keychain: ClaudeKeychain | undefined,
): Set<unknown> {
  const keys = path.join(machineDir, WORKSPACE_MACHINE_ENTRIES.keys);
  const read = (name: string) => {
    const store = readKeyStore(path.join(keys, keyFileName(name)));
    return store.kind === "read" ? store.value : {};
  };
  const ids = new Set<unknown>();
  const providers = read(KEY_STORE_NAMES.providerConfigs);
  const disabled = listOf(providers.disabled);
  for (const entry of listOf(providers.providers)) {
    if (!disabled.includes(idOf(entry))) {
      ids.add(idOf(entry));
    }
  }
  for (const name of [
    KEY_STORE_NAMES.chatgptAccount,
    KEY_STORE_NAMES.grokAccount,
  ]) {
    for (const registration of Object.values(
      objectOf(read(name).registrations),
    )) {
      if (isObject(registration) && registration.refreshToken) {
        ids.add(registration.id);
      }
    }
  }
  const session = read(KEY_STORE_NAMES.session);
  if (
    session.apiBearerToken ||
    Object.keys(objectOf(session.apiBearerTokens)).length > 0
  ) {
    ids.add(OUR_PROVIDER_CONFIG.id);
  }
  if (
    claudeSignedIn(
      path.join(machineDir, WORKSPACE_MACHINE_ENTRIES.claudeAccount),
      keychain,
    )
  ) {
    ids.add(CLAUDE_ACCOUNT_PROVIDER_CONFIG.id);
  }
  return ids;
}

/**
 * Whether a workspace's default model is one it can run: a model URI whose
 * connection the workspace has.
 */
export function isUsableDefaultModel(
  stored: unknown,
  connections: ReadonlySet<unknown>,
): boolean {
  if (typeof stored !== "string") {
    return false;
  }
  const parsed = AIGatewayModelURI.parse(stored);
  return parsed.ok && connections.has(parsed.value.params.providerConfigId);
}

/** The main model chosen in setup, for a workspace with none it can run. */
function carryDefaultModel(
  toMachine: string,
  model: AIGatewayModelURI.Type | undefined,
  keychain: ClaudeKeychain | undefined,
  done: string[],
) {
  if (model === undefined) {
    return;
  }
  const file = path.join(toMachine, WORKSPACE_MACHINE_ENTRIES.preferences);
  const exists = fs.existsSync(file);
  const preferences = exists ? readJsonObject(file) : {};
  if (
    preferences === undefined ||
    isUsableDefaultModel(
      preferences.defaultModelURI,
      connectionIdsIn(toMachine, keychain),
    )
  ) {
    return;
  }
  writeAtomic(
    file,
    `${JSON.stringify({ ...preferences, defaultModelURI: model }, null, "\t")}\n`,
  );
  done.push("set the main model chosen in setup");
}

/**
 * Bring the sign-ins in `fromMachineDir` (the workspace setup is running in)
 * into the registered workspace setup is opening, and the main model chosen
 * in setup where it has no default it can run. Left alone, and said so in
 * what it answers: a workspace another instance has open (which would write
 * its own stores over these), one whose machine data an earlier build still
 * keeps in the workspace folder, and one whose machine folder is another
 * workspace's.
 */
export function carrySignIns({
  fromMachineDir,
  keychain,
  model,
  userDataDir,
  workspace,
}: {
  fromMachineDir: string;
  keychain: ClaudeKeychain | undefined;
  model: AIGatewayModelURI.Type | undefined;
  userDataDir: string;
  workspace: { id: string; path: string };
}): string[] {
  const done: string[] = [];
  const identity = readWorkspaceIdentity(workspace.path);
  if (identity.formatVersion < MACHINE_DATA_FORMAT_VERSION) {
    done.push(
      "left the sign-ins: the workspace's machine data isn't moved yet",
    );
    return done;
  }
  let machineDir = machineDirOwnedBy(userDataDir, workspace);
  if (machineDir === undefined) {
    const unowned = workspaceMachineDirOf(userDataDir, workspace.id);
    if (fs.existsSync(path.join(unowned, WORKSPACE_MACHINE_ENTRIES.owner))) {
      done.push("left the sign-ins: its machine folder is another workspace's");
      return done;
    }
    machineDir = settleWorkspace({ userDataDir, workspace });
  }
  if (
    openElsewhereBy(machineDir) !== null ||
    openElsewhereBy(workspaceLayout(workspace.path).dataDir) !== null
  ) {
    done.push("left the sign-ins: another instance has the workspace open");
    return done;
  }
  carryKeyStores(
    path.join(fromMachineDir, WORKSPACE_MACHINE_ENTRIES.keys),
    path.join(machineDir, WORKSPACE_MACHINE_ENTRIES.keys),
    done,
  );
  carryClaudeAccount(fromMachineDir, machineDir, keychain, done);
  carryDefaultModel(machineDir, model, keychain, done);
  return done;
}
