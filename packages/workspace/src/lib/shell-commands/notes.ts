import { APP_NAME } from "@instrument-org/shared";
import { defineCommand, type ExecResult } from "just-bash";

import { type ChatId } from "../../schemas/chat-id";
import { type MacApp } from "../permissions/apps";
import { type WorkspaceFsLayout } from "../workspace-fs-layout";
import {
  jsonLines,
  limitOf,
  localIso,
  parseRecords,
  parseRecordWithText,
  runAppScript,
  SCRIPT_HELPERS,
  textFromStdin,
} from "./app-scripts";
import { INSTRUMENT_COMMAND } from "./instrument-command";
import {
  defineSubcommands,
  subcommand,
  type SubcommandInput,
  type SubcommandShell,
} from "./subcommands";

const NAME = `${INSTRUMENT_COMMAND.name} notes`;

const NOTES_APP: MacApp = { bundleId: "com.apple.Notes", name: "Notes" };

export const NOTES_COMMAND = {
  description:
    "Read and write the person's notes in Notes on this Mac, iCloud's included. " +
    "`instrument notes list` and `instrument notes search <words>` find them, one JSON object per line, `instrument notes read <id>` prints one, " +
    "`instrument notes create --title <title>` makes one and `instrument notes append <id>` adds to one, with the text on stdin; `instrument notes folders` names the folders, and `instrument notes help` has every flag. " +
    `The first time a chat uses Notes the person is asked to allow it, and macOS asks them once to let ${APP_NAME} control it.`,
  name: NAME,
  summary: "Read and write notes in Notes.",
  word: "notes",
} as const;

const USAGE = `Usage: ${NAME} <subcommand> ...

  ${NAME} folders [--account <name>]
      Every folder, as a path from its account (Work/Clients), with how
      many notes it holds.
  ${NAME} list [--folder <path>] [--account <name>] [--limit <n>]
      The notes changed most recently, 20 unless --limit says otherwise,
      from every folder or from one.
  ${NAME} search <words> [--folder <path>] [--account <name>] [--limit <n>]
      Notes whose title or text holds the words, as one phrase.
  ${NAME} read <id>
      One note's text. The id comes from list or search.
  ${NAME} create [--title <title>] [--folder <path>] [--account <name>] <<'EOF'
  <the note>
  EOF
      A new note. Without --title, its first line is its title, as in
      Notes. Without --folder it goes where Notes puts new notes.
  ${NAME} append <id> <<'EOF'
  <what to add>
  EOF
      Adds lines to the end of a note.

A folder is looked for in the account Notes puts new notes in, unless
--account names another. Each line of text becomes a line of the note.
A locked note can be listed but not read or changed, and a note with
attachments can't be added to, since Notes' scripting would drop them.

The first time a chat uses Notes, the person is asked to allow it, and
macOS asks them once to let ${APP_NAME} control Notes. Exit code 2 means
macOS was told no, which only the person can change in System Settings.
`;

/** Finding an account and a folder, and naming a folder by its path. */
const NOTES_HELPERS = `${SCRIPT_HELPERS}
on accountNamed(theName)
	tell application id "com.apple.Notes"
		if theName is "" then return default account
		set theAccounts to every account
		repeat with i from 1 to count of theAccounts
			if name of (item i of theAccounts) is theName then return item i of theAccounts
		end repeat
	end tell
	error number 9011
end accountNamed

on folderPath(theFolder)
	tell application id "com.apple.Notes"
		set thePath to name of theFolder
		set theContainer to container of theFolder
		repeat while class of theContainer is folder
			set thePath to (name of theContainer) & "/" & thePath
			set theContainer to container of theContainer
		end repeat
	end tell
	return thePath
end folderPath

on allFolders(theAccount)
	set seen to {}
	set out to {}
	tell application id "com.apple.Notes"
		set queue to every folder of theAccount
		repeat while (count of queue) > 0
			set theFolder to item 1 of queue
			set queue to rest of queue
			set theId to id of theFolder
			if seen does not contain theId then
				set end of seen to theId
				set end of out to theFolder
				set queue to queue & (every folder of theFolder)
			end if
		end repeat
	end tell
	return out
end allFolders

on folderAt(theAccount, thePath)
	set theFolders to my allFolders(theAccount)
	repeat with i from 1 to count of theFolders
		if my folderPath(item i of theFolders) is thePath then return item i of theFolders
	end repeat
	error number 9012
end folderAt

on searchedFolders(accountName, thePath)
	tell application id "com.apple.Notes"
		if thePath is not "" then return {my folderAt(my accountNamed(accountName), thePath)}
		if accountName is not "" then
			set theAccounts to {my accountNamed(accountName)}
		else
			set theAccounts to every account
		end if
	end tell
	set theFolders to {}
	repeat with i from 1 to count of theAccounts
		set theFolders to theFolders & my allFolders(item i of theAccounts)
	end repeat
	return theFolders
end searchedFolders

on noteLine(theNote, thePath, accountName)
	tell application id "com.apple.Notes"
		return (id of theNote) & US & (name of theNote) & US & thePath & US & accountName & US & my iso(modification date of theNote) & US & ((password protected of theNote) as text)
	end tell
end noteLine

on accountOf(theFolder)
	tell application id "com.apple.Notes"
		set theContainer to container of theFolder
		repeat while class of theContainer is folder
			set theContainer to container of theContainer
		end repeat
		return name of theContainer
	end tell
end accountOf

on noteWithId(theId)
	tell application id "com.apple.Notes"
		try
			set theNote to note id theId
			set theName to name of theNote
		on error errorText number errorNumber
			if errorNumber is -1728 or errorNumber is -1719 or errorNumber is -1700 then error number 9013
			error errorText number errorNumber
		end try
		if password protected of theNote then error number 9014
		return theNote
	end tell
end noteWithId
`;

