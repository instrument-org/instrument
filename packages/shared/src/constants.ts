export const AI_GATEWAY_API_PATH = "/ai-gateway";
export const APP_NAME = "Instrument";
export const APP_NAME_SLUG = "instrument";
export const APP_UPDATER_CACHE_DIR_NAME = `${APP_NAME_SLUG}-desktop-updater`;
// Set by the Preview build workflow, and inlined into every bundle at build
// time. A preview is a separately installed copy of the app with an identity of
// its own: bundle id, product name, protocol, and so userData folder, keychain
// item, and macOS privacy grants. Its first launch is a real first launch, on a
// machine that already runs Instrument. Copy keeps saying APP_NAME, so what the
// user reads matches what ships.
/**
 * Which kind of build this is, settled when it is built. Everything that tells
 * a preview or a development run apart from the app people install (its name,
 * identity, icon, defaults, and what it leaves out) reads this.
 */
export type AppFlavor =
  | { kind: "development" }
  | { kind: "preview"; name: string }
  | { kind: "release" };
/**
 * The flavor a build environment makes. The bundles call it once with their
 * inlined values (`APP_FLAVOR`); build tooling that writes something the
 * bundles must agree with calls it with the same values it gives them.
 */
export function appFlavorOf({
  nodeEnv,
  previewName = "",
}: {
  nodeEnv: string | undefined;
  previewName: string | undefined;
}): AppFlavor {
  const name = previewSlugOf(previewName);
  if (name) {
    return { kind: "preview", name };
  }
  return nodeEnv === "development"
    ? { kind: "development" }
    : { kind: "release" };
}
const PREVIEW_SLUG_LENGTH = 40;

/** A preview name as a flavor carries it: lowercase letters, digits, and dashes. */
function previewSlugOf(name: string): string {
  return name
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, PREVIEW_SLUG_LENGTH);
}

/**
 * The name a preview build is made under (`preview.yml`): the requested name
 * as a slug, cut so the run number still fits after it, so each rebuild of a
 * branch is a first launch of its own. Empty when the name has no letters or
 * digits in it.
 */
export function previewBuildNameOf(name: string, runNumber: number): string {
  const slug = previewSlugOf(name);
  if (!slug) {
    return "";
  }
  const suffix = `-${runNumber}`;
  const head = slug
    .slice(0, PREVIEW_SLUG_LENGTH - suffix.length)
    .replace(/-+$/, "");
  return `${head}${suffix}`;
}

// Read as written, not through a helper taking `process.env`: the bundlers
// replace these two expressions with literals, and the renderer has no
// `process` to read anything else from.
export const APP_FLAVOR: AppFlavor = appFlavorOf({
  nodeEnv: process.env.NODE_ENV,
  previewName: process.env.INSTRUMENT_PREVIEW_NAME,
});
// What the OS calls the app: the bundle on disk, the userData folder, the
// keychain's Safe Storage item, and the name on its privacy prompts.
export const APP_PRODUCT_NAME =
  APP_FLAVOR.kind === "preview"
    ? `${APP_NAME} Preview (${APP_FLAVOR.name})`
    : APP_NAME;
/**
 * The one URL scheme a flavor registers: what the OS hands deep links to, and
 * what the app serves its own files, icons, and vendored assets from.
 */
export function appProtocolOf(flavor: AppFlavor): string {
  switch (flavor.kind) {
    case "development":
      return `${APP_NAME_SLUG}-local`;
    case "preview":
      return `${APP_NAME_SLUG}-preview-${flavor.name}`;
    case "release":
      return APP_NAME_SLUG;
  }
}
export const APP_PROTOCOL = appProtocolOf(APP_FLAVOR);
export const APP_EXECUTABLE = "instrument";
export const APP_CLIENT_NAME_STUDIO = `${APP_NAME_SLUG}-studio`;
// macOS/Windows application bundle identifier; the source of truth for
// electron-builder `appId` and any OS deep links that target the app.
export const APP_BUNDLE_ID =
  APP_FLAVOR.kind === "preview"
    ? `com.finalpoint.instrument.preview.${APP_FLAVOR.name}`
    : "com.finalpoint.instrument";

