import { is } from "@electron-toolkit/utils";
import { APP_FLAVOR } from "@instrument-org/shared";
import { app } from "electron";

/**
 * Whether the launch asks to move the app into the Applications folder,
 * before anything else. A preview is meant to be tried where it was
 * unzipped and thrown away.
 */
export function asksToMoveToApplications() {
  return (
    process.platform === "darwin" &&
    !is.dev &&
    APP_FLAVOR.kind !== "preview" &&
    !app.isInApplicationsFolder() &&
    process.env.SKIP_MOVE_TO_APPLICATIONS !== "true"
  );
}
