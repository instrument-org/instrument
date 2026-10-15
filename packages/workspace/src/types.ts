import type { ProtocolMapping } from "devtools-protocol/types/protocol-mapping";

import {
  type AIGatewayEnv,
  type GetProviderConfigs,
  type ModelCache,
} from "@instrument-org/ai-gateway";
import { type CaptureExceptionFunction } from "@instrument-org/shared";
import { z } from "zod";

import { type AppConnectionStore } from "./lib/apps/connection";
import { type McpOAuthStore } from "./lib/apps/mcp/oauth-provider";
import { type StoredAppCredential } from "./lib/apps/origin-bound";
import { type FinderEntry } from "./lib/chat/finder-entries";
import { type AbsolutePath, type WorkspaceDir } from "./schemas/paths";
import { StoreId } from "./schemas/store-id";
import { type WebSearchClient } from "./schemas/web-search";

export interface BrowserConfig {
  closeTarget: (targetId: BrowserTargetId) => Promise<void>;
  createTarget: (
    targetId: BrowserTargetId,
    partitionDir: AbsolutePath,
  ) => Promise<void>;
  getTargetMeta: (
    targetId: BrowserTargetId,
  ) => null | { partitionDir: AbsolutePath };
  /**
   * The address of the document in the guest's main frame, as the main process
   * saw it arrive; undefined for a target with no live guest. What the CDP
   * bridge judges a command against, rather than the last navigation event it
   * happened to see, and never an address a page gave itself with
   * `history.pushState`.
   */
  getTargetUrl: (targetId: BrowserTargetId) => string | undefined;
  /**
   * True where there is no window behind this config, so a task should be left
   * to start a browser of its own rather than pointed at the CDP bridge.
   *
   * Only the eval harness sets it. Without it a run stubs `sendCommand` to an
   * empty object, the bridge answers `Page.navigate` with no `frameId`, and
   * every attempt a task makes to look at what it wrote dies on a protocol
   * error it can do nothing about (docs/findings/a-task-cannot-look-at-what-it-drew.md).
   */
  hasNoWindow: boolean;
  /**
   * Whether the guest is in the middle of something its page cannot get
   * back after a reload: playing sound, downloading, or open in DevTools.
   */
  isGuestBusy: (targetId: BrowserTargetId) => boolean;
  listTargets: () => Promise<BrowserTarget[]>;
  /**
   * Told just before a blank guest is navigated back to the page its tab was
   * last on (`restoreLastPage`), so the browser's history can tell reopening
   * a page from visiting it.
   */
  noteRestore?: (targetId: BrowserTargetId, url: string) => void;
  /**
   * Whether ads and trackers are blocked in the tabs an agent drives: off
   * when the person turned blocking off for the workspace, or when the agent
   * set `blocking: false` for those tabs. The agent's setting lasts until the
   * app quits and never touches the person's.
   */
  contentBlocking: (
    targets: readonly BrowserTargetId[],
    blocking?: boolean,
  ) => { task: boolean; workspace: boolean };
  onTargetDestroyed: (
    targetId: BrowserTargetId,
    listener: () => void,
  ) => () => void;
  sendCommand<M extends CdpMethod>(
    targetId: BrowserTargetId,
    method: M,
    ...args: CdpSendArgs<M>
  ): Promise<CdpReturn<M>>;
  sendCommand(
    targetId: BrowserTargetId,
    method: string,
    params: unknown,
  ): Promise<unknown>;
  /**
   * The folders on this computer the agent driving a guest can read, or null
   * once no agent is connected. While they are set, a page the agent can read
   * may not take the tab to a file outside them (a link, a script setting
   * `location`), so the agent cannot use a page of its own to open a file it
   * could not open itself.
   */
  setAgentFileRoots: (
    targetId: BrowserTargetId,
    roots: null | readonly string[],
  ) => void;
  stopScreencast: (targetId: BrowserTargetId) => void;
  subscribeEvents: (
    targetId: BrowserTargetId,
    onDetach: () => void,
    onEvent: (method: string, params: unknown) => void,
  ) => () => void;
}

export interface BrowserTarget {
  id: BrowserTargetId;
  title: string;
  type: "page";
  url: string;
}

