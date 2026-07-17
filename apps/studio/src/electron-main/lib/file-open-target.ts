import { app } from "electron";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";

import { storeFileOpenIcon, storeFileOpenNativeImage } from "./app-protocol";

const execFileAsync = promisify(execFile);

interface FileOpenCandidate {
  appName: string;
  appPath: string;
  iconUrl: null | string;
}

interface FileOpenTarget {
  appName: null | string;
  iconUrl: null | string;
}

interface PersistedCandidateEntry {
  candidates: FileOpenCandidate[];
  resolvedAt: number;
}

interface PersistedEntry extends FileOpenTarget {
  resolvedAt: number;
}

const MAX_CANDIDATES = 12;
const LOOKUP_TIMEOUT_MS = 10_000;
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

// Resolution spawns helper processes and only depends on the file type, so
// both target and candidate results are application-wide extension caches.
// Refreshes also re-read icons, producing new content-addressed URLs if their
// bytes changed. Candidate lists change more often, so they refresh sooner.
const CACHE_VERSION = 4;
const TARGET_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CANDIDATE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_PERSISTED_CANDIDATES = 128;
const MAX_PERSISTED_TARGETS = 256;
const SAVE_DEBOUNCE_MS = 1000;

// diskCache doubles as the "loaded" sentinel for both persisted maps: await
// loadDiskCache() before touching diskCandidateCache.
let diskCache: Map<string, PersistedEntry> | null = null;
let diskCandidateCache = new Map<string, PersistedCandidateEntry>();
let diskCacheLoad: null | Promise<Map<string, PersistedEntry>> = null;
let saveTimer: null | ReturnType<typeof setTimeout> = null;
const inFlightTargets = new Map<string, Promise<FileOpenTarget>>();
const sessionTargets = new Map<string, Promise<FileOpenTarget>>();
const candidatesCache = new Map<string, Promise<FileOpenCandidate[]>>();

const PersistedEntrySchema = z.object({
  appName: z.string().nullable(),
  iconUrl: z.string().nullable(),
  resolvedAt: z.number(),
});

const FileOpenCandidateSchema = z.object({
  appName: z.string(),
  appPath: z.string(),
  iconUrl: z.string().nullable(),
});

const PersistedCandidateEntrySchema = z.object({
  candidates: z.array(FileOpenCandidateSchema),
  resolvedAt: z.number(),
});

const PersistedCacheSchema = z.object({
  candidateEntries: z
    .record(z.string(), PersistedCandidateEntrySchema)
    .optional(),
  entries: z.record(z.string(), PersistedEntrySchema),
  version: z.number(),
});

const DarwinResultSchema = z.object({
  appName: z.string(),
  iconBase64: z.string(),
});

const Win32ResultSchema = z.object({
  appName: z.string(),
  exePath: z.string(),
});

const DarwinCandidatesSchema = z.object({
  apps: z.array(
    z.object({
      appName: z.string(),
      appPath: z.string(),
      iconBase64: z.string(),
    }),
  ),
});

// Resolves the default app via NSWorkspace and returns its real icon
// (works for asset-catalog-only apps where reading the .icns would fail).
const DARWIN_RESOLVE_SCRIPT = `
ObjC.import("AppKit");
function run(argv) {
  const ws = $.NSWorkspace.sharedWorkspace;
  const result = { appName: "", iconBase64: "" };
  try {
    const url = ws.URLForApplicationToOpenURL($.NSURL.fileURLWithPath(argv[0]));
    const appPath = url.path.js;
    if (!appPath) {
      return JSON.stringify(result);
    }
    result.appName =
      $.NSFileManager.defaultManager.displayNameAtPath(appPath).js ?? "";
    const rep = $.NSBitmapImageRep.imageRepWithData(
      ws.iconForFile(appPath).TIFFRepresentation,
    );
    const png = rep.representationUsingTypeProperties(
      $.NSBitmapImageFileTypePNG,
      $.NSDictionary.dictionary,
    );
    result.iconBase64 = png.base64EncodedStringWithOptions(0).js ?? "";
  } catch {
    // fall through with whatever resolved so far
  }
  return JSON.stringify(result);
}
`;

