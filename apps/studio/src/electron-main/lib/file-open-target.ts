import { app } from "electron";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";

import { storeFileOpenIcon, storeFileOpenNativeImage } from "./app-protocol";

const execFileAsync = promisify(execFile);

// An app that can open a file, before its icon has been resolved. Icons are
// keyed by app path rather than by file type, so they are cached and rendered
// once per app instead of once per app per extension.
interface CandidateApp {
  appName: string;
  appPath: string;
  bundleId: string;
  isDefault: boolean;
}

interface FileOpenCandidate {
  appName: string;
  appPath: string;
  iconUrl: null | string;
  isDefault: boolean;
}

interface FileOpenTarget {
  appName: null | string;
  iconUrl: null | string;
}

interface PersistedCandidateEntry {
  apps: CandidateApp[];
  resolvedAt: number;
}

interface PersistedEntry extends FileOpenTarget {
  resolvedAt: number;
}

interface PersistedIconEntry {
  iconUrl: null | string;
  resolvedAt: number;
}

const MAX_CANDIDATES = 16;
// Enumeration is cheap, so scan well past the cap and let the exclusion filter
// below run before truncating.
const CANDIDATE_SCAN_LIMIT = 64;
const LOOKUP_TIMEOUT_MS = 10_000;
// cspell:ignore downsampled
// Rendered at 2x by the compositor, then downsampled to the menu's 64px by
// storeFileOpenIcon. Asking macOS for the icon's native size instead produces
// ~1.6MB of base64 per app.
const ICON_RENDER_SIZE = 128;
// osascript lookups are CPU- and LaunchServices-bound. A file grid can mount
// many open buttons at once, and letting every distinct extension spawn its own
// interpreter pushes them all past LOOKUP_TIMEOUT_MS together.
const MAX_CONCURRENT_LOOKUPS = 2;
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

// Apps that claim broad document types but never usefully open them, and that
// no structural rule in DARWIN_CANDIDATES_SCRIPT rules out. Only Apple's own
// bundled apps are listed: a third-party app is on the machine because someone
// installed it, and second-guessing that ages badly. Filtered results are what
// gets persisted, so editing this list requires bumping CACHE_VERSION.
const EXCLUDED_BUNDLE_IDS = new Set([
  // Claims the common image types to inspect and assign color profiles, which
  // is not what "open this image" means.
  "com.apple.ColorSyncUtility",
  // Claims public.plain-text, so it shows up for Markdown and source files, but
  // opening one only offers to import it as a trace. Its name also collides
  // with ours in the menu.
  "com.apple.dt.Instruments",
  // Claims .txt and opens it as an AppleScript source buffer rather than text.
  "com.apple.ScriptEditor2",
]);

// Apps that genuinely open part of what they claim. Each maps to the extensions
// it stays listed for and is hidden everywhere else, which is finer-grained
// than dropping them outright would allow. Also persisted, so the same
// CACHE_VERSION caveat applies.
const RESTRICTED_BUNDLE_IDS = new Map([
  // Claims public.data as a viewer, so it offers itself for every document a
  // task produces despite being a slow launch that helps only with code.
  [
    "com.apple.dt.Xcode",
    new Set([
      ".c",
      ".cc",
      ".cpp",
      ".entitlements",
      ".h",
      ".hpp",
      ".m",
      ".metal",
      ".mm",
      ".playground",
      ".plist",
      ".storyboard",
      ".strings",
      ".swift",
      ".xib",
    ]),
  ],
  // cspell:ignore ibooks
  ["com.apple.iBooksX", new Set([".epub", ".ibooks", ".pdf"])],
  // Both iWork apps claim public.plain-text, putting them in front of Markdown,
  // logs and source files they would import as prose or a table.
  [
    "com.apple.iWork.Numbers",
    new Set([".csv", ".numbers", ".tsv", ".xls", ".xlsx"]),
  ],
  [
    "com.apple.iWork.Pages",
    new Set([".doc", ".docx", ".pages", ".rtf", ".txt"]),
  ],
  // Claims public.folder, which surfaces it for still images it would only
  // import as an image sequence.
  [
    "com.apple.QuickTimePlayerX",
    new Set([
      ".aac",
      ".aif",
      ".aiff",
      ".avi",
      ".m4a",
      ".m4v",
      ".mov",
      ".mp3",
      ".mp4",
      ".wav",
    ]),
  ],
]);