// The bridge routing key for one browser view: the id of the window tab it
// is drawn in, which is a session id. Branded apart from a session id so a
// chat's or task's session is never taken for a tab.
export const BrowserTargetIdSchema =
  StoreId.SessionSchema.brand("BrowserTargetId");

export type BrowserTargetId = z.output<typeof BrowserTargetIdSchema>;

/**
 * What the host app keeps about apps, outside every mount: the credentials,
 * the OAuth tokens, and the connection records. The workspace reads and
 * writes them through this, never through a file the agent can reach.
 */
export interface WorkspaceAppsConfig {
  connections: AppConnectionStore;
  /** Take an app's credential, tokens, and connection away, and tell the UI. */
  disconnect: (slug: string) => Promise<void>;
  /**
   * The app's stored key with the origin it was saved for. The workspace
   * sends it only to that origin.
   */
  getCredential: (slug: string) => Promise<null | StoredAppCredential>;
  /**
   * Present in the desktop app: backs OAuth MCP apps with the app's encrypted
   * store. Optional so headless and test contexts run without sign-in. The
   * redirect URL is read per sign-in, from the port the callback server bound.
   * The relay redirect is where a vendor sends back a sign-in made with
   * Instrument's own client for `service`, on its way to that same port.
   */
  oauth?: {
    redirectUrl: () => string;
    relayRedirectUrl: (service: string) => string;
    store: McpOAuthStore;
  };
}

