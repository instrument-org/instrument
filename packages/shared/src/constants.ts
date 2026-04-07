export const AI_GATEWAY_API_PATH = "/ai-gateway";
export const APP_NAME = "Instrument";
export const APP_PROTOCOL =
  process.env.NODE_ENV === "development" ? "instrument-local" : "instrument";
export const APP_EXECUTABLE = "instrument";

export const APP_REPO_NAME = "instrument";
export const GITHUB_ORG = "instrument-org";
export const APP_REPO_URL = `https://github.com/${GITHUB_ORG}/${APP_REPO_NAME}`;
export const ATTRIBUTION_NAME = "Instrument";
export const APP_DOMAIN = "tryinstrument.com";
export const BASE_WEB_URL = `https://${APP_DOMAIN}`;
export { BASE_WEB_URL as ATTRIBUTION_URL };
export const FAUX_STUDIO_URL = `https://studio.${APP_DOMAIN}`;
export const NEW_ISSUE_URL = `${APP_REPO_URL}/issues/new/choose`;
export const PRODUCT_NAME = "Instrument";
export const REGISTRY_REPO_NAME = "registry";
export const REGISTRY_REPO_URL = `https://github.com/${GITHUB_ORG}/${REGISTRY_REPO_NAME}`;
export const RELEASE_NOTES_URL = `${APP_REPO_URL}/releases`;
export const X_HANDLE = "@tryinstrument";
export const X_URL = `https://x.com/${X_HANDLE}`;
export const DISCORD_URL = `${BASE_WEB_URL}/discord`;
export const SUPPORT_URL = `https://${APP_DOMAIN}/support`;
export const MANUAL_DOWNLOAD_URL = `${BASE_WEB_URL}/download`;
export const AI_GATEWAY_API_KEY_NOT_NEEDED = "NOT_NEEDED";
export const SALES_EMAIL = `hello@${APP_DOMAIN}`;
export const SUPPORT_EMAIL = `support@${APP_DOMAIN}`;
export const PROJECT_MANIFEST_FILE_NAME = "instrument.json";
export const VERSION_REF_QUERY_PARAM = "versionRef";
export const EVAL_SUBDOMAIN_PREFIX = "eval-";
export const OUR_AUTO_MODEL_ID = "quests/auto"; // TODO(rename): do it once API is ready
export const OUR_AUTO_IMAGE_MODEL_ID = "quests/auto-image"; // TODO(rename): do it once API is ready
