import { type AppFlavor } from "@instrument-org/shared";
import { z } from "zod";

/** The platform API servers a developer can point the app at by name. */
const PLATFORM_API_SERVERS = {
  local: "http://localhost:49100",
  production: "https://api.tryinstrument.com",
  staging: "https://staging.api.tryinstrument.com",
} as const;

const NAMED_SERVERS = ["production", "staging", "local"] as const;

type NamedServer = (typeof NAMED_SERVERS)[number];

const SERVER_LABELS: Record<NamedServer, string> = {
  local: "Local",
  production: "Production",
  staging: "Staging",
};

/**
 * Which platform API server a developer chose in Settings: one by name, or
 * any http(s) address. Unset means the one the build was made against.
 */
export const PlatformApiServerSchema = z.union([
  z.enum(NAMED_SERVERS),
  z.object({
    // Call sites append paths to it, which a query or fragment would swallow.
    custom: z.url({ protocol: /^https?$/ }).refine((url) => {
      const parsed = URL.parse(url);
      return !parsed?.search && !parsed?.hash;
    }, "Leave out the query and fragment"),
  }),
]);

export type PlatformApiServer = z.output<typeof PlatformApiServerSchema>;

/**
 * Whether a build may talk to a server on this computer or at an address
 * typed in by hand. Only a development build may; every other build offers
 * production and staging alone.
 */
export function offersAnyPlatformApiServer(flavor: AppFlavor): boolean {
  return flavor.kind === "development";
}

/** A base URL as call sites join paths onto it: no trailing slash. */
export function trimBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * The base URL `choice` stands for in a build of `flavor`, or `buildDefault`
 * when nothing is chosen or the build does not offer what was.
 */
export function resolvePlatformApiBaseUrl({
  buildDefault,
  choice,
  flavor,
}: {
  buildDefault: string;
  choice: PlatformApiServer | undefined;
  flavor: AppFlavor;
}): string {
  if (choice === undefined) {
    return buildDefault;
  }
  if (choice === "production" || choice === "staging") {
    return PLATFORM_API_SERVERS[choice];
  }
  if (!offersAnyPlatformApiServer(flavor)) {
    return buildDefault;
  }
  return choice === "local"
    ? PLATFORM_API_SERVERS.local
    : trimBaseUrl(choice.custom);
}

/** The origin a base URL is on, which is what a sign-in is kept under. */
export function platformApiOriginOf(baseUrl: string): string {
  return URL.parse(baseUrl)?.origin ?? baseUrl;
}

/** The named server a base URL is on, if it is one of them. */
export function namedPlatformApiServerOf(
  baseUrl: string,
): NamedServer | undefined {
  const origin = platformApiOriginOf(baseUrl);
  return NAMED_SERVERS.find((name) => PLATFORM_API_SERVERS[name] === origin);
}

/**
 * What the window calls the server it talks to: undefined for production,
 * which needs no word, the server's name for the others, and the host for an
 * address typed in by hand.
 */
export function platformApiServerLabel(baseUrl: string): string | undefined {
  const named = namedPlatformApiServerOf(baseUrl);
  if (named === "production") {
    return undefined;
  }
  if (named !== undefined) {
    return SERVER_LABELS[named];
  }
  return URL.parse(baseUrl)?.host ?? baseUrl;
}

/** A named server's label for a picker. */
export function namedPlatformApiServerLabel(name: NamedServer): string {
  return SERVER_LABELS[name];
}
