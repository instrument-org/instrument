import { app } from "electron";
import fs from "node:fs/promises";
import path from "node:path";

import { storeFileOpenIcon, storeFileOpenNativeImage } from "./app-protocol";
import * as cacheStore from "./file-open-target/cache-store";
import { curateCandidates } from "./file-open-target/candidate-policy";
import {
  enumerateDarwinCandidates,
  renderDarwinIcons,
  resolveDarwinTarget,
} from "./file-open-target/resolve-darwin";
import { resolveLinuxTarget } from "./file-open-target/resolve-linux";
import { resolveWin32Target } from "./file-open-target/resolve-win32";
import {
  type CandidateApp,
  type FileOpenCandidate,
  type FileOpenTarget,
  type ResolvedApp,
} from "./file-open-target/types";

const COMMON_FILE_EXTENSIONS = [
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".txt",
  ".md",
  ".csv",
  ".json",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
];

// Resolution results that only make sense for this process: promises in flight,
// and per-path entries for files that have no extension to key on. Everything
// worth keeping across launches lives in cache-store.
const inFlightTargets = new Map<string, Promise<FileOpenTarget>>();
const sessionTargets = new Map<string, Promise<FileOpenTarget>>();
const candidatesCache = new Map<string, Promise<CandidateApp[]>>();
const iconCache = new Map<string, Promise<null | string>>();
const iconRefreshes = new Set<string>();

// Rejects when the lookup itself failed, so callers can tell "this file type
// has no alternate apps" apart from "we could not find out". Collapsing the two
// silently hides the picker with no way for the user to retry.
export async function getFileOpenCandidates(
  fullPath: string,
): Promise<FileOpenCandidate[]> {
  const apps = await getCandidateApps(fullPath);
  const candidates = curateCandidates(
    apps,
    path.extname(fullPath).toLowerCase(),
  );
  if (candidates.length === 0) {
    return [];
  }
  // Icons are decorative: a failed render leaves a fallback glyph in the menu
  // rather than costing the user the whole list.
  const icons = await resolveIcons(
    candidates.map((candidate) => candidate.appPath),
  );
  return candidates.map((candidate) => ({
    appName: candidate.appName,
    appPath: candidate.appPath,
    iconUrl: icons.get(candidate.appPath) ?? null,
    isDefault: candidate.isDefault,
  }));
}

export async function getFileOpenTarget(
  fullPath: string,
): Promise<FileOpenTarget> {
  const ext = path.extname(fullPath).toLowerCase();

  // Extension-less files can't share a cache key across files, so resolve them
  // per session without persisting per-path entries.
  if (!ext) {
    const existing = sessionTargets.get(fullPath);
    if (existing) {
      return existing.catch(() => fallbackTarget(fullPath));
    }
    const pending = resolveTarget(fullPath);
    sessionTargets.set(fullPath, pending);
    void pending.catch(() => {
      if (sessionTargets.get(fullPath) === pending) {
        sessionTargets.delete(fullPath);
      }
    });
    return pending.catch(() => fallbackTarget(fullPath));
  }

  const cached = await cacheStore.getTarget(ext);
  if (cached) {
    if (cached.isStale) {
      // Serve the cached value immediately but refresh in the background so a
      // changed default app is picked up without ever blocking the caller.
      refreshTargetInBackground(ext, fullPath);
    }
    return cached.value;
  }

  const inFlight = inFlightTargets.get(ext);
  if (inFlight) {
    return inFlight.catch(() => fallbackTarget(fullPath));
  }
  const pending = resolveAndStoreTarget(ext, fullPath);
  inFlightTargets.set(ext, pending);
  return pending.catch(() => fallbackTarget(fullPath));
}