export const APP_REPO_NAME = "instrument";
export const GITHUB_ORG = "instrument-org";
export const APP_REPO_URL = `https://github.com/${GITHUB_ORG}/${APP_REPO_NAME}`;
export const APP_DOMAIN = "tryinstrument.com";
export const APP_URL = `https://${APP_DOMAIN}`;
// Bug reports are filed as discussions in the triage category, not as issues.
// The category is deep-linked rather than routed through the chooser so a
// report started from inside the app cannot land in a category that never asks
// for the version, platform, and model it needs.
export const BUG_REPORT_URL = `${APP_REPO_URL}/discussions/new?category=issue-triage`;
export const RELEASE_NOTES_URL = `${APP_REPO_URL}/releases`;
// What Settings › Permissions links to on Windows, where programs the agent
// runs are not yet held to the list. Kept to this one constant so the link
// can move behind a redirect on the website.
export const WINDOWS_SANDBOX_URL = `${APP_REPO_URL}/blob/main/docs/architecture/windows-sandbox.md`;
// What the sandbox-off warning on macOS and Linux links to, written for the
// person who sees it.
export const SANDBOX_OFF_URL = `${APP_REPO_URL}/blob/main/docs/architecture/native-sandbox-off.md`;
// What the notice for web pages running without Chromium's sandbox links to.
export const BROWSER_SANDBOX_OFF_URL = `${SANDBOX_OFF_URL}#when-web-pages-have-no-sandbox`;
export const SUPPORT_URL = `https://${APP_DOMAIN}/support`;
export const MANUAL_DOWNLOAD_URL = `${APP_URL}/download`;
export const AI_GATEWAY_API_KEY_NOT_NEEDED = "NOT_NEEDED";
// Identity every commit the agent makes is authored and committed under, so a
// repository's history never attributes agent work to the user.
export const GIT_AGENT_EMAIL = `agent@${APP_DOMAIN}`;
export const GIT_AGENT_NAME = `${APP_NAME} Agent`;
export const SETTINGS_FILE_NAME = `settings.json`;
export const RELEASES_BUCKET_URL = `https://releases.${APP_DOMAIN}`;
export const PRIVATE_FOLDER_NAME = `.instrument`;

/**
 * What this computer keeps for one workspace, in a folder of its own named by
 * the workspace's local id and outside the workspace: what is secret, means
 * something only on this computer, or is rebuilt here, so the workspace
 * folder never carries it to another one. Named here because the app and the
 * agent's package both reach into it.
 */
export const WORKSPACE_MACHINE_ENTRIES = {
  /** The local servers of connected apps, as installed. */
  appServers: "app-servers",
  /** The Chromium profiles of the app and its browser, history, page pictures, downloads. */
  browser: "browser",
  /**
   * The name of each chat's own folder under `Chats/` as this computer last
   * knew it, by chat id: where to look first. A folder's `CHAT.md` names
   * its chat, which is what finds one a person renamed.
   */
  chatFolders: "chat-folders.json",
  /**
   * The config folder our copy of Claude Code runs with, holding the Claude
   * subscription it is signed in to. Beside `keys` because it is one, and
   * per workspace for the same reason every other sign-in is.
   */
  claudeAccount: "claude-account",
  /**
   * `workspace.db`: the index of the workspace's chats and of every
   * device's activity log, rebuilt from the workspace whenever it is missing.
   */
  database: "workspace.db",
  /** Provider keys, the account sign-in, ChatGPT accounts, app credentials and connections. */
  keys: "keys",
  /**
   * The launch making the workspace's pending move, held until it has the
   * workspace open, so a second launch at once waits for it rather than
   * moving the same records.
   */
  moveLock: "move.lock",
  /** The process that has the workspace open. */
  openMark: "open.pid",
  /**
   * The id of the workspace this folder belongs to, so a local id another
   * workspace had before never hands this one that one's data.
   */
  owner: "owner.json",
  /** Settings › Permissions, whose folder rules name this computer's paths. */
  permissions: "permissions.json",
  /**
   * What the person chose for the workspace on this computer: theme,
   * developer mode, notifications, the default model, the experimental
   * flags.
   */
  preferences: "preferences.json",
  /**
   * The skills folders in places macOS guards (a `~/.claude/skills` linked
   * into Documents) the person loaded on this computer, which later passes
   * read without asking again.
   */
  skillFolders: "skill-folders.json",
  /** What the app remembers about the workspace on this computer. */
  state: "state.json",
  /** The window's size and place, and where the person left off in it. */
  window: "window",
  /**
   * The name of the workspace's folder in `~/.instrument/work/`, settled the
   * first time the workspace opens on this computer and kept here, so a
   * workspace renamed or moved keeps its chats' work.
   */
  workFolders: "work-folders.json",
} as const;

