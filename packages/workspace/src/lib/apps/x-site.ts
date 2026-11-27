import { getWorkspaceConfig } from "../workspace-config";
import { type AppManifest } from "./manifest";
import { onSameSite } from "./same-site";

/** X's site, and the one it had as Twitter. */
const X_SITES = ["x.com", "twitter.com"] as const;

/**
 * Whether an app is X: a web app on X's site, whatever its id. Every such
 * app also has Instrument's own X tools (`lib/capabilities/x.ts`), which run
 * on the user's Grok plan.
 */
export function isXApp(manifest: AppManifest): boolean {
  return (
    manifest.type === "web" &&
    X_SITES.some((site) => onSameSite(site, manifest.url))
  );
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