// Seeds the persisted caches for the file types most commonly produced or
// viewed in Studio, so the first file a user opens has its picker ready.
// Enumerating apps costs about as much as resolving the single default app, and
// icons are shared across every file type that offers the same app, so warming
// candidates is bounded by the number of distinct apps on the machine.
export async function warmCommonFileOpenTargets() {
  if (process.platform !== "darwin") {
    return;
  }

  const cached = await Promise.all(
    COMMON_FILE_EXTENSIONS.map(async (extension) => ({
      extension,
      isCached:
        (await cacheStore.getTarget(extension)) != null &&
        (await cacheStore.getCandidates(extension)) != null,
    })),
  );
  const missingExtensions = cached
    .filter((entry) => !entry.isCached)
    .map((entry) => entry.extension);
  if (missingExtensions.length === 0) {
    return;
  }

  let tempDir: null | string = null;
  try {
    tempDir = await fs.mkdtemp(
      path.join(app.getPath("temp"), "instrument-file-open-targets-"),
    );
    // Sequential so warming never occupies every lookup slot and stalls a file
    // the user actually opened.
    for (const extension of missingExtensions) {
      const samplePath = path.join(tempDir, `sample${extension}`);
      await fs.writeFile(samplePath, "");
      await getFileOpenTarget(samplePath);
      await getFileOpenCandidates(samplePath).catch(() => []);
    }
  } catch {
    // A missed prewarm is harmless: the first real file resolves on demand.
  } finally {
    if (tempDir) {
      await fs.rm(tempDir, { force: true, recursive: true }).catch(() => null);
    }
  }
}

async function fallbackTarget(fullPath: string): Promise<FileOpenTarget> {
  return { appName: null, iconUrl: await getFileTypeIconUrl(fullPath) };
}

// The raw enumeration for a file type, before curation. Persisted in this form
// so a policy change takes effect on the next read.
async function getCandidateApps(fullPath: string): Promise<CandidateApp[]> {
  if (process.platform !== "darwin") {
    // Only macOS has a portable enumeration of every app that can open a file.
    return [];
  }
  const ext = path.extname(fullPath).toLowerCase();
  const key = ext || fullPath;
  const existing = candidatesCache.get(key);
  if (existing) {
    return existing;
  }
  const pending = ext
    ? getOrResolveCandidates(key, fullPath)
    : enumerateDarwinCandidates(fullPath);
  candidatesCache.set(key, pending);
  // Launch Services occasionally rejects a file even when its default app is
  // resolvable. Drop the failure so a later request retries rather than serving
  // a rejected promise for the rest of the session.
  void pending.catch(() => {
    if (candidatesCache.get(key) === pending) {
      candidatesCache.delete(key);
    }
  });
  return pending;
}

// `app.getFileIcon` only yields the file-type icon (a generic icon for .app
// bundles), so app icons come from the per-platform resolvers instead.
async function getFileTypeIconUrl(fullPath: string) {
  try {
    const icon = await app.getFileIcon(fullPath, { size: "normal" });
    return await storeFileOpenNativeImage(icon);
  } catch {
    return null;
  }
}

async function getOrResolveCandidates(
  key: string,
  fullPath: string,
): Promise<CandidateApp[]> {
  const cached = await cacheStore.getCandidates(key);
  if (cached) {
    if (cached.isStale) {
      refreshCandidatesInBackground(key, fullPath);
    }
    return cached.value;
  }
  return resolveAndStoreCandidates(key, fullPath);
}

function refreshCandidatesInBackground(key: string, fullPath: string) {
  const pending = resolveAndStoreCandidates(key, fullPath);
  void pending.then(
    (apps) => {
      candidatesCache.set(key, Promise.resolve(apps));
    },
    // A failed refresh changes nothing: the in-memory entry already resolved
    // with the stale list, and the persisted entry stays past its TTL so the
    // next session retries.
    () => null,
  );
}

