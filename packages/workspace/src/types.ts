import type { ProtocolMapping } from "devtools-protocol/types/protocol-mapping";

import {
  type AIGatewayEnv,
  type GetProviderConfigs,
  type ModelCache,
  type ModelRoutes,
  type ReportPlatformRefusal,
  type ReasoningEffort,
} from "@instrument-org/ai-gateway";
import { type CaptureExceptionFunction } from "@instrument-org/shared";
import { z } from "zod";

import { type AppConnectionStore } from "./lib/apps/connection";
import { type McpOAuthStore } from "./lib/apps/mcp/oauth-provider";
import { type StoredAppCredential } from "./lib/apps/origin-bound";
import { type FinderEntry } from "./lib/chat/finder-entries";
import { type DeviceId } from "./lib/records/device-id";
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
  /** Whether the guest is asleep (`sleepGuest`), until a command or the window showing it wakes it. */
  isGuestAsleep: (targetId: BrowserTargetId) => boolean;
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
  /**
   * `frameSession` sends the command to a frame of the page that runs in a
   * process of its own, by the session id the guest's debugger attached it
   * under (`Target.attachedToTarget`), rather than to the page.
   */
  sendCommand(
    targetId: BrowserTargetId,
    method: string,
    params: unknown,
    frameSession?: string,
  ): Promise<unknown>;
  /**
   * The folders on this computer the agent driving a guest can read, or null
   * once no agent is connected. While they are set, a page the agent can read
   * may not take the tab to a file outside them (a link, a script setting
   * `location`), so the agent cannot use a page of its own to open a file it
   * could not open itself.
   */
  /**
   * Stops a guest drawing while no slot shows it: no frames, no animation
   * frames, throttled timers, its page kept as it is. The next command sent to
   * it, or the window showing it, wakes it. Ignored for a guest the window
   * shows, in HTML full screen, being recorded, or busy (`isGuestBusy`).
   */
  sleepGuest: (targetId: BrowserTargetId) => void;
  setAgentFileRoots: (
    targetId: BrowserTargetId,
    roots: null | readonly string[],
  ) => void;
  stopScreencast: (targetId: BrowserTargetId) => void;
  /**
   * Every event of the guest's debugger. `frameSession` is set on an event
   * from a frame attached under a session of its own (see `sendCommand`), and
   * absent on the page's own.
   */
  subscribeEvents: (
    targetId: BrowserTargetId,
    onDetach: () => void,
    onEvent: (method: string, params: unknown, frameSession?: string) => void,
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
   * Instrument's own client for `service`, on its way to that same port. The
   * relay token URL is where such a sign-in's code is redeemed and its token
   * refreshed when our API holds the client's secret.
   */
  oauth?: {
    redirectUrl: () => string;
    relayRedirectUrl: (service: string) => string;
    relayTokenUrl: (service: string) => string;
    store: McpOAuthStore;
  };
}

