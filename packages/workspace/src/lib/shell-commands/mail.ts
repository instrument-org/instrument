import { APP_NAME } from "@instrument-org/shared";
import { defineCommand, type ExecResult } from "just-bash";

import { type ChatId } from "../../schemas/chat-id";
import { type MacApp } from "../permissions/apps";
import { type WorkspaceFsLayout } from "../workspace-fs-layout";
import {
  attachmentPaths,
  jsonLines,
  limitOf,
  listArgs,
  localIso,
  parseRecords,
  parseRecordWithText,
  runAppScript,
  SCRIPT_HELPERS,
  textFromStdin,
} from "./app-scripts";
import {
  defineSubcommands,
  subcommand,
  type SubcommandInput,
  type SubcommandShell,
} from "./subcommands";

const NAME = "mail";

const MAIL_APP: MacApp = { bundleId: "com.apple.mail", name: "Mail" };

export const MAIL_COMMAND = {
  description:
    "Read, search, draft, send, and file email in Mail on this Mac, across every account added to it. " +
    "`mail list`, `mail search <words>` and `mail read <id>` read it, with lists as one JSON object per line; " +
    "`mail draft` opens a message in Mail for the person to look over and send, and `mail send` sends one (`--to`, `--subject`, `--attach <file>`, and the message on stdin); " +
    "`mail accounts`, `mail mailboxes` and `mail move <id> <mailbox>` cover the rest, and `mail help` has every flag. " +
    `The first time a chat uses Mail the person is asked to allow it, and macOS asks them once to let ${APP_NAME} control it.`,
  name: NAME,
} as const;

const USAGE = `Usage: ${NAME} <subcommand> ...

  ${NAME} accounts
      Every account added to Mail, with its addresses and whether it is on.
  ${NAME} mailboxes [--account <name>]
      The mailboxes of every account that is on, or of one, with how many
      messages in each are unread.
  ${NAME} list [--account <name>] [--mailbox <name>] [--unread] [--limit <n>]
      The newest messages, 20 unless --limit says otherwise: from every
      account's inbox, from one account's with --account, or from the
      mailbox --mailbox names, which goes with --account. --unread keeps
      the unread ones.
  ${NAME} search <words> [--account <name>] [--mailbox <name>] [--limit <n>]
      Messages whose subject or sender holds the words, as one phrase,
      newest first: from every mailbox unless --account or --mailbox
      narrows it, and the more mailboxes, the longer it takes.
  ${NAME} read <id> [--account <name>] [--mailbox <name>]
      One message whole: who it is from and to, when it came, the names of
      its attachments, and its text. The id comes from list or search, and
      passing the account and mailbox they printed finds it faster.
  ${NAME} draft [--to <address>]... [--cc <address>]... [--bcc <address>]...
      [--subject <text>] [--from <address>] [--attach <file>]... <<'EOF'
  <the message>
  EOF
      Opens a new message in Mail with all of that filled in, for the
      person to look over and send themselves.
  ${NAME} send --to <address>... [the same flags as draft] <<'EOF'
  <the message>
  EOF
      Sends it now. Send only what the person asked you to send, worded as
      they saw it.
  ${NAME} move <id> <mailbox> [--account <name>] [--mailbox <name>]
      Moves a message to another mailbox of its own account, such as
      Archive or Trash.

Lists are one JSON object per line, and nothing when none match. --from
sends from the account that has that address. A file to attach has to be
one you can read.

The first time a chat uses Mail, the person is asked to allow it, and
macOS asks them once to let ${APP_NAME} control Mail. Exit code 2 means
macOS was told no, which only the person can change in System Settings.
`;