// cspell:ignore NSURL
// Enumerates every app that can open the file (default first), deduped by name
// and capped, with each survivor's icon rendered to PNG.
const DARWIN_CANDIDATES_SCRIPT = `
ObjC.import("AppKit");
function run(argv) {
  const ws = $.NSWorkspace.sharedWorkspace;
  const fm = $.NSFileManager.defaultManager;
  const cap = parseInt(argv[1], 10) || 12;
  const out = { apps: [] };
  try {
    const urls = ws.URLsForApplicationsToOpenURL($.NSURL.fileURLWithPath(argv[0]));
    const count = urls.count;
    const seen = {};
    for (let i = 0; i < count && out.apps.length < cap; i++) {
      const appPath = urls.objectAtIndex(i).path.js;
      if (!appPath) continue;
      const name = (fm.displayNameAtPath(appPath).js ?? "").replace(/\\.app$/, "");
      if (!name || seen[name]) continue;
      seen[name] = true;
      let iconBase64 = "";
      try {
        const rep = $.NSBitmapImageRep.imageRepWithData(
          ws.iconForFile(appPath).TIFFRepresentation,
        );
        const png = rep.representationUsingTypeProperties(
          $.NSBitmapImageFileTypePNG,
          $.NSDictionary.dictionary,
        );
        iconBase64 = png.base64EncodedStringWithOptions(0).js ?? "";
      } catch {
        // an app without a resolvable icon still opens the file
      }
      out.apps.push({ appName: name, appPath: appPath, iconBase64: iconBase64 });
    }
  } catch {
    // no apps available for this type
  }
  return JSON.stringify(out);
}
`;

export async function getFileOpenCandidates(
  fullPath: string,
): Promise<FileOpenCandidate[]> {
  const ext = path.extname(fullPath).toLowerCase();
  const key = ext || fullPath;
  const existing = candidatesCache.get(key);
  if (existing) {
    return existing.catch(() => []);
  }
  const pending = ext
    ? getOrResolveCandidates(key, fullPath)
    : resolveCandidates(fullPath);
  candidatesCache.set(key, pending);
  void pending.catch(() => {
    if (candidatesCache.get(key) === pending) {
      candidatesCache.delete(key);
    }
  });
  // Launch Services occasionally rejects a file even when its default app is
  // resolvable. Alternate apps are optional, so keep the primary action usable
  // and let the cache eviction above allow a later request to retry.
  return pending.catch(() => []);
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

  const cache = await loadDiskCache();
  const entry = cache.get(ext);
  if (entry) {
    if (Date.now() - entry.resolvedAt >= TARGET_CACHE_TTL_MS) {
      // Serve the cached value immediately but refresh in the background so a
      // changed default app is picked up without ever blocking the caller.
      refreshTargetInBackground(ext, fullPath);
    }
    return { appName: entry.appName, iconUrl: entry.iconUrl };
  }

  const inFlight = inFlightTargets.get(ext);
  if (inFlight) {
    return inFlight.catch(() => fallbackTarget(fullPath));
  }
  const pending = resolveAndStore(ext, fullPath);
  inFlightTargets.set(ext, pending);
  return pending.catch(() => fallbackTarget(fullPath));
}

// Seeds the persisted default-target cache for the file types most commonly
// produced or viewed in Studio. Candidate lists stay on-demand because they
// require resolving icons for many apps per file type.
export async function warmCommonFileOpenTargets() {
  if (process.platform !== "darwin") {
    return;
  }

  const cache = await loadDiskCache();
  const missingExtensions = COMMON_FILE_EXTENSIONS.filter(
    (extension) => !cache.has(extension),
  );
  if (missingExtensions.length === 0) {
    return;
  }

  let tempDir: null | string = null;
  try {
    tempDir = await fs.mkdtemp(
      path.join(app.getPath("temp"), "instrument-file-open-targets-"),
    );
    for (const extension of missingExtensions) {
      const samplePath = path.join(tempDir, `sample${extension}`);
      await fs.writeFile(samplePath, "");
      await getFileOpenTarget(samplePath);
    }
  } catch {
    // A missed prewarm is harmless: the first real file resolves on demand.
  } finally {
    if (tempDir) {
      await fs.rm(tempDir, { force: true, recursive: true }).catch(() => null);
    }
  }
}

function cacheFilePath() {
  return path.join(app.getPath("userData"), "file-open-targets.json");
}

async function fallbackTarget(fullPath: string): Promise<FileOpenTarget> {
  return { appName: null, iconUrl: await getFileTypeIconUrl(fullPath) };
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
): Promise<FileOpenCandidate[]> {
  await loadDiskCache();
  const entry = diskCandidateCache.get(key);
  if (entry) {
    if (Date.now() - entry.resolvedAt >= CANDIDATE_CACHE_TTL_MS) {
      refreshCandidatesInBackground(key, fullPath);
    }
    return entry.candidates;
  }
  return resolveAndStoreCandidates(key, fullPath);
}

