import { type Options } from "@parcel/watcher";

/**
 * The in-process native backend, pinned per platform. Auto-detection prefers
 * Watchman when it's on PATH, and on Windows it probes for it by running
 * `watchman get-sockname` through `cmd.exe`: a console window pops up and
 * `subscribe` blocks for seconds before falling back
 * (parcel-bundler/watcher#155, #168). Because that probe runs on the thread
 * that owns the app window, a subscribe on the boot path freezes the UI.
 * Forcing the OS-native backend bypasses Watchman entirely; an unavailable
 * choice silently falls back to the platform default.
 *
 * Every `parcel.subscribe` call passes this.
 */
export const NATIVE_WATCHER_BACKEND: Options["backend"] =
  process.platform === "win32"
    ? "windows"
    : process.platform === "darwin"
      ? "fs-events"
      : "inotify";
