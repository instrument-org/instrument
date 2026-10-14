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
export const FAUX_STUDIO_URL = `https://studio.${APP_DOMAIN}`;
// Bug reports are filed as discussions in the triage category, not as issues.
// The category is deep-linked rather than routed through the chooser so a
// report started from inside the app cannot land in a category that never asks
// for the version, platform, and model it needs.
export const BUG_REPORT_URL = `${APP_REPO_URL}/discussions/new?category=issue-triage`;
export const REGISTRY_REPO_NAME = "registry";
export const REGISTRY_REPO_URL = `https://github.com/${GITHUB_ORG}/${REGISTRY_REPO_NAME}`;
export const RELEASE_NOTES_URL = `${APP_REPO_URL}/releases`;
// What Settings › Permissions links to on Windows, where programs the agent
// runs are not yet held to the list. Kept to this one constant so the link
// can move behind a redirect on the website.
export const WINDOWS_SANDBOX_URL = `${APP_REPO_URL}/blob/main/docs/architecture/windows-sandbox.md`;
export const SKILLS_MARKETPLACE_URL = "https://skills.sh";
export const X_HANDLE = "@tryinstrument";
export const X_URL = `https://x.com/${X_HANDLE}`;
export const SUPPORT_URL = `https://${APP_DOMAIN}/support`;
export const MANUAL_DOWNLOAD_URL = `${APP_URL}/download`;
export const AI_GATEWAY_API_KEY_NOT_NEEDED = "NOT_NEEDED";
export const CONTACT_EMAIL = `support@${APP_DOMAIN}`;
// Identity every commit the agent makes is authored and committed under, so a
// repository's history never attributes agent work to the user.
export const GIT_AGENT_EMAIL = `agent@${APP_DOMAIN}`;
export const GIT_AGENT_NAME = `${APP_NAME} Agent`;
export const SETTINGS_FILE_NAME = `settings.json`;
export const RELEASES_BUCKET_URL = `https://releases.${APP_DOMAIN}`;
export const PRIVATE_FOLDER_NAME = `.instrument`;

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
    id: `${OUR_MODELS_GROUP_ID}/auto-image-2`,
    // Friendly label for the auto-selected image model, shown in place of the id.
    name: "Auto",
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
