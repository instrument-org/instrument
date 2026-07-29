import { z } from "zod";

import { storeFileOpenIcon } from "../app-protocol";
import {
  CANDIDATE_SCAN_LIMIT,
  DARWIN_CANDIDATES_SCRIPT,
  DARWIN_ICONS_SCRIPT,
  DARWIN_RESOLVE_SCRIPT,
  ICON_RENDER_SIZE,
} from "./darwin-scripts";
import { runThrottledHelper } from "./helper-process";
import { CandidateAppSchema, type ResolvedApp } from "./types";

const DarwinResultSchema = z.object({
  appName: z.string(),
  iconBase64: z.string(),
});

const DarwinCandidatesSchema = z.object({
  apps: z.array(CandidateAppSchema),
});

const DarwinIconsSchema = z.object({
  icons: z.array(z.object({ appPath: z.string(), iconBase64: z.string() })),
});

// Every app Launch Services will open the file with, structurally filtered but
// not yet curated, so the result is safe to persist across policy changes.
export async function enumerateDarwinCandidates(fullPath: string) {
  const stdout = await runThrottledHelper({
    args: [
      "-l",
      "JavaScript",
      "-e",
      DARWIN_CANDIDATES_SCRIPT,
      fullPath,
      String(CANDIDATE_SCAN_LIMIT),
    ],
    file: "osascript",
    maxBuffer: 4 * 1024 * 1024,
  });
  return DarwinCandidatesSchema.parse(JSON.parse(stdout)).apps;
}

// Renders one icon per app path in a single interpreter, returning raw base64.
// Storage is the caller's concern so a batch can be persisted in one pass.
export async function renderDarwinIcons(appPaths: string[]) {
  const stdout = await runThrottledHelper({
    args: [
      "-l",
      "JavaScript",
      "-e",
      DARWIN_ICONS_SCRIPT,
      String(ICON_RENDER_SIZE),
      ...appPaths,
    ],
    file: "osascript",
    maxBuffer: 32 * 1024 * 1024,
  });
  const parsed = DarwinIconsSchema.parse(JSON.parse(stdout));
  return new Map(parsed.icons.map((icon) => [icon.appPath, icon.iconBase64]));
}

export async function resolveDarwinTarget(
  fullPath: string,
): Promise<null | ResolvedApp> {
  const stdout = await runThrottledHelper({
    args: [
      "-l",
      "JavaScript",
      "-e",
      DARWIN_RESOLVE_SCRIPT,
      fullPath,
      String(ICON_RENDER_SIZE),
    ],
    file: "osascript",
    maxBuffer: 4 * 1024 * 1024,
  });
  const result = DarwinResultSchema.parse(JSON.parse(stdout));
  if (!result.appName) {
    return null;
  }
  return {
    appName: result.appName.replace(/\.app$/, ""),
    iconUrl: await storeFileOpenIcon(result.iconBase64),
  };
}