// Resolution spawns helper processes and only depends on the file type, so
// both target and candidate results are application-wide extension caches.
// Refreshes also re-read icons, producing new content-addressed URLs if their
// bytes changed. Candidate lists change more often, so they refresh sooner.
const CACHE_VERSION = 7;
const TARGET_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CANDIDATE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const ICON_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_PERSISTED_CANDIDATES = 128;
const MAX_PERSISTED_ICONS = 512;
const MAX_PERSISTED_TARGETS = 256;
const SAVE_DEBOUNCE_MS = 1000;

// diskCache doubles as the "loaded" sentinel for every persisted map: await
// loadDiskCache() before touching diskCandidateCache or diskIconCache.
let diskCache: Map<string, PersistedEntry> | null = null;
let diskCandidateCache = new Map<string, PersistedCandidateEntry>();
let diskIconCache = new Map<string, PersistedIconEntry>();
let diskCacheLoad: null | Promise<Map<string, PersistedEntry>> = null;
let saveTimer: null | ReturnType<typeof setTimeout> = null;
const inFlightTargets = new Map<string, Promise<FileOpenTarget>>();
const sessionTargets = new Map<string, Promise<FileOpenTarget>>();
const candidatesCache = new Map<string, Promise<CandidateApp[]>>();
const iconCache = new Map<string, Promise<null | string>>();

let activeLookups = 0;
const lookupQueue: (() => void)[] = [];

const PersistedEntrySchema = z.object({
  appName: z.string().nullable(),
  iconUrl: z.string().nullable(),
  resolvedAt: z.number(),
});

const CandidateAppSchema = z.object({
  appName: z.string(),
  appPath: z.string(),
  bundleId: z.string(),
  isDefault: z.boolean(),
});

const PersistedCandidateEntrySchema = z.object({
  apps: z.array(CandidateAppSchema),
  resolvedAt: z.number(),
});

const PersistedIconEntrySchema = z.object({
  iconUrl: z.string().nullable(),
  resolvedAt: z.number(),
});

