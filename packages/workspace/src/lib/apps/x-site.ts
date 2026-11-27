import { getWorkspaceConfig } from "../workspace-config";
import { type AppManifest } from "./manifest";

/**
 * X's hosts: its site and the one it had as Twitter, bare or as `www.` and
 * `mobile.`. Its other hosts (ads, developer) are services of their own.
 */
const X_HOSTS = new Set(
  ["x.com", "twitter.com"].flatMap((site) => [
    site,
    `www.${site}`,
    `mobile.${site}`,
  ]),
);

/**
 * Whether an app is X: a web app on X's site, whatever its id. Every such
 * app also has Instrument's own X tools (`lib/capabilities/x.ts`), which run
 * on the user's Grok plan.
 */
export function isXApp(manifest: AppManifest): boolean {
  if (manifest.type !== "web") {
    return false;
  }
  try {
    return X_HOSTS.has(new URL(manifest.url).hostname);
  } catch {
    return false;
  }
}

/**
 * Whether a Grok plan is signed in on this computer, which X's tools run on:
 * an account with a plan xAI has not said it lacks.
 */
export function grokPlanSignedIn(): boolean {
  return getWorkspaceConfig()
    .getAIProviderConfigs()
    .some((config) => config.type === "grok-account");
}
