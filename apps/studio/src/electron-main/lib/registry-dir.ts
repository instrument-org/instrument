import { app } from "electron";
import { existsSync } from "node:fs";
import path from "node:path";

import { logger } from "./electron-logger";

const REGISTRY_DIR_NAME = "registry";

let unpackagedRegistryDir = path.resolve(
  import.meta.dirname,
  `../../../../${REGISTRY_DIR_NAME}`,
);

const ENV_REGISTRY_DIR = import.meta.env.MAIN_VITE_APP_REGISTRY_DIR_PATH;

if (ENV_REGISTRY_DIR) {
  const absolutePath = path.resolve(ENV_REGISTRY_DIR);
  if (existsSync(absolutePath)) {
    logger.info("Using custom registry directory:", absolutePath);
  } else {
    // Honor the override anyway. Someone who set it wants that registry, and a
    // quiet fall back to the submodule reads as a working app with a registry
    // nobody chose, which is the harder failure to spot.
    logger.error(
      "Custom registry directory does not exist, so no skills will load:",
      absolutePath,
    );
  }
  unpackagedRegistryDir = absolutePath;
}

/**
 * The registry the app ships: the `instrument-org/skills` checkout, as the
 * submodule in development and as a copy under resources once packaged. The
 * workspace reads its skills from here, and the Ideas screen its page
 * templates and their captures.
 */
export function getRegistryDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, REGISTRY_DIR_NAME)
    : unpackagedRegistryDir;
}
