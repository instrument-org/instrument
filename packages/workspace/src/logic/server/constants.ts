import { APP_NAME_SLUG, PORTS } from "@instrument-org/shared";

const IS_TEST = process.env.NODE_ENV === "test";
const IS_DEVELOPMENT = process.env.NODE_ENV === "development";

const APPS_SERVER_API_PATH = `/_${APP_NAME_SLUG}`;
const LOCAL_LOOPBACK_APPS_SERVER_DOMAIN = "lvh.me"; // Due to some browsers not supporting localhost ids
export const LOCALHOST_APPS_SERVER_DOMAIN = "localhost";
// Bind the workspace server to IPv4 loopback only. It fronts the asset origin
// and the CDP bridge, neither of which should be reachable from the local
// network. Every asset URL (`*.localhost`, `*.lvh.me`) resolves to 127.0.0.1,
// so loopback binding serves all real traffic while dropping the
// all-interfaces exposure.
export const LOOPBACK_HOST = "127.0.0.1";
export const APPS_SERVER_DOMAINS = [
  LOCAL_LOOPBACK_APPS_SERVER_DOMAIN,
  LOCALHOST_APPS_SERVER_DOMAIN,
];
export const DEFAULT_APPS_SERVER_PORT = IS_DEVELOPMENT
  ? PORTS.appsServer.dev
  : IS_TEST
    ? PORTS.appsServer.test
    : PORTS.appsServer.prod;
export const CDP_BASE_PATH = `${APPS_SERVER_API_PATH}/cdp`;
export const CDP_PAGE_PATH_PREFIX = `${CDP_BASE_PATH}/devtools/page/`;