export interface WorkspaceConfig {
  apps: WorkspaceAppsConfig;
  appsDir: AbsolutePath;
  /**
   * The file this workspace's record of the model requests it made is kept
   * in, inside the workspace's own `.instrument` folder. Absent where nothing
   * should persist (tests, scripts), and then nothing is recorded.
   */
  aiUsageFile?: AbsolutePath;
  appVersion: string;
  browser: BrowserConfig;
  captureException: CaptureExceptionFunction;
  chatTemplateDir: AbsolutePath;
  /**
   * What the system's file manager calls each drive at `roots` (`C:\`), by
   * its root, for the Files sidebar's Locations: "Local Disk (C:)" on
   * Windows. Answers within a moment with what it knows, so the sidebar never
   * waits on the system; a root it does not name yet goes by its letter.
   * Absent off Windows, where a disk is named by the folder it is mounted at.
   */
  driveNames?: (roots: string[]) => Promise<Record<string, string>>;
  /** Desktop decoration after the default output folder exists. */
  ensureOutputFolderIcon?: (folderPath: string) => Promise<void>;
  /**
   * What the Finder knows about a folder's entries beyond what `stat` says
   * (packages, hidden extensions, hidden entries), for the file browser's
   * listing. Absent off macOS and in builds without the Mac module.
   */
  finderEntries?: (folder: string) => Promise<FinderEntry[]>;
  /**
   * Where a Finder alias leads, for the file browser to follow one as it
   * follows a symbolic link; undefined for a path that is not an alias.
   * Absent off macOS and in builds without the Mac module.
   */
  resolveAlias?: (path: string) => Promise<string | undefined>;
  getAIProviderConfigs: GetProviderConfigs;
  /**
   * Who is signed in, for the agents to know whose work it is: the account's
   * email and, when the account gives one, name, or undefined while nobody is. Read when a session's
   * context is built rather than at boot, since a sign-in comes and goes;
   * absent altogether where there is no account to read (scripts, evals).
   */
  getUser?: () => Promise<undefined | { email: string; name?: string }>;
  /**
   * Where each workspace's index of its chats and tasks is kept: derived,
   * rebuilt from the workspace whenever it is missing or out of date, and
   * outside the workspace so a workspace in a synced folder never carries a
   * live database. Absent where nothing should persist (tests, scripts), and
   * then every read derives from the stores.
   */
  indexesDir?: AbsolutePath;
  /**
   * Replace a provider config's credential if it has already expired,
   * resolving once the replacement is in or the wait gave up. The model proxy
   * awaits it for the config a request names before reading the configs, so
   * a request made before a refresh timer fires (just after launch or a wake)
   * carries a credential the provider accepts. Absent where no credential
   * expires.
   */
  refreshExpiredCredentials?: AIGatewayEnv["Variables"]["refreshExpiredCredentials"];
  modelCache: ModelCache;
  nodeExecEnv: Record<string, string>;
  /**
   * Whether native commands (node, python, uv, pnpm, ffmpeg, git,
   * osascript) are held to Settings › Permissions with Seatbelt on macOS. A
   * plain flag, because native commands run in the bash worker, which is sent
   * a snapshot of the config with each command. Off, native commands run
   * unwrapped, as they do off macOS.
   */
  nativeSandbox?: boolean;
  pnpmBinPath: AbsolutePath;
  // Where the skills the app ships are prepared for use. They cannot run from
  // the bundle -- it is signed, notarized, and replaced wholesale by the updater,
  // so nothing may write a `node_modules` there -- so they are materialized once
  // per machine here instead. Outside the workspace deliberately: several
  // workspaces, or a workspace the user moves, all source from one prepared set.
  preparedSkillsDir: AbsolutePath;
  registryDir: AbsolutePath;
  rootDir: WorkspaceDir;
  // Where every chat's folder is, `chats/` under the root.
  chatsDir: AbsolutePath;
  systemSkillsDir: AbsolutePath;
  // Where 1.x kept its tasks, `tasks/` under the root: what the 1.x
  // migration reads, and names a new chat stays clear of while a folder
  // there waits to move.
  legacyTasksDir: AbsolutePath;
  /**
   * The system's temp folders, which the agent writes with no card. Absent,
   * they are the system's own (`/tmp`, `/var/tmp` and `os.tmpdir()`). A test
   * names none: its fixtures live in the system's temp folder and stand for
   * folders outside every one the agent reaches.
   */
  tempFolders?: readonly AbsolutePath[];
  trashItem: (path: AbsolutePath) => Promise<void>;
  // Path to the bundled `uv` binary (escape hatch for python/pip/uv commands).
  uvBinPath: AbsolutePath;
  // The bundled uutils binaries (`coreutils`, `find`, `xargs`, `diffutils`,
  // `grep`) that answer the shell's GNU text commands natively; absent, those
  // commands stay the shell's own.
  uutilsDir?: AbsolutePath;
  // The bundled Mac helper behind the `calendar` and `contacts` commands and
  // iCloud Drive's app folders; absent off macOS and in builds that do not carry it.
  macHelperBinPath?: AbsolutePath;
  // The Seatbelt launcher (`instrument-seatbelt`) native commands start
  // through on macOS, applying a profile compiled once per set of rules;
  // absent, they start through sandbox-exec.
  seatbeltHelperPath?: AbsolutePath;
  // Where the system keeps the person's own folders, which is not always under
  // the home folder by its English name: Windows moves Desktop and Documents
  // into OneDrive, and Linux names them in the desktop's language.
  knownFolders?: Record<KnownFolder, string>;
  // The app's folder on PATH that links `node`, `pnpm`, `uv` and the rest,
  // which a package script or bin shim finds `node` through. Native commands
  // may read it whatever the rules say about the folder it sits in.
  toolBinDir?: AbsolutePath;
  // Base dir for uv's isolated cache/python-install/tool dirs. Lives under the
  // app's userData so uv never writes into the person's home.
  uvDataDir: AbsolutePath;
  webSearch: WebSearchClient;
}
export type KnownFolder =
  | "desktop"
  | "documents"
  | "downloads"
  | "music"
  | "pictures"
  | "videos";
type CdpMethod = keyof ProtocolMapping.Commands;
type CdpParams<M extends CdpMethod> = ProtocolMapping.Commands[M]["paramsType"];

type CdpReturn<M extends CdpMethod> = ProtocolMapping.Commands[M]["returnType"];

// CDP commands declare paramsType as a (possibly empty) tuple where the only
// element may be optional. Map that to overloaded call signatures so callers
// either omit params (no-arg or all-optional commands) or pass a typed object.
type CdpSendArgs<M extends CdpMethod> =
  CdpParams<M> extends []
    ? []
    : CdpParams<M> extends [infer P]
      ? [params: P]
      : CdpParams<M> extends [(infer P)?]
        ? [params?: P]
        : never;

/** The browser view drawn in the window tab with this id. */
export function browserTargetOf(tabId: StoreId.Session): BrowserTargetId {
  return BrowserTargetIdSchema.parse(tabId);
}

/** A browser view's id from a string that may not be one, or null. */
export function parseBrowserTargetId(value: string): BrowserTargetId | null {
  const result = BrowserTargetIdSchema.safeParse(value);
  return result.success ? result.data : null;
}
