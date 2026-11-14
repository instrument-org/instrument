import fs from "node:fs";
import path from "node:path";

import { DEVICE_ID_PATTERN } from "../records/device-id";

const DEVICE_FOLDER = new RegExp(`^${DEVICE_ID_PATTERN}$`);

/**
 * Watches the devices folder for a file directly in a device's folder whose
 * name `isOurs` takes changing: the folder as one tree where the system
 * watches a tree with one handle (macOS, Windows), and elsewhere the folder
 * and each device's folder in it, picking up a device's folder as it appears.
 * A watch that is not `persistent` does not keep the process alive.
 */
export function watchDevices({
  devicesDir,
  isOurs,
  onChange,
  onError,
  persistent = true,
  platform,
}: {
  devicesDir: string;
  isOurs: (name: string) => boolean;
  onChange: () => void;
  onError: (error: unknown) => void;
  persistent?: boolean;
  platform: NodeJS.Platform;
}): () => void {
  try {
    fs.mkdirSync(devicesDir, { recursive: true });
  } catch (error) {
    onError(error);
    return () => undefined;
  }
  const watchFolder = (
    dir: string,
    recursive: boolean,
    onEvent: (filename: null | string) => void,
  ) => watchOne(dir, { persistent, recursive }, onEvent, onError);
  if (platform === "darwin" || platform === "win32") {
    return watchFolder(devicesDir, true, (filename) => {
      const [folder, name, ...deeper] = (filename ?? "").split(/[\\/]/);
      if (
        filename === null ||
        (folder !== undefined &&
          DEVICE_FOLDER.test(folder) &&
          name !== undefined &&
          deeper.length === 0 &&
          isOurs(name))
      ) {
        onChange();
      }
    });
  }
  const folders = new Map<string, () => void>();
  const attend = () => {
    for (const folder of namesIn(devicesDir)) {
      if (DEVICE_FOLDER.test(folder) && !folders.has(folder)) {
        folders.set(
          folder,
          watchFolder(path.join(devicesDir, folder), false, (name) => {
            if (name === null || isOurs(name)) {
              onChange();
            }
          }),
        );
      }
    }
  };
  attend();
  const stopTop = watchFolder(devicesDir, false, () => {
    attend();
    onChange();
  });
  return () => {
    stopTop();
    for (const stop of folders.values()) {
      stop();
    }
  };
}

/** Watches a folder, answering how to stop. A watch that fails is said and closed. */
function watchOne(
  dir: string,
  options: { persistent: boolean; recursive: boolean },
  onEvent: (filename: null | string) => void,
  onError: (error: unknown) => void,
): () => void {
  let watcher: fs.FSWatcher;
  try {
    watcher = fs.watch(dir, options, (_event, filename) => {
      onEvent(filename);
    });
  } catch (error) {
    onError(error);
    return () => undefined;
  }
  watcher.on("error", (error) => {
    onError(error);
    watcher.close();
  });
  return () => {
    watcher.close();
  };
}

function namesIn(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}