/** The fixed AppleScript each subcommand runs, which reads what it is given only as `argv`. */
export const NOTES_SCRIPTS = {
  append: `${NOTES_HELPERS}
on run argv
	set theNote to my noteWithId(item 1 of argv)
	tell application id "com.apple.Notes"
		if (count of attachments of theNote) > 0 then error number 9015
		set body of theNote to (body of theNote) & (item 2 of argv)
		return (id of theNote) & US & (name of theNote)
	end tell
end run
`,
  create: `${NOTES_HELPERS}
on run argv
	set theAccount to my accountNamed(item 1 of argv)
	tell application id "com.apple.Notes"
		if (item 2 of argv) is "" then
			set theFolder to default folder of theAccount
		else
			set theFolder to my folderAt(theAccount, item 2 of argv)
		end if
		set theNote to make new note at theFolder with properties {body:(item 3 of argv)}
		return (id of theNote) & US & (name of theNote) & US & my folderPath(theFolder) & US & (name of theAccount)
	end tell
end run
`,
  folders: `${NOTES_HELPERS}
on run argv
	tell application id "com.apple.Notes"
		if (item 1 of argv) is not "" then
			set theAccounts to {my accountNamed(item 1 of argv)}
		else
			set theAccounts to every account
		end if
	end tell
	set out to {}
	repeat with i from 1 to count of theAccounts
		set theAccount to item i of theAccounts
		tell application id "com.apple.Notes" to set accountName to name of theAccount
		set theFolders to my allFolders(theAccount)
		repeat with k from 1 to count of theFolders
			set theFolder to item k of theFolders
			tell application id "com.apple.Notes" to set noteCount to count of notes of theFolder
			set end of out to accountName & US & my folderPath(theFolder) & US & (noteCount as text)
		end repeat
	end repeat
	return my joined(out, RS)
end run
`,
  list: `${NOTES_HELPERS}
on run argv
	set theFolders to my searchedFolders(item 1 of argv, item 2 of argv)
	set out to {}
	repeat with i from 1 to count of theFolders
		set theFolder to item i of theFolders
		set thePath to my folderPath(theFolder)
		set accountName to my accountOf(theFolder)
		tell application id "com.apple.Notes"
			set theIds to id of every note of theFolder
			set theNames to name of every note of theFolder
			set theDates to modification date of every note of theFolder
			set theLocks to password protected of every note of theFolder
		end tell
		repeat with k from 1 to count of theIds
			set end of out to (item k of theIds) & US & (item k of theNames) & US & thePath & US & accountName & US & my iso(item k of theDates) & US & ((item k of theLocks) as text)
		end repeat
	end repeat
	return my joined(out, RS)
end run
`,
  read: `${NOTES_HELPERS}
on run argv
	set theNote to my noteWithId(item 1 of argv)
	tell application id "com.apple.Notes"
		set theFolder to container of theNote
		set theText to my str(plaintext of theNote)
		set theLine to my noteLine(theNote, my folderPath(theFolder), my accountOf(theFolder))
	end tell
	return theLine & US & theText
end run
`,
  search: `${NOTES_HELPERS}
on run argv
	set theQuery to item 1 of argv
	set theLimit to (item 4 of argv) as integer
	set theFolders to my searchedFolders(item 2 of argv, item 3 of argv)
	set out to {}
	repeat with i from 1 to count of theFolders
		set theFolder to item i of theFolders
		set thePath to my folderPath(theFolder)
		set accountName to my accountOf(theFolder)
		tell application id "com.apple.Notes"
			try
				set found to (every note of theFolder whose name contains theQuery or plaintext contains theQuery)
			on error
				set found to {}
			end try
		end tell
		repeat with k from 1 to count of found
			if k > theLimit then exit repeat
			set end of out to my noteLine(item k of found, thePath, accountName)
		end repeat
	end repeat
	return my joined(out, RS)
end run
`,
} as const;

