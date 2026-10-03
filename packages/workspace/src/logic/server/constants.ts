import { APP_NAME_SLUG, PORTS } from "@instrument-org/shared";

const IS_TEST = process.env.NODE_ENV === "test";
const IS_DEVELOPMENT = process.env.NODE_ENV === "development";

const APPS_SERVER_API_PATH = `/_${APP_NAME_SLUG}`;
export const LOCALHOST_APPS_SERVER_DOMAIN = "localhost";
// Bind the workspace server to IPv4 loopback only. It fronts the CDP bridge and
// the model proxy, neither of which should be reachable from the local network.
export const LOOPBACK_HOST = "127.0.0.1";
export const DEFAULT_APPS_SERVER_PORT = IS_DEVELOPMENT
  ? PORTS.appsServer.dev
  : IS_TEST
    ? PORTS.appsServer.test
    : PORTS.appsServer.prod;
export const CDP_BASE_PATH = `${APPS_SERVER_API_PATH}/cdp`;
