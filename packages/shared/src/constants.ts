export const AI_GATEWAY_API_PATH = "/ai-gateway";
export const APP_NAME = "Instrument";
export const APP_NAME_SLUG = "instrument";
export const APP_UPDATER_CACHE_DIR_NAME = `${APP_NAME_SLUG}-desktop-updater`;
export const APP_PROTOCOL =
  process.env.NODE_ENV === "development"
    ? `${APP_NAME_SLUG}-local`
    : APP_NAME_SLUG;
export const APP_EXECUTABLE = "instrument";
export const APP_CLIENT_NAME_STUDIO = `${APP_NAME_SLUG}-studio`;

export const APP_REPO_NAME = "instrument";
export const GITHUB_ORG = "instrument-org";
export const APP_REPO_URL = `https://github.com/${GITHUB_ORG}/${APP_REPO_NAME}`;
export const APP_DOMAIN = "tryinstrument.com";
export const APP_URL = `https://${APP_DOMAIN}`;
export const FAUX_STUDIO_URL = `https://studio.${APP_DOMAIN}`;
export const NEW_ISSUE_URL = `${APP_REPO_URL}/issues/new/choose`;
export const REGISTRY_REPO_NAME = "registry";
export const REGISTRY_REPO_URL = `https://github.com/${GITHUB_ORG}/${REGISTRY_REPO_NAME}`;
export const RELEASE_NOTES_URL = `${APP_REPO_URL}/releases`;
export const X_HANDLE = "@tryinstrument";
export const X_URL = `https://x.com/${X_HANDLE}`;
export const DISCORD_URL = `${APP_URL}/discord`;
export const SUPPORT_URL = `https://${APP_DOMAIN}/support`;
export const MANUAL_DOWNLOAD_URL = `${APP_URL}/download`;
export const AI_GATEWAY_API_KEY_NOT_NEEDED = "NOT_NEEDED";
export const SALES_EMAIL = `hello@${APP_DOMAIN}`;
export const SUPPORT_EMAIL = `support@${APP_DOMAIN}`;
export const PROJECT_MANIFEST_FILE_NAME = `${APP_NAME_SLUG}.json`;
export const VERSION_REF_QUERY_PARAM = "versionRef";
export const EVAL_SUBDOMAIN_PREFIX = "eval-";
export const RELEASES_BUCKET_URL = `https://releases.${APP_DOMAIN}`;
export const APP_PRIVATE_FOLDER_NAME = `.${APP_NAME_SLUG}`;
export const GIT_AGENT_EMAIL = `agent@${APP_DOMAIN}`;
export const GIT_AGENT_NAME = `${APP_NAME} Agent`;
export const GIT_TRAILER_INITIAL_COMMIT = "Instrument-Initial-Commit";
export const GIT_TRAILER_TEMPLATE = "Instrument-Template";

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
  // Starting port for PortManager, which increments upward (up to 1000 attempts)
  // to assign a port to each running user app.
  runtimeBase: {
    dev: 48_400,
    prod: 48_200,
    test: 48_600,
  },
  shimClient: 48_350,
} as const;

const OUR_MODEL_PREFIX = APP_NAME_SLUG;
export const OUR_MODELS = {
  author: APP_NAME_SLUG,
  cacheIdentifier: APP_NAME_SLUG,
  image: {
    // Should technically be a ProviderId, but that's defined in the ai-gateway package
    id: `${OUR_MODEL_PREFIX}/auto-image`,
  },
  prefix: OUR_MODEL_PREFIX,
  providerType: APP_NAME_SLUG,
  text: {
    // Should technically be a ProviderId, but that's defined in the ai-gateway package
    id: `${OUR_MODEL_PREFIX}/auto`,
  },
} as const;

export const OUR_PROVIDER_CONFIG = {
  cacheIdentifier: OUR_MODELS.cacheIdentifier,
  id: APP_NAME_SLUG,
  type: OUR_MODELS.providerType,
} as const;