/** What `instrument notes` needs from the shell it runs in. */
interface NotesContext {
  chatId: ChatId;
  layout: WorkspaceFsLayout;
}

type Note = {
  account: string;
  folder: string;
  id: string;
  locked: boolean;
  modified: string | null;
  name: string;
};

/** One note as `noteLine` writes it. */
function noteOf(fields: string[]): Note {
  const [id, name, folder, account, modified, locked] = fields;
  return {
    account: account ?? "",
    folder: folder ?? "",
    id: id ?? "",
    locked: locked === "true",
    modified: localIso(modified ?? ""),
    name: name ?? "",
  };
}

const ESCAPED: Record<string, string> = {
  '"': "&quot;",
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
};

function escapeHtml(text: string): string {
  return text.replaceAll(/["&<>]/g, (char) => ESCAPED[char] ?? char);
}

/**
 * Plain text as the HTML a note's body is written in: the title as a
 * heading, and each line as a line of the note, an empty one kept as a gap.
 */
export function noteHtml(text: string, title?: string): string {
  const lines = text === "" ? [] : text.replaceAll(/\r\n?/g, "\n").split("\n");
  return [
    ...(title ? [`<div><h1>${escapeHtml(title)}</h1></div>`] : []),
    ...lines.map((line) => `<div>${line ? escapeHtml(line) : "<br>"}</div>`),
  ].join("");
}

function placeErrors(account: string, folder: string): Record<number, string> {
  return {
    9011: `Notes has no account named "${account}". \`instrument notes folders\` names each account's folders.`,
    9012: `${account ? `"${account}"` : "The account Notes puts new notes in"} has no folder "${folder}". \`instrument notes folders${account ? ` --account '${account}'` : ""}\` lists them.`,
  };
}

function noteErrors(id: string): Record<number, string> {
  return {
    9013: `no note has the id "${id}". Ids come from \`instrument notes list\` and \`instrument notes search\`.`,
    9014: "that note is locked, so only the person can open it, in Notes.",
    9015: "that note has attachments, which adding to it through Notes' scripting would drop. Make a new note instead, or ask the person to add to it.",
  };
}

function run(
  context: NotesContext,
  shell: SubcommandShell,
  script: string,
  values: string[],
  errors: Record<number, string>,
): Promise<ExecResult> {
  return runAppScript({
    app: NOTES_APP,
    chatId: context.chatId,
    command: NAME,
    errors,
    layout: context.layout,
    script,
    signal: shell.signal,
    values,
  });
}

/** Notes most recently changed first, at most `limit` of them. */
function noteLines(output: string, limit: number): string {
  return jsonLines(
    parseRecords(output)
      .map(noteOf)
      .toSorted((a, b) => (b.modified ?? "").localeCompare(a.modified ?? ""))
      .slice(0, limit),
  );
}

async function runFolders(
  input: SubcommandInput,
  context: NotesContext,
  shell: SubcommandShell,
) {
  const account = input.value("account") ?? "";
  const result = await run(
    context,
    shell,
    NOTES_SCRIPTS.folders,
    [account],
    placeErrors(account, ""),
  );
  if (result.exitCode !== 0) {
    return result;
  }
  return jsonLines(
    parseRecords(result.stdout).map(([name, folder, notes]) => ({
      account: name,
      folder,
      notes: Number(notes),
    })),
  );
}

async function runList(
  input: SubcommandInput,
  context: NotesContext,
  shell: SubcommandShell,
) {
  const account = input.value("account") ?? "";
  const folder = input.value("folder") ?? "";
  const limit = limitOf(input);
  const result = await run(
    context,
    shell,
    NOTES_SCRIPTS.list,
    [account, folder],
    placeErrors(account, folder),
  );
  return result.exitCode === 0 ? noteLines(result.stdout, limit) : result;
}

async function runSearch(
  input: SubcommandInput,
  context: NotesContext,
  shell: SubcommandShell,
) {
  const words = input.positional.join(" ").trim();
  if (!words) {
    throw new Error("search needs the words to look for.");
  }
  const account = input.value("account") ?? "";
  const folder = input.value("folder") ?? "";
  const limit = limitOf(input);
  const result = await run(
    context,
    shell,
    NOTES_SCRIPTS.search,
    [words, account, folder, String(limit)],
    placeErrors(account, folder),
  );
  return result.exitCode === 0 ? noteLines(result.stdout, limit) : result;
}

function idOf(given: string | undefined): string {
  if (!given) {
    throw new Error(
      "a note is named by its id, which `instrument notes list` and `instrument notes search` print.",
    );
  }
  return given;
}

async function runRead(
  input: SubcommandInput,
  context: NotesContext,
  shell: SubcommandShell,
) {
  const id = idOf(input.positional[0]);
  const result = await run(
    context,
    shell,
    NOTES_SCRIPTS.read,
    [id],
    noteErrors(id),
  );
  if (result.exitCode !== 0) {
    return result;
  }
  const fields = parseRecordWithText(result.stdout, 7);
  const note = noteOf(fields);
  return [
    `Title: ${note.name}`,
    `Folder: ${note.account ? `${note.account} › ` : ""}${note.folder}`,
    `Modified: ${note.modified ?? ""}`,
    `Id: ${note.id}`,
    "",
    fields[6] ?? "",
    "",
  ].join("\n");
}

async function runCreate(
  input: SubcommandInput,
  context: NotesContext,
  shell: SubcommandShell,
) {
  const title = input.value("title");
  const text = textFromStdin(shell.stdin);
  if (!title && text.trim() === "") {
    throw new Error(
      "create needs a --title, the note on stdin through a quoted heredoc (<<'EOF'), or both.",
    );
  }
  const account = input.value("account") ?? "";
  const folder = input.value("folder") ?? "";
  const result = await run(
    context,
    shell,
    NOTES_SCRIPTS.create,
    [account, folder, noteHtml(text, title)],
    placeErrors(account, folder),
  );
  if (result.exitCode !== 0) {
    return result;
  }
  const [id, name, path, accountName] = parseRecords(result.stdout)[0] ?? [];
  return `Created "${name ?? title ?? ""}" in ${accountName ? `${accountName} › ` : ""}${path ?? folder}. Its id is ${id ?? ""}.\n`;
}

async function runAppend(
  input: SubcommandInput,
  context: NotesContext,
  shell: SubcommandShell,
) {
  const id = idOf(input.positional[0]);
  const text = textFromStdin(shell.stdin);
  if (text.trim() === "") {
    throw new Error(
      "what to add goes on stdin, through a quoted heredoc (<<'EOF').",
    );
  }
  const result = await run(
    context,
    shell,
    NOTES_SCRIPTS.append,
    [id, noteHtml(text)],
    noteErrors(id),
  );
  if (result.exitCode !== 0) {
    return result;
  }
  const [, name] = parseRecords(result.stdout)[0] ?? [];
  return `Added to "${name ?? id}".\n`;
}

const PLACE_FLAGS = ["account", "folder"];

const runNotes = defineSubcommands<NotesContext>({
  name: NAME,
  subcommands: {
    append: subcommand({ positional: 1, run: runAppend }),
    create: subcommand({
      flags: [...PLACE_FLAGS, "title"],
      positional: 0,
      run: runCreate,
    }),
    folders: subcommand({ flags: ["account"], positional: 0, run: runFolders }),
    list: subcommand({
      flags: [...PLACE_FLAGS, "limit"],
      positional: 0,
      run: runList,
    }),
    read: subcommand({ positional: 1, run: runRead }),
    search: subcommand({ flags: [...PLACE_FLAGS, "limit"], run: runSearch }),
  },
  usage: USAGE,
});

/**
 * Notes on this Mac through fixed scripts the app ships, so the agent
 * drives it without writing any AppleScript: what it supplies reaches a
 * script only as `on run argv` values.
 */
export function createNotesCommand(chatId: ChatId, layout: WorkspaceFsLayout) {
  return defineCommand(NAME, (args, ctx) =>
    runNotes(args, { chatId, layout }, ctx),
  );
}
