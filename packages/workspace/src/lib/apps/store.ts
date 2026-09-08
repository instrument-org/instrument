import { err, ok, type Result } from "neverthrow";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { type AbsolutePath } from "../../schemas/paths";
import { absolutePathJoin } from "../absolute-path-join";
import { APP_COMMAND } from "../shell-commands/app-command";
import { getWorkspaceConfig } from "../workspace-config";
import {
  APP_GUIDE_FILE_NAME,
  APP_MANIFEST_FILE_NAME,
  type AppManifest,
  AppManifestSchema,
  type AppSlug,
  AppSlugSchema,
} from "./manifest";

export interface AppInfo {
  dir: AbsolutePath;
  manifest: AppManifest;
  /** What the connection record is pinned to: the manifest as it is on disk. */
  manifestHash: string;
  slug: AppSlug;
}

interface AppLoadError {
  message: string;
  reason: "invalid-manifest" | "invalid-slug" | "not-found";
}

/** The workspace's own `apps/` directory, where every app folder lives. */
export function getWorkspaceAppsDir(): AbsolutePath {
  return getWorkspaceConfig().appsDir;
}

/**
 * Read every app folder under `appsDir`. Folders whose manifest fails to
 * parse are returned separately so callers (the Apps screen, `app list`) can
 * surface the problem instead of silently hiding the app.
 */
export async function listApps(appsDir: AbsolutePath): Promise<{
  apps: AppInfo[];
  invalid: { message: string; slug: string }[];
}> {
  let entries;
  try {
    entries = await fs.readdir(appsDir, { withFileTypes: true });
  } catch {
    return { apps: [], invalid: [] };
  }

  const apps: AppInfo[] = [];
  const invalid: { message: string; slug: string }[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) {
      continue;
    }
    const result = await loadApp(appsDir, entry.name);
    if (result.isOk()) {
      apps.push(result.value);
    } else if (result.error.reason !== "not-found") {
      invalid.push({ message: result.error.message, slug: entry.name });
    }
  }

  return { apps, invalid };
}

export async function loadApp(
  appsDir: AbsolutePath,
  rawSlug: string,
): Promise<Result<AppInfo, AppLoadError>> {
  const slugResult = AppSlugSchema.safeParse(rawSlug);
  if (!slugResult.success) {
    return err({
      message: `"${rawSlug}" is not an app slug (lowercase letters, digits, and hyphens).`,
      reason: "invalid-slug",
    });
  }
  const slug = slugResult.data;
  const dir = absolutePathJoin(appsDir, slug);
  const manifestPath = path.join(dir, APP_MANIFEST_FILE_NAME);

  let raw: string;
  try {
    raw = await fs.readFile(manifestPath, "utf8");
  } catch {
    return err({
      message: `App "${slug}" has no ${APP_MANIFEST_FILE_NAME}.`,
      reason: "not-found",
    });
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    return err({
      message: `${APP_MANIFEST_FILE_NAME} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      reason: "invalid-manifest",
    });
  }

  const parsed = AppManifestSchema.safeParse(json);
  if (!parsed.success) {
    return err({
      message: `${APP_MANIFEST_FILE_NAME} is invalid: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`,
      reason: "invalid-manifest",
    });
  }

  return ok({
    dir,
    manifest: parsed.data,
    manifestHash: manifestHash(parsed.data),
    slug,
  });
}

export async function readAppGuide(
  appDir: AbsolutePath,
): Promise<null | string> {
  try {
    const guide = await fs.readFile(
      path.join(appDir, APP_GUIDE_FILE_NAME),
      "utf8",
    );
    return guide.trim() === "" ? null : guide;
  } catch {
    return null;
  }
}

/**
 * The prompts `guideSkeleton` leaves for the agent to answer, in one place so
 * the skeleton that writes them and the check that looks for them cannot drift
 * apart.
 */
const GUIDE_PROMPTS = {
  conventions:
    "Anything a request has to get right that the service does not say in its errors.",
  endpoints:
    "List the endpoints the work needs, with an example each: the method, the path relative to the base URL, the parameters, and what comes back. Pagination and rate limits go here too.",
  local:
    "Say here what has to be true on this machine for it to work (an app installed, a file in place).",
  purpose: "What this app is for, in a sentence or two.",
} as const;

/**
 * Which of the skeleton's prompts are still sitting in a guide unanswered.
 *
 * The guide is what the first request in a task is handed instead of its
 * answer, so a folder that connects with the skeleton in place spends that
 * turn showing the agent the form it was asked to fill in. Every prompt still
 * there is a question about the service nobody wrote down.
 */
export function guidePlaceholdersLeft(guide: string): string[] {
  return Object.values(GUIDE_PROMPTS).filter((prompt) =>
    guide.includes(prompt),
  );
}

/** A guide the agent fills in: what the app is for, and how it is reached. */
export function guideSkeleton(manifest: AppManifest): string {
  const reach =
    manifest.type === "mcp-local"
      ? `Runs on this machine from the ${manifest.runtime === "node" ? "npm" : "PyPI"} package ${manifest.package}: \`${APP_COMMAND.name} tools <slug>\` lists what it can do, \`${APP_COMMAND.name} call <slug> <tool> '<json>'\` runs one. ${GUIDE_PROMPTS.local}`
      : manifest.type === "mcp"
        ? `Reached through its MCP server at ${manifest.url}: \`${APP_COMMAND.name} tools <slug>\` lists what it can do, \`${APP_COMMAND.name} call <slug> <tool> '<json>'\` runs one.`
        : `Reached through its API at ${manifest.baseUrl}: \`${APP_COMMAND.name} request <slug> GET /path\`.\n\n## Endpoints\n\n${GUIDE_PROMPTS.endpoints}`;
  return `# ${manifest.name}\n\n${GUIDE_PROMPTS.purpose}\n\n${reach}\n\n## Conventions\n\n${GUIDE_PROMPTS.conventions}\n`;
}

/** Write a manifest and, when the folder has none, a guide to fill in. */
export async function writeAppFolder({
  appsDir,
  guide,
  manifest,
  slug,
}: {
  appsDir: AbsolutePath;
  guide: string;
  manifest: AppManifest;
  slug: AppSlug;
}): Promise<AbsolutePath> {
  const dir = absolutePathJoin(appsDir, slug);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, APP_MANIFEST_FILE_NAME),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  const guidePath = path.join(dir, APP_GUIDE_FILE_NAME);
  if ((await readAppGuide(dir)) === null) {
    await fs.writeFile(guidePath, guide, "utf8");
  }
  return dir;
}

/**
 * A digest of the manifest as parsed, so a connection record can say which
 * manifest passed the test and a call can refuse one edited since. Over the
 * parsed value rather than the file's bytes, so reformatting the JSON is not
 * a change.
 */
function manifestHash(manifest: AppManifest): string {
  return createHash("sha256")
    .update(JSON.stringify(sortKeys(manifest)))
    .digest("hex")
    .slice(0, 32);
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortKeys(child)]),
    );
  }
  return value;
}
