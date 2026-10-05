import { base } from "@/electron-main/rpc/base";
import {
  openAppWindow,
  rememberedAppWindowState,
} from "@/electron-main/windows/app-window";
import {
  closeOnboardingWindow,
  growOnboardingWindow,
} from "@/electron-main/windows/onboarding";
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

export const onboarding = {
  complete,
};
