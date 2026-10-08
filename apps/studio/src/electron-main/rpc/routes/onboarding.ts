import { base } from "@/electron-main/rpc/base";
import { liveRead } from "@instrument-org/workspace/electron";
import { publisher } from "@/electron-main/rpc/publisher";
import { getWorkspaceState } from "@/electron-main/stores/workspace/state";
import { finishAppWindowSetup } from "@/electron-main/windows/app-window";
import {
  isReturningToSetup,
  isSetupPending,
} from "@/electron-main/windows/setup-mode";
import { IN_APP_ONBOARDING_VERSION } from "@/shared/in-app-onboarding";

function readStatus() {
  return { pending: isSetupPending(), returning: isReturningToSetup() };
}

/**
 * Whether the app window holds onboarding, and whether the person is new or
 * returning to it after an update.
 */
const status = base.handler(readStatus);

const live = {
  status: base.handler(async function* ({ signal }) {
    yield* liveRead({
      changes: [publisher.subscribe("onboarding.changed", { signal })],
      read: readStatus,
    });
  }),
};

/**
 * Records onboarding as done, so it does not show again until a later version
 * adds a step, and hands the window back to the app.
 */
const finish = base.handler(() => {
  getWorkspaceState().set("onboardingVersion", IN_APP_ONBOARDING_VERSION);
  finishAppWindowSetup();
  publisher.publish("onboarding.changed", null);
});

export const onboarding = { finish, live, status };
