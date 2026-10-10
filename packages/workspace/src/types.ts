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
import { type TaskId, TaskIdSchema } from "./schemas/task-id";
import { type WebSearchClient } from "./schemas/web-search";

export interface BrowserConfig {
  closeTarget: (targetId: BrowserTargetId) => Promise<void>;
  createTarget: (
    id: TaskId,
    sessionId: StoreId.Session,
    partitionDir: AbsolutePath,
  ) => Promise<{ targetId: BrowserTargetId }>;
  getTargetMeta: (targetId: BrowserTargetId) => null | {
    id: TaskId;
    partitionDir: AbsolutePath;
    sessionId: StoreId.Session;
  };
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
  listTargets: (id: TaskId) => Promise<BrowserTarget[]>;
  /**
   * Told just before a blank guest is navigated back to the page its tab was
   * last on (`restoreLastPage`), so the browser's history can tell reopening
   * a page from visiting it.
   */
  noteRestore?: (targetId: BrowserTargetId, url: string) => void;
  /**
   * Whether ads and trackers are blocked in this task's tabs: off when the
   * person turned blocking off for the workspace, or when the task set
   * `blocking: false` for itself. The task's setting lasts until the app quits
   * and never touches the person's.
   */
  contentBlocking: (
    id: TaskId,
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

// The bridge routing key for a single browser view: a (id, sessionId)
// tuple encoded as `${id}/${sessionId}`. The schema delegates to the
// existing TaskId and StoreId.Session validators so a parse failure
// pinpoints the offending half. Use `encodeBrowserTargetId` /
// `decodeBrowserTargetId` to construct or parse one; never build by hand.
export const BrowserTargetIdSchema = z
  .custom<`${TaskId}/${StoreId.Session}`>()
  .superRefine((val, ctx) => {
    if (typeof val !== "string") {
      ctx.addIssue({
        code: "custom",
        fatal: true,
        input: val,
        message: "BrowserTargetId must be a string",
      });
      return;
    }
    const slash = val.indexOf("/");
    if (slash <= 0 || slash === val.length - 1) {
      ctx.addIssue({
        code: "custom",
        fatal: true,
        input: val,
        message:
          "BrowserTargetId must be `${id}/${sessionId}` with both halves non-empty",
      });
      return;
    }
    const taskIdResult = TaskIdSchema.safeParse(val.slice(0, slash));
    if (!taskIdResult.success) {
      for (const issue of taskIdResult.error.issues) {
        ctx.addIssue({ ...issue, path: ["id", ...issue.path] });
      }
    }
    const sessionResult = StoreId.SessionSchema.safeParse(val.slice(slash + 1));
    if (!sessionResult.success) {
      for (const issue of sessionResult.error.issues) {
        ctx.addIssue({ ...issue, path: ["sessionId", ...issue.path] });
      }
    }
  })
  .brand("BrowserTargetId");

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
   */
  oauth?: {
    redirectUrl: () => string;
    store: McpOAuthStore;
  };
}

export interface WorkspaceConfig {
  apps: WorkspaceAppsConfig;
  appsDir: AbsolutePath;
  appVersion: string;
  browser: BrowserConfig;
  captureException: CaptureExceptionFunction;
  defaultTaskTemplateDir: AbsolutePath;
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
  // Read per invocation rather than captured at boot: the flag is a live store
  // the user can toggle from Settings, and this config is built once.
  isExternalBrowserEnabled: () => boolean;
  modelCache: ModelCache;
  nodeExecEnv: Record<string, string>;
  /**
   * The paths a native command (node, python-native, uv, pnpm, ffmpeg, git,
   * osascript) may not read or write, enforced with Seatbelt on macOS. A
   * plain list, because native commands run in the bash worker, which is sent
   * a snapshot of the config with each command. Absent, native commands run
   * unwrapped, as they do off macOS.
   */
  nativeSandboxPlaces?: readonly string[];
  pnpmBinPath: AbsolutePath;
  // Where the skills the app ships are prepared for use. They cannot run from
  // the bundle -- it is signed, notarized, and replaced wholesale by the updater,
  // so nothing may write a `node_modules` there -- so they are materialized once
  // per machine here instead. Outside the workspace deliberately: several
  // workspaces, or a workspace the user moves, all source from one prepared set.
  preparedSkillsDir: AbsolutePath;
  registryDir: AbsolutePath;
  rootDir: WorkspaceDir;
  systemSkillsDir: AbsolutePath;
  tasksDir: AbsolutePath;
  trashItem: (path: AbsolutePath) => Promise<void>;
  // Path to the bundled `uv` binary (escape hatch for python/pip/uv commands).
  uvBinPath: AbsolutePath;
  // The bundled Mac helper behind the `calendar` and `contacts` commands and
  // iCloud Drive's app folders; absent off macOS and in builds that do not carry it.
  macHelperBinPath?: AbsolutePath;
  // Where the system keeps the person's own folders, which is not always under
  // the home folder by its English name: Windows moves Desktop and Documents
  // into OneDrive, and Linux names them in the desktop's language.
  knownFolders?: Record<KnownFolder, string>;
  // Base dir for uv's isolated cache/python-install/tool dirs. Lives under the
  // app's userData so a sandboxed `HOME=/` never sends uv writing to the host.
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

export function decodeBrowserTargetId(
  targetId: string,
): null | { id: TaskId; sessionId: StoreId.Session } {
  const result = BrowserTargetIdSchema.safeParse(targetId);
  if (!result.success) {
    return null;
  }
  const slash = result.data.indexOf("/");
  return {
    id: result.data.slice(0, slash) as TaskId,
    sessionId: result.data.slice(slash + 1) as StoreId.Session,
  };
}

export function encodeBrowserTargetId(
  id: TaskId,
  sessionId: StoreId.Session,
): BrowserTargetId {
  return BrowserTargetIdSchema.parse(`${id}/${sessionId}`);
}
