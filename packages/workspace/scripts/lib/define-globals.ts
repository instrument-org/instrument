import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

// Shared values for the build-time globals declared in
// src/lib/ffmpeg.ts and src/lib/agent-browser.ts. Used by vitest.config.ts
// (via vite `define`) and by run-workspace.ts (assigned to globalThis at
// runtime since tsx doesn't process `define`).
export const GLOBAL_DEFINES = {
  __AGENT_BROWSER_BIN_DIR__: path.dirname(
    require.resolve("agent-browser/bin/agent-browser.js"),
  ),
  __FFMPEG_STATIC_PATH__: require.resolve("ffmpeg-static"),
  __FFPROBE_STATIC_PATH__: require.resolve("@derhuerst/ffprobe-static"),
};

export function applyGlobalDefines() {
  Object.assign(globalThis, GLOBAL_DEFINES);
}