/** Finding an account, a mailbox and a message, which most of the scripts below do. */
const MAIL_HELPERS = `${SCRIPT_HELPERS}
on accountNamed(theName)
	tell application id "com.apple.mail"
		set theAccounts to every account
		repeat with i from 1 to count of theAccounts
			if name of (item i of theAccounts) is theName then return item i of theAccounts
		end repeat
	end tell
	error number 9001
end accountNamed

on mailboxNamed(theAccount, theName)
	tell application id "com.apple.mail"
		set theNames to name of every mailbox of theAccount
		repeat with i from 1 to count of theNames
			if item i of theNames is theName then return mailbox i of theAccount
		end repeat
	end tell
	error number 9002
end mailboxNamed

on searchedBoxes(accountName, boxName)
	tell application id "com.apple.mail"
		if boxName is not "" then return {my mailboxNamed(my accountNamed(accountName), boxName)}
		if accountName is not "" then
			set theAccounts to {my accountNamed(accountName)}
		else
			set theAccounts to every account whose enabled is true
		end if
		set theBoxes to {}
		repeat with i from 1 to count of theAccounts
			set theBoxes to theBoxes & (every mailbox of (item i of theAccounts))
		end repeat
		return theBoxes
	end tell
end searchedBoxes

on person(theName, theAddress)
	if theName is missing value or theName is "" then return my str(theAddress)
	return theName & " <" & my str(theAddress) & ">"
end person

on messageLine(theMessage)
	tell application id "com.apple.mail"
		set theBox to mailbox of theMessage
		try
			set accountName to name of account of theBox
		on error
			set accountName to ""
		end try
		return ((id of theMessage) as text) & US & accountName & US & my str(name of theBox) & US & my iso(date received of theMessage) & US & my str(sender of theMessage) & US & my str(subject of theMessage) & US & ((read status of theMessage) as text)
	end tell
end messageLine

on findMessage(theId, accountName, boxName)
	set theBoxes to my searchedBoxes(accountName, boxName)
	tell application id "com.apple.mail"
		if boxName is "" then set theBoxes to {inbox} & theBoxes
		repeat with i from 1 to count of theBoxes
			try
				set found to (messages of (item i of theBoxes) whose id is theId)
				if (count of found) > 0 then return item 1 of found
			end try
		end repeat
	end tell
	error number 9003
end findMessage
`;

/** The fixed AppleScript each subcommand runs, which reads what it is given only as `argv`. */
export const MAIL_SCRIPTS = {
  accounts: `${SCRIPT_HELPERS}
on run argv
	set out to {}
	tell application id "com.apple.mail"
		set theAccounts to every account
		repeat with i from 1 to count of theAccounts
			set theAccount to item i of theAccounts
			set end of out to (name of theAccount) & US & my joined(email addresses of theAccount, ",") & US & ((enabled of theAccount) as text)
		end repeat
	end tell
	return my joined(out, RS)
end run
`,
  compose: `${SCRIPT_HELPERS}
on run argv
	set sendNow to (item 1 of argv) is "send"
	set theSubject to item 2 of argv
	set theBody to item 3 of argv
	set theSender to item 4 of argv
	set {toList, i} to my takeList(argv, 5)
	set {ccList, i} to my takeList(argv, i)
	set {bccList, i} to my takeList(argv, i)
	set {pathList, i} to my takeList(argv, i)
	set fileList to {}
	repeat with thePath in pathList
		set end of fileList to POSIX file (contents of thePath)
	end repeat
	tell application id "com.apple.mail"
		if (count of (every account whose enabled is true)) is 0 then error number 9004
		set theMessage to make new outgoing message with properties {subject:theSubject, content:theBody, visible:(not sendNow)}
		if theSender is not "" then set sender of theMessage to theSender
		tell theMessage
			repeat with theAddress in toList
				make new to recipient at end of to recipients with properties {address:(contents of theAddress)}
			end repeat
			repeat with theAddress in ccList
				make new cc recipient at end of cc recipients with properties {address:(contents of theAddress)}
			end repeat
			repeat with theAddress in bccList
				make new bcc recipient at end of bcc recipients with properties {address:(contents of theAddress)}
			end repeat
			repeat with theFile in fileList
				tell content to make new attachment with properties {file name:(contents of theFile)} at after last paragraph
			end repeat
		end tell
		if sendNow then
			if (count of fileList) > 0 then delay 1
			send theMessage
		end if
	end tell
	return ""
end run
`,
  list: `${MAIL_HELPERS}
on run argv
	set accountName to item 1 of argv
	set boxName to item 2 of argv
	set unreadOnly to (item 3 of argv) is "1"
	set theLimit to (item 4 of argv) as integer
	tell application id "com.apple.mail"
		if boxName is not "" then
			set theBox to my mailboxNamed(my accountNamed(accountName), boxName)
		else if accountName is not "" then
			set theBox to my mailboxNamed(my accountNamed(accountName), "INBOX")
		else
			set theBox to inbox
		end if
		if unreadOnly then
			set found to (messages of theBox whose read status is false)
		else
			set n to count of messages of theBox
			if n > theLimit then set n to theLimit
			if n is 0 then return ""
			set found to messages 1 thru n of theBox
		end if
	end tell
	set out to {}
	repeat with i from 1 to count of found
		if i > theLimit then exit repeat
		set end of out to my messageLine(item i of found)
	end repeat
	return my joined(out, RS)
end run
`,
  mailboxes: `${MAIL_HELPERS}
on run argv
	set accountName to item 1 of argv
	set out to {}
	tell application id "com.apple.mail"
		if accountName is not "" then
			set theAccounts to {my accountNamed(accountName)}
		else
			set theAccounts to every account whose enabled is true
		end if
		repeat with i from 1 to count of theAccounts
			set theAccount to item i of theAccounts
			set theName to name of theAccount
			set theNames to name of every mailbox of theAccount
			set theCounts to unread count of every mailbox of theAccount
			repeat with k from 1 to count of theNames
				set end of out to theName & US & (item k of theNames) & US & ((item k of theCounts) as text)
			end repeat
		end repeat
	end tell
	return my joined(out, RS)
end run
`,
  move: `${MAIL_HELPERS}
on run argv
	set theMessage to my findMessage((item 1 of argv) as integer, item 2 of argv, item 3 of argv)
	tell application id "com.apple.mail"
		set theAccount to account of mailbox of theMessage
		try
			set theBox to my mailboxNamed(theAccount, item 4 of argv)
		on error number 9002
			error number 9005
		end try
		move theMessage to theBox
		return (name of theAccount) & US & (name of theBox)
	end tell
end run
`,
  read: `${MAIL_HELPERS}
on run argv
	set theMessage to my findMessage((item 1 of argv) as integer, item 2 of argv, item 3 of argv)
	tell application id "com.apple.mail"
		set toList to {}
		repeat with theRecipient in (to recipients of theMessage)
			set end of toList to my person(name of theRecipient, address of theRecipient)
		end repeat
		set ccList to {}
		repeat with theRecipient in (cc recipients of theMessage)
			set end of ccList to my person(name of theRecipient, address of theRecipient)
		end repeat
		set attachmentNames to name of every mail attachment of theMessage
		set theText to my str(content of theMessage)
	end tell
	return my messageLine(theMessage) & US & my joined(toList, ", ") & US & my joined(ccList, ", ") & US & my joined(attachmentNames, ", ") & US & theText
end run
`,
  search: `${MAIL_HELPERS}
on run argv
	set theQuery to item 1 of argv
	set theLimit to (item 4 of argv) as integer
	set theBoxes to my searchedBoxes(item 2 of argv, item 3 of argv)
	set out to {}
	tell application id "com.apple.mail"
		repeat with i from 1 to count of theBoxes
			try
				set found to (messages of (item i of theBoxes) whose subject contains theQuery or sender contains theQuery)
			on error
				set found to {}
			end try
			repeat with k from 1 to count of found
				if k > theLimit then exit repeat
				set end of out to my messageLine(item k of found)
			end repeat
		end repeat
	end tell
	return my joined(out, RS)
end run
`,
} as const;

