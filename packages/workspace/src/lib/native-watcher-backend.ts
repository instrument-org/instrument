import {
  type AsyncSubscription,
  type Options,
  type SubscribeCallback,
} from "@parcel/watcher";

/**
 * The surface of @parcel/watcher every watcher depends on, loaded dynamically so
 * the native binding resolves from node_modules at runtime instead of being
 * bundled. `backend` is required rather than optional, which is what stops a new
 * watcher from reaching the auto-detection path described below: omitting it is
 * a type error rather than a Windows-only hang nobody sees until it ships.
 *
 * `Ignore` is a parameter because each watcher narrows the upstream `string[]`
 * to its own dialect of pattern.
 */
export interface NativeWatcherApi<Ignore extends string[] = string[]> {
  subscribe: (
    dir: string,
    callback: SubscribeCallback,
    opts: Omit<Options, "backend" | "ignore"> & {
      backend: Options["backend"];
      ignore?: Ignore;
    },
  ) => Promise<AsyncSubscription>;
}

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
 * Every `parcel.subscribe` call passes this; {@link NativeWatcherApi} is what
 * makes that hold.
 */
export const NATIVE_WATCHER_BACKEND: Options["backend"] =
  process.platform === "win32"
    ? "windows"
    : process.platform === "darwin"
      ? "fs-events"
      : "inotify";
