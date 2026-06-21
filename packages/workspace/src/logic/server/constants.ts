import { APP_NAME_SLUG, PORTS } from "@instrument-org/shared";

const IS_TEST = process.env.NODE_ENV === "test";
const IS_DEVELOPMENT = process.env.NODE_ENV === "development";

export const APPS_SERVER_API_PATH = `/_${APP_NAME_SLUG}`;
export const SHIM_IFRAME_BASE_PATH = `${APPS_SERVER_API_PATH}/shim-iframe`;
export const SHIM_SCRIPT_PATH = `${SHIM_IFRAME_BASE_PATH}/src/client/index.js`;
export const SHIM_DEV_HOST = `http://localhost:${PORTS.shimClient}`;
export const LOCAL_LOOPBACK_APPS_SERVER_DOMAIN = "lvh.me"; // Due to some browsers not supporting localhost subdomains
export const LOCALHOST_APPS_SERVER_DOMAIN = "localhost";
export const APPS_SERVER_DOMAINS = [
  LOCAL_LOOPBACK_APPS_SERVER_DOMAIN,
  LOCALHOST_APPS_SERVER_DOMAIN,
];
export const DEFAULT_APPS_SERVER_PORT = IS_DEVELOPMENT
  ? PORTS.appsServer.dev
  : IS_TEST
    ? PORTS.appsServer.test
    : PORTS.appsServer.prod;
export const DEFAULT_RUNTIME_BASE_PORT = IS_DEVELOPMENT
  ? PORTS.runtimeBase.dev
  : IS_TEST
    ? PORTS.runtimeBase.test
    : PORTS.runtimeBase.prod;
export const SHIM_SCRIPTS = {
  iframeHTML: "index.html",
  iframeJS: "index.js",
  shimJS: "shim.js",
} as const;
export const FALLBACK_PAGE_META_NAME = "workspace-fallback-page";
export const HEARTBEAT_STREAM_ROUTE = "/heartbeat-stream";
export const HEARTBEAT_STREAM_PATH = `${APPS_SERVER_API_PATH}${HEARTBEAT_STREAM_ROUTE}`;
export const CDP_BASE_PATH = `${APPS_SERVER_API_PATH}/cdp`;
export const CDP_PAGE_PATH_PREFIX = `${CDP_BASE_PATH}/devtools/page/`;