async function loadDiskCache(): Promise<Map<string, PersistedEntry>> {
  if (diskCache) {
    return diskCache;
  }
  diskCacheLoad ??= (async () => {
    const loaded = new Map<string, PersistedEntry>();
    try {
      const raw = await fs.readFile(cacheFilePath(), "utf8");
      const parsed = PersistedCacheSchema.parse(JSON.parse(raw));
      if (parsed.version === CACHE_VERSION) {
        for (const [ext, entry] of Object.entries(parsed.entries)) {
          loaded.set(ext, entry);
        }
        for (const [key, entry] of Object.entries(
          parsed.candidateEntries ?? {},
        )) {
          diskCandidateCache.set(key, entry);
        }
      }
    } catch {
      // Missing or unreadable cache is fine; it repopulates on demand.
    }
    diskCache ??= loaded;
    return diskCache;
  })().finally(() => {
    diskCacheLoad = null;
  });
  return diskCacheLoad;
}

async function readDesktopEntryName(desktopId: string) {
  const dataDirs = [
    path.join(os.homedir(), ".local/share"),
    // eslint-disable-next-line turbo/no-undeclared-env-vars
    ...(process.env.XDG_DATA_DIRS ?? "/usr/local/share:/usr/share").split(":"),
  ];
  for (const dir of dataDirs) {
    if (!dir) {
      continue;
    }
    try {
      const content = await fs.readFile(
        path.join(dir, "applications", desktopId),
        "utf8",
      );
      const name = /^Name=(.+)$/m.exec(content)?.[1]?.trim();
      if (name) {
        return name;
      }
    } catch {
      // not in this data dir; try the next one
    }
  }
  return null;
}

function refreshCandidatesInBackground(key: string, fullPath: string) {
  const pending = resolveAndStoreCandidates(key, fullPath);
  void pending.then(
    (candidates) => {
      candidatesCache.set(key, Promise.resolve(candidates));
    },
    // A failed refresh changes nothing: the in-memory entry already resolved
    // with the stale list, and the persisted entry stays past its TTL so the
    // next session retries.
    () => null,
  );
}

function refreshTargetInBackground(ext: string, fullPath: string) {
  if (inFlightTargets.has(ext)) {
    return;
  }
  const pending = resolveAndStore(ext, fullPath);
  inFlightTargets.set(ext, pending);
  // Background refresh failures are non-fatal; the stale value stays cached.
  void pending.catch(() => null);
}

async function resolveAndStore(
  ext: string,
  fullPath: string,
): Promise<FileOpenTarget> {
  try {
    const target = await resolveTarget(fullPath);
    const cache = await loadDiskCache();
    cache.set(ext, { ...target, resolvedAt: Date.now() });
    scheduleSave();
    return target;
  } finally {
    inFlightTargets.delete(ext);
  }
}

async function resolveAndStoreCandidates(
  key: string,
  fullPath: string,
): Promise<FileOpenCandidate[]> {
  const candidates = await resolveCandidates(fullPath);
  await loadDiskCache();
  diskCandidateCache.set(key, { candidates, resolvedAt: Date.now() });
  scheduleSave();
  return candidates;
}

async function resolveAssociatedApp(
  fullPath: string,
): Promise<null | { appName: string; iconUrl: null | string }> {
  switch (process.platform) {
    case "darwin": {
      return resolveDarwin(fullPath);
    }
    case "linux": {
      return resolveLinux(fullPath);
    }
    case "win32": {
      return resolveWin32(fullPath);
    }
    default: {
      return null;
    }
  }
}

async function resolveCandidates(
  fullPath: string,
): Promise<FileOpenCandidate[]> {
  if (process.platform !== "darwin") {
    // Only macOS has a portable enumeration of every app that can open a file.
    return [];
  }
  const { stdout } = await execFileAsync(
    "osascript",
    [
      "-l",
      "JavaScript",
      "-e",
      DARWIN_CANDIDATES_SCRIPT,
      fullPath,
      String(MAX_CANDIDATES),
    ],
    { maxBuffer: 64 * 1024 * 1024, timeout: LOOKUP_TIMEOUT_MS },
  );
  const parsed = DarwinCandidatesSchema.parse(JSON.parse(stdout));
  return await Promise.all(
    parsed.apps.map(async (candidate) => ({
      appName: candidate.appName,
      appPath: candidate.appPath,
      iconUrl: await storeFileOpenIcon(candidate.iconBase64),
    })),
  );
}

async function resolveDarwin(fullPath: string) {
  const { stdout } = await execFileAsync(
    "osascript",
    ["-l", "JavaScript", "-e", DARWIN_RESOLVE_SCRIPT, fullPath],
    // The icon PNG can be ~1MB of base64 (icons ship at 1024px).
    { maxBuffer: 16 * 1024 * 1024, timeout: LOOKUP_TIMEOUT_MS },
  );
  const result = DarwinResultSchema.parse(JSON.parse(stdout));
  if (!result.appName) {
    return null;
  }
  return {
    appName: result.appName.replace(/\.app$/, ""),
    iconUrl: await storeFileOpenIcon(result.iconBase64),
  };
}

