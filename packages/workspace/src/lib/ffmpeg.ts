import path from "node:path";

/**
 * The folder holding ffmpeg's `bin/` (and `lib/` on Linux), as
 * apps/studio/scripts/download-ffmpeg.ts vendors it into Studio's
 * `resources/ffmpeg/`. Dev, tests and scripts bake in its absolute path. A
 * packaged build bakes in null: electron-builder unpacks `resources/**` into
 * `app.asar.unpacked/` beside the asar, under the process's resources path.
 */
declare const __FFMPEG_DIR__: null | string;

const FFMPEG_DIR =
  __FFMPEG_DIR__ ??
  path.join(
    electronResourcesPath(),
    "app.asar.unpacked",
    "resources",
    "ffmpeg",
  );

/** Electron's `process.resourcesPath`, which Node's own types do not declare. */
function electronResourcesPath(): string {
  const value: unknown = Reflect.get(process, "resourcesPath");
  if (typeof value !== "string") {
    throw new TypeError(
      "ffmpeg is resolved from Electron's resources path, and this process has none",
    );
  }
  return value;
}

const EXE = process.platform === "win32" ? ".exe" : "";

export const FFMPEG_PATH = path.join(FFMPEG_DIR, "bin", `ffmpeg${EXE}`);
export const FFPROBE_PATH = path.join(FFMPEG_DIR, "bin", `ffprobe${EXE}`);

/**
 * Env overlay that makes the bundled ffmpeg/ffprobe binaries resolvable from the
 * real subprocesses spawned by the escape hatches (tsx/node/pnpm). In the bash
 * tool `ffmpeg`/`ffprobe` are just-bash intercepts, but a script that shells out
 * (e.g. `execSync('ffmpeg ...')`) sees only the host PATH, which lacks them.
 * Prepends their dirs to PATH and sets the conventional FFMPEG_PATH/FFPROBE_PATH
 * vars that libraries like fluent-ffmpeg respect.
 */
export function ffmpegSubprocessEnv(
  basePath = process.env.PATH,
): Record<string, string> {
  const env: Record<string, string> = {
    FFMPEG_PATH,
    FFPROBE_PATH,
  };
  const dirs = [FFMPEG_PATH, FFPROBE_PATH]
    .filter((p) => path.isAbsolute(p))
    .map((p) => path.dirname(p));
  if (dirs.length > 0) {
    env.PATH = [...dirs, ...(basePath ? [basePath] : [])].join(path.delimiter);
  }
  return env;
}