/** What `mail` needs from the shell it runs in. */
interface MailContext {
  chatId: ChatId;
  layout: WorkspaceFsLayout;
}

type Message = {
  account: string;
  date: string | null;
  from: string;
  id: number;
  mailbox: string;
  read: boolean;
  subject: string;
};

/** One message as `messageLine` writes it. */
function messageOf(fields: string[]): Message {
  const [id, account, mailbox, date, from, subject, read] = fields;
  return {
    account: account ?? "",
    date: localIso(date ?? ""),
    from: from ?? "",
    id: Number(id),
    mailbox: mailbox ?? "",
    read: read === "true",
    subject: subject ?? "",
  };
}

/** The account and mailbox flags, refused where a mailbox is named without its account. */
function placeOf(input: SubcommandInput): {
  account: string;
  mailbox: string;
} {
  const account = input.value("account") ?? "";
  const mailbox = input.value("mailbox") ?? "";
  if (mailbox && !account) {
    throw new Error(
      "--mailbox goes with --account, since accounts share mailbox names. `mail mailboxes` lists each account's.",
    );
  }
  return { account, mailbox };
}

/** A message's id as list and search print it: a whole number. */
function idOf(given: string | undefined): string {
  if (given === undefined || !/^\d+$/.test(given)) {
    throw new Error(
      `a message is named by its id, a number that \`mail list\` and \`mail search\` print (got ${given === undefined ? "nothing" : `"${given}"`}).`,
    );
  }
  return given;
}

