import { getAppStateStore } from "@/electron-main/stores/app-state";
import { app } from "electron";
import semver from "semver";

// import { logger } from "./electron-logger";

export function runMigrations(): void {
  const appStateStore = getAppStateStore();
  const lastMigratedVersion = appStateStore.get("lastMigratedVersion");
  const currentVersion = app.getVersion();

  // If this is a fresh install or we've already migrated to this version, skip
  if (lastMigratedVersion && semver.gte(lastMigratedVersion, currentVersion)) {
    return;
  }

  // logger.info(
  //   `Running migrations from version ${lastMigratedVersion ?? "initial install"} to ${currentVersion}`,
  // );

  // Update the last migrated version to current version
  appStateStore.set("lastMigratedVersion", currentVersion);

  // logger.info(`Migrations complete, updated to version ${currentVersion}`);
}
