import { PRIVATE_FOLDER_NAME } from "@instrument-org/shared";
import fs from "node:fs/promises";
import path from "node:path";

import {
  DRAFT_FILE_NAME,
  FILES_FOLDER_NAME,
  MEMORY_FOLDER_NAME,
  PROJECT_FILE_NAME,
  PROJECTS_FOLDER_NAME,
  SKILLS_FOLDER_NAME,
} from "../constants";
import { BLOBS_FOLDER_NAME } from "./records/blobs";
import { RECORD_FILE_EXAMPLES } from "./records/records-guide";
import { WORKSPACE_DATA_ENTRIES, workspaceLayout } from "./workspace-layout";

/** The guide's name in the workspace's `.instrument/`. */
const DATA_DIR_README_FILE_NAME = "README.md";

/**
 * The guide to a workspace for another coding agent opened in it: what the
 * person's folders at its top level are, what the app keeps in
 * `.instrument/` and how to read a chat's log, and that `.instrument/` is
 * read-only to it. Built from the names the layout uses, so a renamed
 * folder renames it here too.
 */
export function dataDirReadme(): string {
  const data = PRIVATE_FOLDER_NAME;
  const { chats, devices, drafts } = WORKSPACE_DATA_ENTRIES;
  return [
    `# ${data}`,
    "",
    `This folder is Instrument's, and Instrument rewrites this file at every launch. Read anything in \`${data}/\`; write nothing here.`,
    "",
    "## The workspace",
    "",
    `The folders beside \`${data}/\` are the person's, free to read and edit:`,
    "",
    `- \`${FILES_FOLDER_NAME}/\`: kept work, a folder per piece of work.`,
    `- \`${PROJECTS_FOLDER_NAME}/<Name>/${PROJECT_FILE_NAME}\`: a project, its \`${PROJECT_FILE_NAME}\` the instructions every chat filed under it reads.`,
    `- \`${MEMORY_FOLDER_NAME}/<name>.md\`: one memory per Markdown note.`,
    `- \`${SKILLS_FOLDER_NAME}/<name>/SKILL.md\`: a skill per folder.`,
    `- \`${PROJECT_FILE_NAME}\`: instructions every chat reads.`,
    "",
    `## In \`${data}/\``,
    "",
    `- \`${chats}/<id>/\`: one folder per chat. \`${RECORD_FILE_EXAMPLES.log}\` is one session's log as one device wrote it: JSON Lines, one record per line, \`t\` naming the record. A \`session\` record opens it; a \`message\` record's words are in the \`part\` records whose \`part.metadata.messageId\` names it, and the newest record of a part's id stands. \`${RECORD_FILE_EXAMPLES.settings}\` holds \`set\` records, the newest per \`session\` and \`field\` standing, and \`${BLOBS_FOLDER_NAME}/\` the bytes a part names.`,
    `- \`${devices}/<device>/\`: per-device \`.jsonl\` stores, each written by its own device alone: a \`set\` or \`del\` line per change, the newest line per \`key\` across devices standing.`,
    `- \`${drafts}/<date>/${DRAFT_FILE_NAME}\`: a message the person has not sent yet, with what goes with it beside it.`,
    "",
  ].join("\n");
}

/**
 * Writes the guide into the workspace's `.instrument/` when the file there
 * is not already it, byte for byte, replacing it whole. Answers whether it
 * wrote. The app is the file's one writer.
 */
export async function writeDataDirReadme(rootDir: string): Promise<boolean> {
  const { dataDir } = workspaceLayout(rootDir);
  const file = path.join(dataDir, DATA_DIR_README_FILE_NAME);
  const text = dataDirReadme();
  const was = await fs.readFile(file, "utf8").catch(() => undefined);
  if (was === text) {
    return false;
  }
  await fs.mkdir(dataDir, { recursive: true });
  const temp = path.join(
    dataDir,
    `.~${DATA_DIR_README_FILE_NAME}.${process.pid.toString()}.tmp`,
  );
  await fs.writeFile(temp, text, "utf8");
  await fs.rename(temp, file);
  return true;
}
