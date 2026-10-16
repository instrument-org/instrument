import { base } from "@/electron-main/rpc/base";
import {
  openAppWindow,
  rememberedAppWindowState,
} from "@/electron-main/windows/app-window";
import {
  closeOnboardingWindow,
  growOnboardingWindow,
} from "@/electron-main/windows/onboarding";
import {
  IN_APP_ONBOARDING_VERSION,
  isInAppOnboardingPending,
} from "@/shared/in-app-onboarding";
import { getWorkspaceState } from "@/electron-main/stores/workspace/state";
import { screen } from "electron";

const complete = base.handler(() => {
  // Onboarding grows into the app window's frame while that window loads
  // behind it, hidden; the app window then takes its place, so the one window
  // seems to become the other. It opens before onboarding closes, which quits
  // the app when it leaves no window behind.
  const { bounds, isMaximized } = rememberedAppWindowState();
  openAppWindow({ onShow: closeOnboardingWindow });
  growOnboardingWindow(
    isMaximized ? screen.getDisplayMatching(bounds).workArea : bounds,
  );
});

/**
 * Whether the app window should open on onboarding's in-app steps: past the
 * sign-in window, behind the steps this build has. Never for a run started
 * with SKIP_ONBOARDING, which wants the window as it is.
 */
const inAppStatus = base.handler(() => ({
  pending: isInAppOnboardingPending({
    completedVersion: getWorkspaceState().get("onboardingVersion"),
    hasCompletedProviderSetup: getWorkspaceState().get(
      "hasCompletedProviderSetup",
    ),
    skip: process.env.SKIP_ONBOARDING === "true",
  }),
}));

/** Records the in-app steps as done, so they do not show again. */
const finishInApp = base.handler(() => {
  getWorkspaceState().set("onboardingVersion", IN_APP_ONBOARDING_VERSION);
});

export const onboarding = {
  complete,
  inApp: { finish: finishInApp, status: inAppStatus },
};
