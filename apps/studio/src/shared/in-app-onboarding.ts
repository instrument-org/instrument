/**
 * The in-app onboarding this build has. Bumped when a step is added that
 * people who already finished onboarding should go through once: a workspace
 * whose recorded version is behind it opens on the steps after updating.
 *
 * 1 was the sign-in window alone. 2 adds the plan step in the app window.
 */
export const IN_APP_ONBOARDING_VERSION = 2;

/**
 * Whether the app window opens on the in-app steps. Only past the sign-in
 * window (`hasCompletedProviderSetup`), which runs first on a new workspace,
 * and only once per version.
 */
export function isInAppOnboardingPending({
  completedVersion,
  hasCompletedProviderSetup,
  skip,
}: {
  completedVersion: number;
  hasCompletedProviderSetup: boolean;
  skip: boolean;
}) {
  return (
    !skip &&
    hasCompletedProviderSetup &&
    completedVersion < IN_APP_ONBOARDING_VERSION
  );
}
