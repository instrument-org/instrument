import { createRequire } from "node:module";
import path from "node:path";

import { unpackAsarPath } from "./asar";

declare const __FFMPEG_FFPROBE_STATIC_PATH__: string;

// ffmpeg-ffprobe-static is CJS and uses __dirname, which breaks if bundled into
// ESM. In dev the vite config bakes in the absolute resolved path so
// createRequire can find it without node_modules alongside the output. In prod
// it bakes in the bare specifier, which the packaged node_modules resolves
// correctly at runtime.
const req = createRequire(import.meta.url);

// Both paths come from one package, which returns null for a platform/arch it
// publishes no binary for.
// oxlint-disable-next-line typescript/no-unsafe-assignment
const binaries: { ffmpegPath: null | string; ffprobePath: null | string } = req(
  __FFMPEG_FFPROBE_STATIC_PATH__,
);

export const FFMPEG_PATH = unpackAsarPath(binaries.ffmpegPath ?? "ffmpeg");
export const FFPROBE_PATH = unpackAsarPath(binaries.ffprobePath ?? "ffprobe");

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