/**
 * What a flavor calls the two folders it keeps in the person's home folder:
 * `instrument`, its Instrument folder (where finished work goes while the
 * workspace is kept in the app's own data, and the folder offered when the
 * person picks one), and `data`, its own data (`HOME_DATA_ENTRIES`). Each
 * flavor has its own pair, so a development run or a preview never writes
 * into the folders of the app people install, nor finds its workspace there
 * to open. Every preview shares one pair, so a rebuild makes no new folders.
 */
export function homeFoldersOf(flavor: AppFlavor): {
  data: string;
  instrument: string;
} {
  switch (flavor.kind) {
    case "development":
      return {
        data: `${PRIVATE_FOLDER_NAME}-dev`,
        instrument: `${APP_NAME} Dev`,
      };
    case "preview":
      return {
        data: `${PRIVATE_FOLDER_NAME}-preview`,
        instrument: `${APP_NAME} Preview`,
      };
    case "release":
      return { data: PRIVATE_FOLDER_NAME, instrument: APP_NAME };
  }
}
export const HOME_FOLDERS = homeFoldersOf(APP_FLAVOR);
/**
 * Every flavor's own data folder in the home folder, none of which can be or
 * hold an Instrument folder, whichever flavor is asking.
 */
export const HOME_DATA_FOLDER_NAMES = (
  [
    { kind: "development" },
    { kind: "preview", name: "" },
    { kind: "release" },
  ] satisfies AppFlavor[]
).map((flavor) => homeFoldersOf(flavor).data);

/**
 * What the app keeps in the person's home folder, in its flavor's data
 * folder (`HOME_FOLDERS.data`, `~/.instrument/` for the app people install):
 * what the agent made for the person, in a folder they can find, apart from
 * the app's own data.
 */
export const HOME_DATA_ENTRIES = {
  /**
   * Each chat's work folder, `work/<workspace>/<chat id>/`: where its
   * agent's shell starts and what it makes lands. `<workspace>` is a
   * readable name the workspace's machine folder records
   * (`WORKSPACE_MACHINE_ENTRIES.workFolders`). Its records stay in the
   * workspace.
   */
  work: "work",
} as const;

// 47xxx-48xxx range: above WSL2/Hyper-V exclusion bands (~4k-10k) and below
// the OS ephemeral range (49152+). Env suffixes (prod/dev/test) allow all
// three to run side-by-side.
export const PORTS = {
  appsServer: {
    dev: 48_300,
    prod: 48_100,
    test: 48_500,
  },
  authCallback: {
    dev: 47_783,
    prod: 47_893,
  },
  electronDebug: 48_160,
} as const;

const OUR_MODELS_GROUP_ID = "instrument";

export const OUR_MODELS = {
  author: OUR_MODELS_GROUP_ID,
  cacheIdentifier: OUR_MODELS_GROUP_ID,
  image: {
    // Should technically be a ProviderId, but that's defined in the ai-gateway package
    id: `${OUR_MODELS_GROUP_ID}/auto-image`,
    // What the image card calls Instrument's image model, under OpenAI's
    // mark: the name people know it by.
    name: "ChatGPT images",
  },
  prefix: OUR_MODELS_GROUP_ID,
  providerType: OUR_MODELS_GROUP_ID,
  text: {
    // Should technically be a ProviderId, but that's defined in the ai-gateway package
    id: `${OUR_MODELS_GROUP_ID}/auto`,
  },
} as const;

export const OUR_PROVIDER_CONFIG = {
  cacheIdentifier: OUR_MODELS.cacheIdentifier,
  id: OUR_MODELS_GROUP_ID,
  type: OUR_MODELS.providerType,
} as const;

/**
 * What every signed-in ChatGPT account's config shares. Like our own, each is
 * synthesized in the main process rather than stored: its id and cache
 * identifier come from the account's registration, and its key is the
 * account's current OAuth access token.
 */
export const CHATGPT_ACCOUNT_PROVIDER_CONFIG = {
  displayName: "ChatGPT account",
  type: "chatgpt-account",
} as const;

/**
 * What every signed-in Grok account's config shares. Each is synthesized in
 * the main process: its id and cache identifier come from the account's
 * registration, and its key is the account's current OAuth access token.
 */
export const GROK_ACCOUNT_PROVIDER_CONFIG = {
  displayName: "Grok account",
  type: "grok-account",
} as const;

/**
 * The Claude account's config, synthesized in the main process while
 * Instrument's own copy of Claude Code is signed in to a Claude subscription.
 * It carries no key: Claude Code holds the sign-in, and requests run through
 * it.
 */
export const CLAUDE_ACCOUNT_PROVIDER_CONFIG = {
  cacheIdentifier: "claude-account",
  displayName: "Claude account",
  id: "claude-account",
  type: "claude-account",
} as const;
