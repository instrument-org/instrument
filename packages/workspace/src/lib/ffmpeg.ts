import { createRequire } from "node:module";
import path from "node:path";

import { unpackAsarPath } from "./asar";

declare const __FFMPEG_STATIC_PATH__: string;
declare const __FFPROBE_STATIC_PATH__: string;

// ffmpeg-static and ffprobe-static are CJS and use __dirname, which breaks if
// bundled into ESM. In dev the vite config bakes in the absolute resolved path
// so createRequire can find it without node_modules alongside the output. In
// prod it bakes in the bare specifier, which the packaged node_modules resolves
// correctly at runtime.
const req = createRequire(import.meta.url);

// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const ffmpegPath: null | string = req(__FFMPEG_STATIC_PATH__);
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const ffprobePath: null | string = req(__FFPROBE_STATIC_PATH__);

export const FFMPEG_PATH = unpackAsarPath(ffmpegPath ?? "ffmpeg");
export const FFPROBE_PATH = unpackAsarPath(ffprobePath ?? "ffprobe");

/**
 * Env overlay that makes the bundled ffmpeg/ffprobe binaries resolvable from the
 * real subprocesses spawned by the escape hatches (tsx/node/pnpm). In the bash
 * tool `ffmpeg`/`ffprobe` are just-bash intercepts, but a script that shells out
 * (e.g. `execSync('ffmpeg ...')`) sees only the host PATH, which lacks them.
 * Prepends their dirs to PATH and sets the conventional FFMPEG_PATH/FFPROBE_PATH
 * vars that libraries like fluent-ffmpeg respect.
 */
export function ffmpegSubprocessEnv(): Record<string, string> {
  const env: Record<string, string> = {
    FFMPEG_PATH,
    FFPROBE_PATH,
  };
  const dirs = [FFMPEG_PATH, FFPROBE_PATH]
    .filter((p) => path.isAbsolute(p))
    .map((p) => path.dirname(p));
  if (dirs.length > 0) {
    env.PATH = [...dirs, ...(process.env.PATH ? [process.env.PATH] : [])].join(
      path.delimiter,
    );
  }
  return env;
}
