import {
  type PlatformApiServer,
  platformApiOriginOf,
  resolvePlatformApiBaseUrl,
} from "@/shared/platform-api-server";
import { APP_FLAVOR } from "@instrument-org/shared";

let settled: string | undefined;

/** The platform API the build was made against (`MAIN_VITE_APP_API_BASE_URL`). */
export function buildDefaultPlatformApiBaseUrl(): string {
  return import.meta.env.MAIN_VITE_APP_API_BASE_URL;
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
