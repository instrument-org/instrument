import {
  APP_FLAVOR,
  APP_NAME,
  type AppFlavor,
  HOME_FOLDERS,
} from "@instrument-org/shared";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { pathIsWithin } from "../path-is-within";
import { getWorkspaceConfig, hasWorkspaceConfig } from "../workspace-config";

/** Creates the output folder if it is not there yet, answering whether it made it now. */
export async function ensureOutputFolder(): Promise<boolean> {
  return (
    (await fs.mkdir(outputFolderPath(), { recursive: true })) !== undefined
  );
}

/**
 * The flavor's Instrument folder in the home folder (`HOME_FOLDERS`,
 * `~/Instrument` for the app people install): where finished work goes while
 * the workspace is kept in the app's own data, and the folder suggested when
 * the person picks where to keep their Instrument folder.
 *
 * The home folder rather than Documents, which macOS asks the person about
 * before any program reads or writes in it. That question used to arrive on
 * the first launch's first screen, before anything had said what the folder
 * was for, and the folder-icon step waited behind it.
 */
export function instrumentFolderUnchosen(): string {
  return path.join(os.homedir(), HOME_FOLDERS.instrument);
}

/**
 * Where the app people install put finished work before the home folder:
 * `Instrument` in Documents. An install that has this folder keeps using it,
 * so its finished work does not split across two folders; the app decides
 * that where it can tell this is not a first launch (`unchosenOutputFolder`).
 * Nothing for a development run or a preview, which would otherwise take the
 * installed app's folder for their own.
 */
export function instrumentFolderInDocuments(
  flavor: AppFlavor = APP_FLAVOR,
): string | undefined {
  return flavor.kind === "release"
    ? path.join(os.homedir(), "Documents", APP_NAME)
    : undefined;
}

/**
 * Where everything Instrument makes lands when nobody said where, created on
 * first use and reached by every chat (see folder-reach.ts), so a task can be
 * handed it like any other folder and the user can find it in the Finder
 * like any other folder: the workspace's own folder once the person picked
 * one, or the folder the app names for a workspace in its own data (the
 * config's `outputDir` in both cases), and otherwise
 * {@link instrumentFolderUnchosen}.
 */
export function outputFolderPath(): string {
  return (
    (hasWorkspaceConfig() ? getWorkspaceConfig().outputDir : undefined) ??
    instrumentFolderUnchosen()
  );
}

/**
 * Where a chat's finished work goes: its own folder under `Chats/`, when
 * that folder is inside the person's Instrument folder, and otherwise the
 * Instrument folder itself.
 *
 * A workspace kept in the app's own data is the reason for the condition.
 * Its `Chats/` is somewhere the person never opens, and the app's data is a
 * place the rules ask about rather than allow, so a chat's folder there is
 * neither where they would look for their work nor somewhere the agent may
 * write. Once the workspace is a folder they picked, every chat's folder is
 * inside it and wins on its own.
 */
export function finishedWorkFolder(ownFolder: string | undefined): string {
  return chatFolderTheyOpen(ownFolder) ?? outputFolderPath();
}

/**
 * A chat's own folder when it is one the person opens, which means inside
 * their Instrument folder, and nothing when it is not: what the agent may
 * write into it goes to the Instrument folder or stays in the records
 * instead. See {@link finishedWorkFolder} for why.
 */
export function chatFolderTheyOpen<Folder extends string>(
  ownFolder: Folder | undefined,
): Folder | undefined {
  return ownFolder !== undefined && pathIsWithin(ownFolder, outputFolderPath())
    ? ownFolder
    : undefined;
}