export interface WorkspaceConfig {
  apps: WorkspaceAppsConfig;
  appsDir: AbsolutePath;
  appVersion: string;
  browser: BrowserConfig;
  captureException: CaptureExceptionFunction;
  /**
   * This install of the app on this machine, which every chat record this
   * process writes is filed under: the only writer of each log and marks
   * file whose name carries it. Chosen before the workspace starts, from
   * what the machine's state holds and the hardware it runs on.
   */
  deviceId: DeviceId;
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
  /**
   * Whether the person's own views of this computer keep a file or folder
   * closed: the app's own data (each workspace's keys, sign-ins and browser
   * profiles, its records), which the channel the viewers read files
   * through refuses too. Files leaves such an entry out of a listing, and
   * answers such a folder as refused by the app. Absent, nothing is.
   */
  isRefusedFile?: (hostPath: string) => Promise<boolean>;
  /**
   * Where macOS stands on the app reaching a Mac app: Calendar, Reminders
   * and Contacts by their own privacy settings, any other app by whether it
   * may be controlled. `request` raises the system's prompt when nobody has
   * answered it, and waits for the answer. `unknown` where macOS can't say
   * now (an app it only answers for while it runs); absent off macOS.
   */
  macAppAccess?: (
    app: { bundleId: string; name: string },
    options: { request: boolean },
  ) => Promise<"allowed" | "denied" | "not-asked" | "unknown">;
  /**
   * Whether one of macOS's own permission prompts is on screen now, as the
   * window list says: what a look the system holds is waiting on. Absent off
   * macOS.
   */
  macosPromptOnScreen?: () => Promise<boolean>;
  getAIProviderConfigs: GetProviderConfigs;
  /**
   * Whether the Instrument account's plan would run one of its hosted
   * features now, as the platform last said: false while the free
   * allowance is spent or the plan leaves it out, so the workspace asks
   * nothing of the platform that it would refuse. Absent, or undefined for
   * a feature not yet heard about, the feature is taken as available.
   */
  isHostedFeatureAvailable?: (feature: "decisions") => boolean | undefined;
  /**
   * Whether a search from a model on the person's own provider goes through
   * the platform's search first: true only while signed in, the platform's
   * switch for it is on, and its plan would run search, as it last said.
   * Absent or false, such a model searches through its provider.
   */
  isPlatformSearchForEveryModel?: () => boolean;
  /**
   * Who is signed in, for the agents to know whose work it is: the account's
   * email and, when the account gives one, name, or undefined while nobody is. Read when a session's
   * context is built rather than at boot, since a sign-in comes and goes;
   * absent altogether where there is no account to read (scripts, evals).
   */
  getUser?: () => Promise<undefined | { email: string; name?: string }>;
  /**
   * `workspace.db`, the database this computer keeps for the workspace
   * (`workspace-db.ts`): the index of its chats and tasks, rebuilt from the
   * workspace whenever it is missing or out of date, and the activity log of
   * the model requests it made. Outside the workspace, in its machine folder,
   * so a workspace in a synced folder never carries a live database, and a
   * moved workspace keeps it. Absent where nothing should persist (tests,
   * scripts), and then every read derives from the stores and no activity is
   * recorded.
   */
  workspaceDbFile?: AbsolutePath;
  /**
   * This computer's folder, Electron's userData: the runtime folder, each
   * workspace's machine folder, the registry of workspaces, the app's own
   * Chromium profile and machine preferences. Closed to every command the
   * agent runs, but for what the rules open in it.
   */
  userDataDir: AbsolutePath;
  /**
   * Where finished work goes when nobody said where (`outputFolderPath`):
   * the workspace's own folder once the person picked where it is kept,
   * whose top level is theirs. Absent while the workspace is kept in the
   * app's own data, and wherever there is no person's folder (tests,
   * scripts, evals), and then it is `Instrument` in their Documents.
   */
  outputDir?: AbsolutePath;
  /**
   * This computer's own folder for the workspace, outside it: the folder
   * rules (`permissions.json`), the in-app browser's profile, the apps'
   * installed servers, and the app's keys and window state, none of which
   * travels with the workspace. The agent reaches none of it.
   */
  workspaceMachineDir: AbsolutePath;
  /**
   * Where every chat's work folder is, the workspace's own folder in
   * `~/.instrument/work/`: `workDir(id)` is the folder named by the chat's
   * id in it.
   */
  workFoldersDir: AbsolutePath;
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
  /**
   * The connection this computer settled on for each model a chat names
   * through another computer's connection (`routeModel`). Absent, a model
   * is still routed, just worked out afresh each time.
   */
  modelRoutes?: ModelRoutes;
  nodeExecEnv: Record<string, string>;
  /**
   * How hard every model request this process makes is asked to think, for
   * a run that pins it (an eval's `--effort`). Absent, each request takes its
   * model's own catalog default; nothing in the app sets it.
   */
  reasoningEffort?: ReasoningEffort;
  /**
   * Whether native commands (node, python, uv, pnpm, ffmpeg, git) are held
   * to Settings › Permissions with Seatbelt on macOS. A plain flag, because
   * native commands run in the bash worker, which is sent a snapshot of the
   * config with each command. Off, native commands run unwrapped, as they do
   * off macOS.
   */
  nativeSandbox?: boolean;
  /**
   * Whether the person chose to let native commands run with no sandbox on
   * this computer, where none can be made or none starts. Without it such a
   * command does not run. A plain flag for the same reason as `nativeSandbox`.
   */
  programsWithoutSandbox?: boolean;
  pnpmBinPath: AbsolutePath;
  /** Told about each hosted request our platform refused (no plan, a spent window). */
  reportPlatformRefusal?: ReportPlatformRefusal;
  registryDir: AbsolutePath;
  rootDir: WorkspaceDir;
  /**
   * The one folder on this computer for what the app can always rebuild,
   * shared by every workspace on it and never inside one: the `bin` links,
   * the managed Python, the caches and config of the app's own uv, pnpm and
   * npm, and the skills the app ships, prepared there since nothing may
   * write into the signed bundle the updater replaces. `runtimeLayout` names
   * its folders.
   */
  runtimeDir: AbsolutePath;
  // Where every chat's folder is, `chats/` under the root.
  chatsDir: AbsolutePath;
  systemSkillsDir: AbsolutePath;
  /**
   * Where 1.x kept its tasks, `tasks/` under the root: what the 1.x
   * migration reads, and names a new chat stays clear of while a folder
   * there waits to move. Absent for a workspace in a folder the person
   * picked, which no 1.x build kept and whose top level is theirs, and
   * wherever nothing 1.x made is opened (evals, scripts).
   */
  legacyTasksDir?: AbsolutePath;
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
  // Whether a uutils call the reviewed rules allow runs outside the native
  // sandbox (`shell-commands/unsandboxed-uutils.ts`). Off, every call runs
  // sandboxed, which is what a test gets unless it asks.
  uutilsOutsideSandbox?: boolean;
  // The bundled Mac helper behind the `instrument calendar` and `instrument contacts` commands and
  // iCloud Drive's app folders; absent off macOS and in builds that do not carry it.
  macHelperBinPath?: AbsolutePath;
  // The Seatbelt launcher (`instrument-seatbelt`) native commands start
  // through on macOS, applying a profile compiled once per set of rules;
  // absent, they start through sandbox-exec.
  seatbeltHelperPath?: AbsolutePath;
  // MXC's launcher (`wxc-exec.exe`) native commands start through on Windows
  // once its canary passed; absent off Windows and where it is not shipped.
  mxcExecPath?: AbsolutePath;
  // Where the system keeps the person's own folders, which is not always under
  // the home folder by its English name: Windows moves Desktop and Documents
  // into OneDrive, and Linux names them in the desktop's language.
  knownFolders?: Record<KnownFolder, string>;
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