// Guarded per app path, because a grid of files whose types share an app would
// otherwise queue one redundant render of that app per file type asking for it.
function refreshIconsInBackground(appPaths: string[]) {
  const pendingPaths = appPaths.filter(
    (appPath) => !iconRefreshes.has(appPath),
  );
  if (pendingPaths.length === 0) {
    return;
  }
  for (const appPath of pendingPaths) {
    iconRefreshes.add(appPath);
  }
  void resolveAndStoreIcons(pendingPaths)
    .then(
      (icons) => {
        for (const [appPath, iconUrl] of icons) {
          iconCache.set(appPath, Promise.resolve(iconUrl));
        }
      },
      () => null,
    )
    .finally(() => {
      for (const appPath of pendingPaths) {
        iconRefreshes.delete(appPath);
      }
    });
}

function refreshTargetInBackground(ext: string, fullPath: string) {
  if (inFlightTargets.has(ext)) {
    return;
  }
  const pending = resolveAndStoreTarget(ext, fullPath);
  inFlightTargets.set(ext, pending);
  // Background refresh failures are non-fatal; the stale value stays cached.
  void pending.catch(() => null);
}

async function resolveAndStoreCandidates(
  key: string,
  fullPath: string,
): Promise<CandidateApp[]> {
  const apps = await enumerateDarwinCandidates(fullPath);
  await cacheStore.setCandidates(key, apps);
  return apps;
}

async function resolveAndStoreIcons(appPaths: string[]) {
  const rendered = await renderDarwinIcons(appPaths);
  const stored = new Map<string, null | string>();
  await Promise.all(
    appPaths.map(async (appPath) => {
      stored.set(appPath, await storeFileOpenIcon(rendered.get(appPath) ?? ""));
    }),
  );
  await cacheStore.setIcons(stored);
  return stored;
}

async function resolveAndStoreTarget(
  ext: string,
  fullPath: string,
): Promise<FileOpenTarget> {
  try {
    const target = await resolveTarget(fullPath);
    await cacheStore.setTarget(ext, target);
    return target;
  } finally {
    inFlightTargets.delete(ext);
  }
}

async function resolveAssociatedApp(
  fullPath: string,
): Promise<null | ResolvedApp> {
  switch (process.platform) {
    case "darwin": {
      return resolveDarwinTarget(fullPath);
    }
    case "linux": {
      return resolveLinuxTarget(fullPath);
    }
    case "win32": {
      return resolveWin32Target(fullPath);
    }
    default: {
      return null;
    }
  }
}

// Resolves icons for the given app paths, reusing anything already rendered.
// Never rejects: every unresolved path maps to null.
async function resolveIcons(appPaths: string[]) {
  const resolved = new Map<string, null | string>();
  const pendingByPath = new Map<string, Promise<null | string>>();
  const missing: string[] = [];
  const stale: string[] = [];

  const wanted = [...new Set(appPaths)];
  const persisted = await cacheStore.getIcons(wanted);

  for (const appPath of wanted) {
    const inFlight = iconCache.get(appPath);
    if (inFlight) {
      pendingByPath.set(appPath, inFlight);
      continue;
    }
    const entry = persisted.get(appPath);
    if (entry) {
      resolved.set(appPath, entry.value);
      if (entry.isStale) {
        stale.push(appPath);
      }
      continue;
    }
    missing.push(appPath);
  }

  if (stale.length > 0) {
    refreshIconsInBackground(stale);
  }

  if (missing.length > 0) {
    const batch = resolveAndStoreIcons(missing);
    for (const appPath of missing) {
      const pending = batch.then((icons) => icons.get(appPath) ?? null);
      iconCache.set(appPath, pending);
      void pending.catch(() => {
        if (iconCache.get(appPath) === pending) {
          iconCache.delete(appPath);
        }
      });
      pendingByPath.set(appPath, pending);
    }
  }

  await Promise.all(
    [...pendingByPath].map(async ([appPath, pending]) => {
      resolved.set(appPath, await pending.catch(() => null));
    }),
  );
  return resolved;
}

async function resolveTarget(fullPath: string): Promise<FileOpenTarget> {
  const resolved = await resolveAssociatedApp(fullPath);
  const iconUrl = resolved?.iconUrl ?? (await getFileTypeIconUrl(fullPath));
  return { appName: resolved?.appName ?? null, iconUrl };
}