/** What the script's own errors mean, for the account and mailbox a call named. */
function placeErrors({
  account,
  mailbox,
}: {
  account: string;
  mailbox: string;
}): Record<number, string> {
  return {
    9001: `Mail has no account named "${account}". \`mail accounts\` lists them.`,
    9002: `"${account}" has no mailbox named "${mailbox || "INBOX"}". \`mail mailboxes --account '${account}'\` lists them.`,
  };
}

function run(
  context: MailContext,
  shell: SubcommandShell,
  script: string,
  values: string[],
  errors?: Record<number, string>,
): Promise<ExecResult> {
  return runAppScript({
    app: MAIL_APP,
    chatId: context.chatId,
    command: NAME,
    ...(errors && { errors }),
    layout: context.layout,
    script,
    signal: shell.signal,
    values,
  });
}

async function runAccounts(context: MailContext, shell: SubcommandShell) {
  const result = await run(context, shell, MAIL_SCRIPTS.accounts, []);
  if (result.exitCode !== 0) {
    return result;
  }
  return jsonLines(
    parseRecords(result.stdout).map(([account, emails, enabled]) => ({
      account,
      emails: (emails ?? "").split(",").filter(Boolean),
      enabled: enabled === "true",
    })),
  );
}

async function runMailboxes(
  input: SubcommandInput,
  context: MailContext,
  shell: SubcommandShell,
) {
  const account = input.value("account") ?? "";
  const result = await run(
    context,
    shell,
    MAIL_SCRIPTS.mailboxes,
    [account],
    placeErrors({ account, mailbox: "" }),
  );
  if (result.exitCode !== 0) {
    return result;
  }
  return jsonLines(
    parseRecords(result.stdout).map(([name, mailbox, unread]) => ({
      account: name,
      mailbox,
      unread: Number(unread),
    })),
  );
}