const PersistedCacheSchema = z.object({
  candidateEntries: z
    .record(z.string(), PersistedCandidateEntrySchema)
    .optional(),
  entries: z.record(z.string(), PersistedEntrySchema),
  iconEntries: z.record(z.string(), PersistedIconEntrySchema).optional(),
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

const DarwinCandidatesSchema = z.object({ apps: z.array(CandidateAppSchema) });

const DarwinIconsSchema = z.object({
  icons: z.array(z.object({ appPath: z.string(), iconBase64: z.string() })),
});

// Composites the app icon into a fixed-size canvas. NSImage exposes an icon's
// representations largest-first, so encoding one directly would ship a 1024px
// PNG; drawing into a sized canvas is what bounds the cost.
const DARWIN_RENDER_ICON_FN = `
function renderIcon(image, size) {
  const canvas = $.NSImage.alloc.initWithSize($.NSMakeSize(size, size));
  canvas.lockFocus;
  image.drawInRectFromRectOperationFraction(
    $.NSMakeRect(0, 0, size, size),
    $.NSMakeRect(0, 0, 0, 0),
    $.NSCompositingOperationSourceOver,
    1.0,
  );
  canvas.unlockFocus;
  const rep = $.NSBitmapImageRep.imageRepWithData(canvas.TIFFRepresentation);
  const png = rep.representationUsingTypeProperties(
    $.NSBitmapImageFileTypePNG,
    $.NSDictionary.dictionary,
  );
  return png.base64EncodedStringWithOptions(0).js ?? "";
}
`;

// Resolves the default app via NSWorkspace and returns its real icon
// (works for asset-catalog-only apps where reading the .icns would fail).
const DARWIN_RESOLVE_SCRIPT = `
ObjC.import("AppKit");
${DARWIN_RENDER_ICON_FN}
function run(argv) {
  const ws = $.NSWorkspace.sharedWorkspace;
  const size = parseInt(argv[1], 10) || 128;
  const result = { appName: "", iconBase64: "" };
  try {
    const url = ws.URLForApplicationToOpenURL($.NSURL.fileURLWithPath(argv[0]));
    const appPath = url.path.js;
    if (!appPath) {
      return JSON.stringify(result);
    }
    result.appName =
      $.NSFileManager.defaultManager.displayNameAtPath(appPath).js ?? "";
    result.iconBase64 = renderIcon(ws.iconForFile(appPath), size);
  } catch {
    // fall through with whatever resolved so far
  }
  return JSON.stringify(result);
}
`;

// cspell:ignore NSURL LSUI
// Enumerates every app that can open the file (default first). Unusable
// candidates are dropped before deduping, so an app that also has a copy in a
// cache directory is still offered from its real location. Icons are resolved
// separately, per app, by DARWIN_ICONS_SCRIPT.
const DARWIN_CANDIDATES_SCRIPT = `
ObjC.import("AppKit");
// Apps bundled inside another app (Xcode's Instruments, Electron helpers) are
// reachable through Launch Services but are not things a user opens documents
// with.
function isNested(appPath) {
  return appPath.slice(0, appPath.lastIndexOf("/")).indexOf(".app/") !== -1;
}
// Copies unpacked by package managers and test harnesses claim file types just
// like a real install, and a developer machine accumulates many of them.
function isUnusableLocation(appPath) {
  const lower = appPath.toLowerCase();
  const fragments = [
    "/caches/",
    "/.cache/",
    "/node_modules/",
    "/.trash/",
    "/private/var/folders/",
  ];
  for (let i = 0; i < fragments.length; i++) {
    if (lower.indexOf(fragments[i]) !== -1) return true;
  }
  return false;
}
// Background agents declare document types but have no window to open into.
function isBackgroundAgent(bundle) {
  const info = bundle.infoDictionary;
  if (info.isNil()) return false;
  const uiElement = info.objectForKey("LSUIElement");
  if (uiElement.isNil()) return false;
  const value = String(uiElement.js);
  return value === "1" || value === "true";
}
function defaultAppPath(ws, filePath) {
  try {
    const url = ws.URLForApplicationToOpenURL($.NSURL.fileURLWithPath(filePath));
    return url.isNil() ? "" : (url.path.js ?? "");
  } catch {
    return "";
  }
}
function run(argv) {
  const ws = $.NSWorkspace.sharedWorkspace;
  const fm = $.NSFileManager.defaultManager;
  const cap = parseInt(argv[1], 10) || 64;
  const defaultPath = defaultAppPath(ws, argv[0]);
  const out = { apps: [] };
  try {
    const urls = ws.URLsForApplicationsToOpenURL($.NSURL.fileURLWithPath(argv[0]));
    const count = urls.count;
    const seen = {};
    for (let i = 0; i < count && out.apps.length < cap; i++) {
      const appPath = urls.objectAtIndex(i).path.js;
      if (!appPath) continue;
      // Whatever the system already opens this file with stays listed, so no
      // rule here can disagree with the "Open in {app}" button beside the menu.
      const isDefault = appPath === defaultPath;
      if (!isDefault && (isNested(appPath) || isUnusableLocation(appPath))) continue;
      const bundle = $.NSBundle.bundleWithPath(appPath);
      if (bundle.isNil()) continue;
      if (!isDefault && isBackgroundAgent(bundle)) continue;
      const bundleId = bundle.bundleIdentifier.js ?? "";
      const name = (fm.displayNameAtPath(appPath).js ?? "").replace(/\\.app$/, "");
      const key = bundleId || name;
      if (!name || seen[key]) continue;
      seen[key] = true;
      out.apps.push({
        appName: name,
        appPath: appPath,
        bundleId: bundleId,
        isDefault: isDefault,
      });
    }
  } catch {
    // no apps available for this type
  }
  return JSON.stringify(out);
}
`;

// Renders one icon per app path passed in argv, in a single interpreter.
const DARWIN_ICONS_SCRIPT = `
ObjC.import("AppKit");
${DARWIN_RENDER_ICON_FN}
function run(argv) {
  const ws = $.NSWorkspace.sharedWorkspace;
  const size = parseInt(argv[0], 10) || 128;
  const out = { icons: [] };
  for (let i = 1; i < argv.length; i++) {
    let iconBase64 = "";
    try {
      iconBase64 = renderIcon(ws.iconForFile(argv[i]), size);
    } catch {
      // an app without a resolvable icon still opens the file
    }
    out.icons.push({ appPath: argv[i], iconBase64: iconBase64 });
  }
  return JSON.stringify(out);
}
`;

// Rejects when the lookup itself failed, so callers can tell "this file type
// has no alternate apps" apart from "we could not find out". Collapsing the two
// silently hides the picker with no way for the user to retry.
export async function getFileOpenCandidates(
  fullPath: string,
): Promise<FileOpenCandidate[]> {
  const apps = await getCandidateApps(fullPath);
  if (apps.length === 0) {
    return [];
  }
  // Icons are decorative: a failed render leaves a fallback glyph in the menu
  // rather than costing the user the whole list.
  const icons = await resolveIcons(apps.map((candidate) => candidate.appPath));
  return apps.map((candidate) => ({
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

// Seeds the persisted caches for the file types most commonly produced or
// viewed in Studio, so the first file a user opens has its picker ready.
// Enumerating apps costs about as much as resolving the single default app, and
// icons are shared across every file type that offers the same app, so warming
// candidates is bounded by the number of distinct apps on the machine.
export async function warmCommonFileOpenTargets() {
  if (process.platform !== "darwin") {
    return;
  }

  const cache = await loadDiskCache();
  const missingExtensions = COMMON_FILE_EXTENSIONS.filter(
    (extension) => !cache.has(extension) || !diskCandidateCache.has(extension),
  );
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

function cacheFilePath() {
  return path.join(app.getPath("userData"), "file-open-targets.json");
}

async function fallbackTarget(fullPath: string): Promise<FileOpenTarget> {
  return { appName: null, iconUrl: await getFileTypeIconUrl(fullPath) };
}

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
    : resolveCandidates(fullPath);
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
  await loadDiskCache();
  const entry = diskCandidateCache.get(key);
  if (entry) {
    if (Date.now() - entry.resolvedAt >= CANDIDATE_CACHE_TTL_MS) {
      refreshCandidatesInBackground(key, fullPath);
    }
    return entry.apps;
  }
  return resolveAndStoreCandidates(key, fullPath);
}

function isUsefulCandidate(candidate: CandidateApp, ext: string) {
  // The system's own choice is never second-guessed; it is what the primary
  // "Open in {app}" button already launches.
  if (candidate.isDefault) {
    return true;
  }
  if (EXCLUDED_BUNDLE_IDS.has(candidate.bundleId)) {
    return false;
  }
  const allowedExtensions = RESTRICTED_BUNDLE_IDS.get(candidate.bundleId);
  return allowedExtensions ? allowedExtensions.has(ext) : true;
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
        for (const [appPath, entry] of Object.entries(
          parsed.iconEntries ?? {},
        )) {
          diskIconCache.set(appPath, entry);
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
    (apps) => {
      candidatesCache.set(key, Promise.resolve(apps));
    },
    // A failed refresh changes nothing: the in-memory entry already resolved
    // with the stale list, and the persisted entry stays past its TTL so the
    // next session retries.
    () => null,
  );
}

function refreshIconsInBackground(appPaths: string[]) {
  void resolveAndStoreIcons(appPaths).then(
    (icons) => {
      for (const [appPath, iconUrl] of icons) {
        iconCache.set(appPath, Promise.resolve(iconUrl));
      }
    },
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

async function renderIcons(appPaths: string[]) {
  const { stdout } = await withLookupSlot(() =>
    execFileAsync(
      "osascript",
      [
        "-l",
        "JavaScript",
        "-e",
        DARWIN_ICONS_SCRIPT,
        String(ICON_RENDER_SIZE),
        ...appPaths,
      ],
      { maxBuffer: 32 * 1024 * 1024, timeout: LOOKUP_TIMEOUT_MS },
    ),
  );
  const parsed = DarwinIconsSchema.parse(JSON.parse(stdout));
  return new Map(parsed.icons.map((icon) => [icon.appPath, icon.iconBase64]));
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
): Promise<CandidateApp[]> {
  const apps = await resolveCandidates(fullPath);
  await loadDiskCache();
  diskCandidateCache.set(key, { apps, resolvedAt: Date.now() });
  scheduleSave();
  return apps;
}

async function resolveAndStoreIcons(appPaths: string[]) {
  const rendered = await renderIcons(appPaths);
  const stored = new Map<string, null | string>();
  await Promise.all(
    appPaths.map(async (appPath) => {
      stored.set(appPath, await storeFileOpenIcon(rendered.get(appPath) ?? ""));
    }),
  );
  await loadDiskCache();
  const resolvedAt = Date.now();
  for (const [appPath, iconUrl] of stored) {
    diskIconCache.set(appPath, { iconUrl, resolvedAt });
  }
  scheduleSave();
  return stored;
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

async function resolveCandidates(fullPath: string): Promise<CandidateApp[]> {
  const { stdout } = await withLookupSlot(() =>
    execFileAsync(
      "osascript",
      [
        "-l",
        "JavaScript",
        "-e",
        DARWIN_CANDIDATES_SCRIPT,
        fullPath,
        String(CANDIDATE_SCAN_LIMIT),
      ],
      { maxBuffer: 4 * 1024 * 1024, timeout: LOOKUP_TIMEOUT_MS },
    ),
  );
  const parsed = DarwinCandidatesSchema.parse(JSON.parse(stdout));
  const ext = path.extname(fullPath).toLowerCase();
  return parsed.apps
    .filter((candidate) => isUsefulCandidate(candidate, ext))
    .slice(0, MAX_CANDIDATES);
}

async function resolveDarwin(fullPath: string) {
  const { stdout } = await withLookupSlot(() =>
    execFileAsync(
      "osascript",
      [
        "-l",
        "JavaScript",
        "-e",
        DARWIN_RESOLVE_SCRIPT,
        fullPath,
        String(ICON_RENDER_SIZE),
      ],
      { maxBuffer: 4 * 1024 * 1024, timeout: LOOKUP_TIMEOUT_MS },
    ),
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

// Resolves icons for the given app paths, reusing anything already rendered.
// Never rejects: every unresolved path maps to null.
async function resolveIcons(appPaths: string[]) {
  await loadDiskCache();
  const resolved = new Map<string, null | string>();
  const pendingByPath = new Map<string, Promise<null | string>>();
  const missing: string[] = [];
  const stale: string[] = [];

  for (const appPath of new Set(appPaths)) {
    const inFlight = iconCache.get(appPath);
    if (inFlight) {
      pendingByPath.set(appPath, inFlight);
      continue;
    }
    const entry = diskIconCache.get(appPath);
    if (entry) {
      resolved.set(appPath, entry.iconUrl);
      if (Date.now() - entry.resolvedAt >= ICON_CACHE_TTL_MS) {
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
  diskIconCache = trimToNewest(diskIconCache, MAX_PERSISTED_ICONS);
  const payload = {
    candidateEntries: Object.fromEntries(diskCandidateCache),
    entries: Object.fromEntries(diskCache),
    iconEntries: Object.fromEntries(diskIconCache),
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

async function withLookupSlot<T>(run: () => Promise<T>): Promise<T> {
  if (activeLookups >= MAX_CONCURRENT_LOOKUPS) {
    await new Promise<void>((resolve) => lookupQueue.push(resolve));
  } else {
    activeLookups++;
  }
  try {
    return await run();
  } finally {
    // Hand the slot straight to the next waiter instead of releasing it, so the
    // counter never dips and admits an extra caller during the handoff.
    const next = lookupQueue.shift();
    if (next) {
      next();
    } else {
      activeLookups--;
    }
  }
}
