import {
  type PlatformApiServer,
  platformApiOriginOf,
  resolvePlatformApiBaseUrl,
  trimBaseUrl,
} from "@/shared/platform-api-server";
import { APP_DOMAIN, APP_FLAVOR, APP_URL } from "@instrument-org/shared";

let settled: string | undefined;

/** The platform API the build was made against (`MAIN_VITE_APP_API_BASE_URL`). */
export function buildDefaultPlatformApiBaseUrl(): string {
  // Unset in tests that never reach the platform API.
  const base: string | undefined = import.meta.env.MAIN_VITE_APP_API_BASE_URL;
  return base ? trimBaseUrl(base) : "";
}

/**
 * Fix the server this process talks to, from the choice in machine
 * preferences, once at startup. Changing the choice restarts the app, so
 * every request a process makes goes to the same server and every sign-in it
 * keeps is that server's.
 */
export function settlePlatformApiServer(choice: PlatformApiServer | undefined) {
  settled = resolvePlatformApiBaseUrl({
    buildDefault: buildDefaultPlatformApiBaseUrl(),
    choice,
    flavor: APP_FLAVOR,
  });
}

/**
 * The base URL of the platform API this process talks to, with no trailing
 * slash: the server settled at startup, else the build's own.
 */
export function platformApiBaseUrl(): string {
  return settled ?? buildDefaultPlatformApiBaseUrl();
}

/** The origin of {@link platformApiBaseUrl}, which sign-ins are kept under. */
export function platformApiOrigin(): string {
  return platformApiOriginOf(platformApiBaseUrl());
}

/** The website a local API's account pages are served from. */
const LOCAL_WEBSITE_URL = "http://localhost:49110";

/**
 * The website that goes with the platform API this process talks to: the
 * API's host without its `api.` (`staging.api.tryinstrument.com` has
 * `staging.tryinstrument.com`), the local website for a local API, and
 * tryinstrument.com for any other server.
 */
export function websiteBaseUrl(): string {
  const host = URL.parse(platformApiBaseUrl())?.hostname ?? "";
  if (host === "localhost" || host === "127.0.0.1") {
    return LOCAL_WEBSITE_URL;
  }
  if (host === `api.${APP_DOMAIN}` || host.endsWith(`.api.${APP_DOMAIN}`)) {
    return `https://${host.replace(/(^|\.)api\./, "$1")}`;
  }
  return APP_URL;
}
