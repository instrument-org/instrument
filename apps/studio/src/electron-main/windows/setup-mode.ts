import { getWorkspaceState } from "@/electron-main/stores/workspace/state";
import { isInAppOnboardingPending } from "@/shared/in-app-onboarding";

/** The app window's shape while it holds onboarding on a first run. */
export const SETUP_WIDTH = 1080;
export const SETUP_HEIGHT = 720;

/**
 * Whether the app window is holding onboarding: the app behind it is not
 * reachable, so its menu, chords, and asks from outside wait until it is done.
 */
export function isSetupPending() {
  return isInAppOnboardingPending({
    completedVersion: getWorkspaceState().get("onboardingVersion"),
    skip: process.env.SKIP_ONBOARDING === "true",
  });
}

/**
 * Whether this person used Instrument before this onboarding existed: they
 * set up a provider or signed in on an earlier version, so onboarding greets
 * them as a returning beta tester rather than as someone new.
 */
export function isReturningToSetup() {
  return getWorkspaceState().get("hasCompletedProviderSetup");
}
