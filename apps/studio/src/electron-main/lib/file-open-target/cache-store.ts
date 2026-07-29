import { app } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import {
  type CandidateApp,
  CandidateAppSchema,
  type FileOpenTarget,
} from "./types";

// Bumped only when the persisted shape changes. Candidate curation runs on
// read, so editing the policy lists no longer invalidates anything here.
const CACHE_VERSION = 8;

// Resolution spawns helper processes and only depends on the file type, so
// every entry is an application-wide cache. Refreshes re-read icons, producing
// new content-addressed URLs if their bytes changed. Candidate lists change
// more often, so they refresh sooner.
//
// These durations and bounds predate the icon-rendering fix in `072ef5c81` and
// have not been re-derived against its cost. See
// docs/findings/file-open-cache-is-sized-for-a-vanished-cost.md.
const TARGET_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CANDIDATE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const ICON_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_PERSISTED_CANDIDATES = 128;
const MAX_PERSISTED_ICONS = 512;
const MAX_PERSISTED_TARGETS = 256;
const SAVE_DEBOUNCE_MS = 1000;

// A persisted value together with whether it has outlived its TTL. Callers
// serve a stale value immediately and refresh behind it, so staleness is
// reported rather than enforced.
export interface CachedEntry<T> {
  isStale: boolean;
  value: T;
}

interface Caches {
  candidates: Map<string, StoredEntry<CandidateApp[]>>;
  icons: Map<string, StoredEntry<null | string>>;
  targets: Map<string, StoredEntry<FileOpenTarget>>;
}

interface StoredEntry<T> {
  resolvedAt: number;
  value: T;
}

const PersistedTargetSchema = z.object({
  resolvedAt: z.number(),
  value: z.object({
    appName: z.string().nullable(),
    iconUrl: z.string().nullable(),
  }),
});

const PersistedCandidatesSchema = z.object({
  resolvedAt: z.number(),
  value: z.array(CandidateAppSchema),
});

const PersistedIconSchema = z.object({
  resolvedAt: z.number(),
  value: z.string().nullable(),
});

const PersistedCacheSchema = z.object({
  candidates: z.record(z.string(), PersistedCandidatesSchema).optional(),
  icons: z.record(z.string(), PersistedIconSchema).optional(),
  targets: z.record(z.string(), PersistedTargetSchema).optional(),
  version: z.number(),
});

// The single owner of persisted state. Nothing outside this module holds a
// reference to these maps, which is what lets `save` trim them by replacement
// without a caller's pending write landing in a discarded map.
let caches: Caches | null = null;
let loading: null | Promise<Caches> = null;
let saveTimer: null | ReturnType<typeof setTimeout> = null;

export async function getCandidates(
  key: string,
): Promise<CachedEntry<CandidateApp[]> | null> {
  const { candidates } = await load();
  return toCachedEntry(candidates.get(key), CANDIDATE_CACHE_TTL_MS);
}

// Batched because icons are always resolved for a whole menu at once, and
// because a per-path round trip would re-await the load for every app.
export async function getIcons(appPaths: string[]) {
  const { icons } = await load();
  const found = new Map<string, CachedEntry<null | string>>();
  for (const appPath of appPaths) {
    const entry = toCachedEntry(icons.get(appPath), ICON_CACHE_TTL_MS);
    if (entry) {
      found.set(appPath, entry);
    }
  }
  return found;
}

export async function getTarget(
  ext: string,
): Promise<CachedEntry<FileOpenTarget> | null> {
  const { targets } = await load();
  return toCachedEntry(targets.get(ext), TARGET_CACHE_TTL_MS);
}

export async function setCandidates(key: string, value: CandidateApp[]) {
  const { candidates } = await load();
  candidates.set(key, { resolvedAt: Date.now(), value });
  scheduleSave();
}

export async function setIcons(icons: Map<string, null | string>) {
  const store = await load();
  const resolvedAt = Date.now();
  for (const [appPath, value] of icons) {
    store.icons.set(appPath, { resolvedAt, value });
  }
  scheduleSave();
}

export async function setTarget(ext: string, value: FileOpenTarget) {
  const { targets } = await load();
  targets.set(ext, { resolvedAt: Date.now(), value });
  scheduleSave();
}

function cacheFilePath() {
  return path.join(app.getPath("userData"), "file-open-targets.json");
}

async function load(): Promise<Caches> {
  caches ??= await (loading ??= readFromDisk());
  return caches;
}

// Never rejects: a missing or unreadable cache repopulates on demand.
async function readFromDisk(): Promise<Caches> {
  const loaded: Caches = {
    candidates: new Map(),
    icons: new Map(),
    targets: new Map(),
  };
  try {
    const raw = await fs.readFile(cacheFilePath(), "utf8");
    const parsed = PersistedCacheSchema.parse(JSON.parse(raw));
    if (parsed.version !== CACHE_VERSION) {
      return loaded;
    }
    for (const [ext, entry] of Object.entries(parsed.targets ?? {})) {
      loaded.targets.set(ext, entry);
    }
    for (const [key, entry] of Object.entries(parsed.candidates ?? {})) {
      loaded.candidates.set(key, entry);
    }
    for (const [appPath, entry] of Object.entries(parsed.icons ?? {})) {
      loaded.icons.set(appPath, entry);
    }
  } catch {
    // Missing or unreadable cache is fine; it repopulates on demand.
  }
  return loaded;
}

async function save() {
  const current = caches;
  if (!current) {
    return;
  }
  current.targets = trimToNewest(current.targets, MAX_PERSISTED_TARGETS);
  current.candidates = trimToNewest(
    current.candidates,
    MAX_PERSISTED_CANDIDATES,
  );
  current.icons = trimToNewest(current.icons, MAX_PERSISTED_ICONS);
  const payload = {
    candidates: Object.fromEntries(current.candidates),
    icons: Object.fromEntries(current.icons),
    targets: Object.fromEntries(current.targets),
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
    void save();
  }, SAVE_DEBOUNCE_MS);
}

function toCachedEntry<T>(
  entry: StoredEntry<T> | undefined,
  ttlMs: number,
): CachedEntry<T> | null {
  if (!entry) {
    return null;
  }
  return {
    isStale: Date.now() - entry.resolvedAt >= ttlMs,
    value: entry.value,
  };
}

function trimToNewest<T>(entries: Map<string, StoredEntry<T>>, max: number) {
  if (entries.size <= max) {
    return entries;
  }
  return new Map(
    [...entries.entries()]
      .sort((a, b) => b[1].resolvedAt - a[1].resolvedAt)
      .slice(0, max),
  );
}