/** Messages newest first, at most `limit` of them. */
function messageLines(output: string, limit: number): string {
  return jsonLines(
    parseRecords(output)
      .map(messageOf)
      .toSorted((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
      .slice(0, limit),
  );
}

async function runList(
  input: SubcommandInput,
  context: MailContext,
  shell: SubcommandShell,
) {
  const place = placeOf(input);
  const limit = limitOf(input);
  const result = await run(
    context,
    shell,
    MAIL_SCRIPTS.list,
    [
      place.account,
      place.mailbox,
      input.has("unread") ? "1" : "",
      String(limit),
    ],
    placeErrors(place),
  );
  return result.exitCode === 0 ? messageLines(result.stdout, limit) : result;
}

async function runSearch(
  input: SubcommandInput,
  context: MailContext,
  shell: SubcommandShell,
) {
  const words = input.positional.join(" ").trim();
  if (!words) {
    throw new Error("search needs the words to look for.");
  }
  const place = placeOf(input);
  const limit = limitOf(input);
  const result = await run(
    context,
    shell,
    MAIL_SCRIPTS.search,
    [words, place.account, place.mailbox, String(limit)],
    placeErrors(place),
  );
  return result.exitCode === 0 ? messageLines(result.stdout, limit) : result;
}

/** Where a call looked for a message it could not find, said for the agent. */
function notFound(id: string, place: { account: string; mailbox: string }) {
  const where = place.mailbox
    ? ` in ${place.account}'s ${place.mailbox}`
    : place.account
      ? ` in ${place.account}`
      : "";
  return `no message has the id ${id}${where}. Ids come from \`mail list\` and \`mail search\`.`;
}

async function runRead(
  input: SubcommandInput,
  context: MailContext,
  shell: SubcommandShell,
) {
  const id = idOf(input.positional[0]);
  const place = placeOf(input);
  const result = await run(
    context,
    shell,
    MAIL_SCRIPTS.read,
    [id, place.account, place.mailbox],
    { ...placeErrors(place), 9003: notFound(id, place) },
  );
  if (result.exitCode !== 0) {
    return result;
  }
  const fields = parseRecordWithText(result.stdout, 11);
  const message = messageOf(fields);
  const [to, cc, attachments, text] = fields.slice(7);
  return [
    `From: ${message.from}`,
    `To: ${to ?? ""}`,
    ...(cc ? [`Cc: ${cc}`] : []),
    `Date: ${message.date ?? ""}`,
    `Subject: ${message.subject}`,
    `Mailbox: ${message.account ? `${message.account} › ` : ""}${message.mailbox}`,
    ...(attachments ? [`Attachments: ${attachments}`] : []),
    "",
    text ?? "",
    "",
  ].join("\n");
}

async function runCompose(
  mode: "draft" | "send",
  input: SubcommandInput,
  context: MailContext,
  shell: SubcommandShell,
) {
  const to = input.all("to");
  if (mode === "send" && to.length === 0) {
    throw new Error("send needs at least one --to.");
  }
  const files = await attachmentPaths(
    input.all("attach"),
    shell,
    context.layout,
  );
  const text = textFromStdin(shell.stdin);
  if (mode === "send" && text.trim() === "" && files.length === 0) {
    throw new Error(
      "the message goes on stdin, through a quoted heredoc (<<'EOF').",
    );
  }
  const subject = input.value("subject") ?? "";
  const result = await run(
    context,
    shell,
    MAIL_SCRIPTS.compose,
    [
      mode,
      subject,
      // Mail puts each file after the message's last paragraph, which an
      // empty message lacks.
      files.length > 0 ? `${text}\n` : text,
      input.value("from") ?? "",
      ...listArgs(to),
      ...listArgs(input.all("cc")),
      ...listArgs(input.all("bcc")),
      ...listArgs(files),
    ],
    {
      9004: "Mail has no account to send from on this Mac. The person adds one in Mail's settings.",
    },
  );
  if (result.exitCode !== 0) {
    return result;
  }
  const titled = subject ? ` "${subject}"` : "";
  const toWhom = to.length > 0 ? ` to ${to.join(", ")}` : "";
  // Mail sends in the background and tells the person itself when a
  // message can't go out.
  return mode === "send"
    ? `Mail is sending${titled || " it"}${toWhom}.\n`
    : `Opened a new message${titled}${toWhom} in Mail for the person to look over and send.\n`;
}

async function runMove(
  input: SubcommandInput,
  context: MailContext,
  shell: SubcommandShell,
) {
  const id = idOf(input.positional[0]);
  const destination = input.positional[1];
  if (!destination) {
    throw new Error(
      "move needs the mailbox to move the message to, after its id.",
    );
  }
  const place = placeOf(input);
  const result = await run(
    context,
    shell,
    MAIL_SCRIPTS.move,
    [id, place.account, place.mailbox, destination],
    {
      ...placeErrors(place),
      9003: notFound(id, place),
      9005: `the message's account has no mailbox named "${destination}". \`mail mailboxes\` lists each account's.`,
    },
  );
  if (result.exitCode !== 0) {
    return result;
  }
  const [account, mailbox] = parseRecords(result.stdout)[0] ?? [];
  return `Moved message ${id} to ${mailbox ?? destination}${account ? ` in ${account}` : ""}.\n`;
}

const COMPOSE_FLAGS = ["to", "cc", "bcc", "subject", "from", "attach"];
const COMPOSE_REPEATABLE = ["to", "cc", "bcc", "attach"];
const PLACE_FLAGS = ["account", "mailbox"];

const runMail = defineSubcommands<MailContext>({
  name: NAME,
  subcommands: {
    accounts: subcommand({
      positional: 0,
      run: (_input, context, shell) => runAccounts(context, shell),
    }),
    draft: subcommand({
      flags: COMPOSE_FLAGS,
      positional: 0,
      repeatable: COMPOSE_REPEATABLE,
      run: (input, context, shell) =>
        runCompose("draft", input, context, shell),
    }),
    list: subcommand({
      booleans: ["unread"],
      flags: [...PLACE_FLAGS, "limit"],
      positional: 0,
      run: runList,
    }),
    mailboxes: subcommand({
      flags: ["account"],
      positional: 0,
      run: runMailboxes,
    }),
    move: subcommand({ flags: PLACE_FLAGS, positional: 2, run: runMove }),
    read: subcommand({ flags: PLACE_FLAGS, positional: 1, run: runRead }),
    search: subcommand({ flags: [...PLACE_FLAGS, "limit"], run: runSearch }),
    send: subcommand({
      flags: COMPOSE_FLAGS,
      positional: 0,
      repeatable: COMPOSE_REPEATABLE,
      run: (input, context, shell) => runCompose("send", input, context, shell),
    }),
  },
  usage: USAGE,
});

/**
 * Mail on this Mac through fixed scripts the app ships, so the agent drives
 * it without writing any AppleScript: what it supplies reaches a script
 * only as `on run argv` values.
 */
export function createMailCommand(chatId: ChatId, layout: WorkspaceFsLayout) {
  return defineCommand(NAME, (args, ctx) =>
    runMail(args, { chatId, layout }, ctx),
  );
}
