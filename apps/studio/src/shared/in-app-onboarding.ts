/**
 * The onboarding this build has. Bumped when a step is added that people who
 * already finished onboarding should go through once: a workspace whose
 * recorded version is behind it opens on onboarding after updating.
 *
 * 1 was the sign-in window alone. 2 added the plan step in the app window. 3
 * is the setup assistant, drawn over the app window from the first launch.
 */
export const IN_APP_ONBOARDING_VERSION = 3;

/**
 * Whether the app window opens on onboarding: once per version, and never for
 * a run started with SKIP_ONBOARDING, which wants the window as it is.
 */
export function isInAppOnboardingPending({
  completedVersion,
  skip,
}: {
  completedVersion: number;
  skip: boolean;
}) {
  return !skip && completedVersion < IN_APP_ONBOARDING_VERSION;
}
