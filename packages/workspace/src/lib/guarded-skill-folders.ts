import { WORKSPACE_MACHINE_ENTRIES } from "@instrument-org/shared";
import fs from "node:fs/promises";
import path from "node:path";

import { readJsonRecord, updateJsonRecord } from "./json-record-file";
import { macosGuardedRoot } from "./permissions/macos";
import { workspaceMachineDir } from "./workspace-machine-dir";

/** How many links one path may lead through before it is taken as a loop. */
const MAX_LINKS = 40;

/**
 * Where `hostPath` really is, by its links alone: each part `lstat`ed and
 * each link read with `readlink`, which macOS answers at once. A `realpath`
 * or a look inside could stop on the system's prompt for a folder it
 * guards. A part that is not there ends the walk, which then answers the
 * path as far as it got joined to the rest.
 */
export async function realPathByLinks(hostPath: string): Promise<string> {
  let { parts: pending, root: current } = rootAndParts(path.resolve(hostPath));
  let links = 0;
  while (pending.length > 0) {
    const [part, ...rest] = pending;
    const candidate = path.join(current, part ?? "");
    const stats = await fs.lstat(candidate).catch(() => undefined);
    if (stats === undefined) {
      return path.join(candidate, ...rest);
    }
    if (!stats.isSymbolicLink()) {
      current = candidate;
      pending = rest;
      continue;
    }
    links++;
    if (links > MAX_LINKS) {
      return path.join(candidate, ...rest);
    }
    const target = await fs.readlink(candidate);
    const resolved = rootAndParts(path.resolve(current, target));
    current = resolved.root;
    pending = [...resolved.parts, ...rest];
  }
  return current;
}

/**
 * An absolute path's root and the names below it. The root stays whole, so
 * a Windows drive (`C:\`) is never also taken as the first name.
 */
function rootAndParts(resolved: string): { parts: string[]; root: string } {
  const { root } = path.parse(resolved);
  return {
    parts: resolved.slice(root.length).split(path.sep).filter(Boolean),
    root,
  };
}

/** A skills folder skipped because macOS guards where it really is. */
export interface SkippedSkillFolder {
  /** Where it really is, which the person loads. */
  folder: string;
  /** The folder macOS guards that holds it: Documents, Desktop, iCloud Drive. */
  root: string;
}

function recordFile(): string | undefined {
  try {
    return path.join(
      workspaceMachineDir(),
      WORKSPACE_MACHINE_ENTRIES.skillFolders,
    );
  } catch {
    // No workspace open: a test, or a pass before one is.
    return undefined;
  }
}

/** The skills folders in places macOS guards the person loaded on this computer. */
async function loadedFolders(): Promise<Set<string>> {
  const file = recordFile();
  if (file === undefined) {
    return new Set();
  }
  const read = await readJsonRecord(file);
  const loaded = read.kind === "read" ? read.record.loaded : undefined;
  return new Set(
    Array.isArray(loaded)
      ? loaded.filter((one): one is string => typeof one === "string")
      : [],
  );
}

/**
 * Records that the person loaded a skills folder in a place macOS guards, so
 * later passes read it, or that macOS refused it again, so they skip it.
 */
export async function setSkillFolderLoaded(
  folder: string,
  loaded: boolean,
): Promise<void> {
  const file = recordFile();
  if (file === undefined) {
    return;
  }
  await updateJsonRecord(file, (record) => {
    const was = new Set(
      Array.isArray(record.loaded)
        ? record.loaded.filter((one): one is string => typeof one === "string")
        : [],
    );
    if (was.has(folder) === loaded) {
      return undefined;
    }
    if (loaded) {
      was.add(folder);
    } else {
      was.delete(folder);
    }
    return { loaded: [...was].toSorted() };
  });
}

/**
 * The folder macOS guards that `dir` really is in, when the person has not
 * loaded it on this computer: reading it would put the system's prompt up
 * with nothing on screen saying why. Nothing off macOS, outside those
 * places, or for a folder loaded before.
 */
export async function skillFolderToSkip(
  dir: string,
): Promise<SkippedSkillFolder | undefined> {
  if (process.platform !== "darwin") {
    return undefined;
  }
  const folder = await realPathByLinks(dir);
  const root = macosGuardedRoot(folder);
  if (root === undefined || (await loadedFolders()).has(folder)) {
    return undefined;
  }
  return { folder, root };
}

/** Each pass's skipped folders, by where they really are, for Settings. */
let skipped = new Map<string, SkippedSkillFolder>();

/** Replaces what the last pass skipped. */
export function noteSkippedSkillFolders(
  folders: Map<string, SkippedSkillFolder>,
): void {
  skipped = folders;
}

/** The skills folders the last pass skipped because macOS guards them. */
export function skippedSkillFolders(): SkippedSkillFolder[] {
  return [...skipped.values()];
}
