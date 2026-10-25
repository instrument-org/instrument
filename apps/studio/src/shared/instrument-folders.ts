import { PRIVATE_FOLDER_NAME } from "@instrument-org/shared";
import {
  KEY_FOLDER_NAMES,
  type KeyFolderName,
} from "@instrument-org/workspace/client";

import { type Os } from "./os-conventions";
import { isProtectedFolder, normalized } from "./protected-folders";

/**
 * What a folder is to Instrument: the workspace's own folder, a folder the
 * workspace is somewhere inside, one of the six key folders at its top level
 * (`KEY_FOLDER_NAMES`), or its `.instrument`. Each is a folder the app runs
 * on, so Files leaves it where it is; what is inside the key folders is the
 * person's to change.
 */
export type InstrumentFolder =
  | { kind: "around" }
  | { kind: "key"; name: KeyFolderName }
  | { kind: "private" }
  | { kind: "workspace" };

/**
 * Which of Instrument's folders `hostPath` is, if any. Pure, so it answers
 * for any system: paths are compared in the one spelling each system reads
 * them in, a key folder's name whatever its case where the system's disks
 * ignore case (`settleKeyFolderCase` names it back), and exactly on Linux,
 * where another case is another folder and the person's. Links are not
 * followed; a caller that can resolve them passes the path as reached.
 */
export function instrumentFolderOf(
  hostPath: string,
  facts: { os: Os; workspace: string },
): InstrumentFolder | undefined {
  const { os } = facts;
  const separator = os === "windows" ? "\\" : "/";
  const at = normalized(hostPath, os);
  const root = normalized(facts.workspace, os);
  if (at === root) {
    return { kind: "workspace" };
  }
  const atAsParent = at.endsWith(separator) ? at : `${at}${separator}`;
  if (root.startsWith(atAsParent)) {
    return { kind: "around" };
  }
  const cut = at.lastIndexOf(separator);
  if (at.slice(0, cut) !== root) {
    return undefined;
  }
  const name = at.slice(cut + 1);
  // Both sides go through the same spelling, so a name compares the way the
  // path did.
  const spelled = (each: string) => normalized(`${separator}${each}`, os);
  if (spelled(name) === spelled(PRIVATE_FOLDER_NAME)) {
    return { kind: "private" };
  }
  const key = KEY_FOLDER_NAMES.find((each) => spelled(each) === spelled(name));
  return key === undefined ? undefined : { kind: "key", name: key };
}

const KEY_FOLDER_WORDS = {
  Apps: "apps",
  Chats: "chats",
  Drafts: "drafts",
  Memory: "memories",
  Skills: "skills",
  Topics: "topics",
} satisfies Record<KeyFolderName, string>;

/** Why Files leaves one of Instrument's folders where it is, as the person reads it. */
function instrumentFolderReason(folder: InstrumentFolder): string {
  switch (folder.kind) {
    case "around": {
      return "Your Instrument workspace is inside this folder, so it stays put.";
    }
    case "key": {
      return `Instrument keeps your ${KEY_FOLDER_WORDS[folder.name]} in this folder, so it stays put.`;
    }
    case "private": {
      return "Instrument keeps its own records in this folder, so it stays put.";
    }
    case "workspace": {
      return "Instrument keeps your workspace in this folder, so it stays put.";
    }
  }
}

/** Why Files leaves one of the computer's own folders alone, as the person reads it. */
export const SYSTEM_FOLDER_REASON =
  "That’s one of your computer’s own folders, so Instrument leaves it alone.";

/**
 * Why Files never renames, duplicates, trashes or moves `hostPath`, or
 * undefined when it may: one of the computer's own folders
 * (`isProtectedFolder`), or one of Instrument's (`instrumentFolderOf`) once
 * the workspace's folder is known. The one rule the menus and the routes
 * that change a path both read.
 */
export function keptInPlaceReason(
  hostPath: string,
  facts: { home: string; os: Os; workspace?: string | undefined },
): string | undefined {
  if (isProtectedFolder(hostPath, facts)) {
    return SYSTEM_FOLDER_REASON;
  }
  if (facts.workspace === undefined) {
    return undefined;
  }
  const folder = instrumentFolderOf(hostPath, {
    os: facts.os,
    workspace: facts.workspace,
  });
  return folder && instrumentFolderReason(folder);
}