async function resolveLinux(fullPath: string) {
  const { stdout: mimeOut } = await execFileAsync(
    "xdg-mime",
    ["query", "filetype", fullPath],
    { timeout: LOOKUP_TIMEOUT_MS },
  );
  const mime = mimeOut.trim();
  if (!mime) {
    return null;
  }
  const { stdout: desktopOut } = await execFileAsync(
    "xdg-mime",
    ["query", "default", mime],
    { timeout: LOOKUP_TIMEOUT_MS },
  );
  const desktopId = desktopOut.trim();
  if (!desktopId || desktopId.includes("/")) {
    return null;
  }
  const appName = await readDesktopEntryName(desktopId);
  if (!appName) {
    return null;
  }
  // No portable icon-theme lookup; callers get the file-type icon instead.
  return { appName, iconUrl: null };
}

async function resolveTarget(fullPath: string): Promise<FileOpenTarget> {
  const resolved = await resolveAssociatedApp(fullPath);
  const iconUrl = resolved?.iconUrl ?? (await getFileTypeIconUrl(fullPath));
  return { appName: resolved?.appName ?? null, iconUrl };
}

async function resolveWin32(fullPath: string) {
  const ext = path.extname(fullPath).toLowerCase();
  // The extension is interpolated into the script; only allow simple ones.
  if (!/^\.[a-z0-9]+$/.test(ext)) {
    return null;
  }
  // cspell:ignore HKCR HKCU
  // UserChoice is how Windows 10+ records the user's "always open with" pick;
  // the HKCR default is the pre-UserChoice fallback.
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$ext = '${ext}'
$progId = (Get-ItemProperty -Path "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\$ext\\UserChoice").ProgId
if (-not $progId) { $progId = (Get-ItemProperty -Path "Registry::HKEY_CLASSES_ROOT\\$ext").'(default)' }
if (-not $progId) { exit }
$command = (Get-ItemProperty -Path "Registry::HKEY_CLASSES_ROOT\\$progId\\shell\\open\\command").'(default)'
if (-not $command) { exit }
$exe = if ($command -match '^"([^"]+)"') { $Matches[1] } else { ($command -split ' ')[0] }
$exe = [Environment]::ExpandEnvironmentVariables($exe)
if (-not (Test-Path -LiteralPath $exe)) { exit }
$name = (Get-Item -LiteralPath $exe).VersionInfo.FileDescription
if (-not $name) { $name = [IO.Path]::GetFileNameWithoutExtension($exe) }
@{ appName = $name; exePath = $exe } | ConvertTo-Json -Compress
`;
  const { stdout } = await execFileAsync(
    "powershell",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { timeout: LOOKUP_TIMEOUT_MS },
  );
  const trimmed = stdout.trim();
  if (!trimmed) {
    return null;
  }
  const result = Win32ResultSchema.parse(JSON.parse(trimmed));
  // On Windows getFileIcon on the .exe does return the app icon.
  const icon = await app
    .getFileIcon(result.exePath, { size: "normal" })
    .catch(() => null);
  return {
    appName: result.appName,
    iconUrl: icon ? await storeFileOpenNativeImage(icon) : null,
  };
}

async function saveDiskCache() {
  if (!diskCache) {
    return;
  }
  diskCache = trimToNewest(diskCache, MAX_PERSISTED_TARGETS);
  diskCandidateCache = trimToNewest(
    diskCandidateCache,
    MAX_PERSISTED_CANDIDATES,
  );
  const payload = {
    candidateEntries: Object.fromEntries(diskCandidateCache),
    entries: Object.fromEntries(diskCache),
    version: CACHE_VERSION,
  };
  try {
    await fs.writeFile(cacheFilePath(), JSON.stringify(payload), "utf8");
  } catch {
    // Best effort; a failed write just means we re-resolve next run.
  }
}

function scheduleSave() {
  if (saveTimer) {
    return;
  }
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void saveDiskCache();
  }, SAVE_DEBOUNCE_MS);
}

function trimToNewest<T extends { resolvedAt: number }>(
  entries: Map<string, T>,
  max: number,
) {
  if (entries.size <= max) {
    return entries;
  }
  return new Map(
    [...entries.entries()]
      .sort((a, b) => b[1].resolvedAt - a[1].resolvedAt)
      .slice(0, max),
  );
}
