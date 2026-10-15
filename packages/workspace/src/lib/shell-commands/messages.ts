import { APP_NAME } from "@instrument-org/shared";
import { defineCommand } from "just-bash";

import { type ChatId } from "../../schemas/chat-id";
import { type MacApp } from "../permissions/apps";
import { type WorkspaceFsLayout } from "../workspace-fs-layout";
import { runAppScript, SCRIPT_HELPERS, textFromStdin } from "./app-scripts";
import {
  defineSubcommands,
  subcommand,
  type SubcommandInput,
  type SubcommandShell,
} from "./subcommands";

const NAME = "messages";

const MESSAGES_APP: MacApp = {
  bundleId: "com.apple.MobileSMS",
  name: "Messages",
};

export const MESSAGES_COMMAND = {
  description:
    "Send an iMessage or a text from Messages on this Mac: `messages send --to <phone or email> [--sms]`, with the message on stdin. " +
    "Messages can't be read from here, only sent, so send only what the person asked you to send, worded as they saw it. " +
    `The first time a chat uses Messages the person is asked to allow it, and macOS asks them once to let ${APP_NAME} control it.`,
  name: NAME,
} as const;

const USAGE = `Usage: ${NAME} send --to <phone or email> [--sms] <<'EOF'
<the message>
EOF

  Sends the message to one person, as an iMessage, or as a text message
  with --sms, which needs the person's iPhone to forward texts to this Mac.
  Messages takes it from there, and shows the person whether it arrived.
  Send only what the person asked you to send, worded as they saw it.

Messages' scripting can't read conversations, so nothing here reads them.

The first time a chat uses Messages, the person is asked to allow it, and
macOS asks them once to let ${APP_NAME} control Messages. Exit code 2
means macOS was told no, which only the person can change in System
Settings.
`;

/** The fixed AppleScript each subcommand runs, which reads what it is given only as `argv`. */
export const MESSAGES_SCRIPTS = {
  send: `${SCRIPT_HELPERS}
on run argv
	set theHandle to item 1 of argv
	set useSms to (item 2 of argv) is "sms"
	set theText to item 3 of argv
	tell application id "com.apple.MobileSMS"
		try
			if useSms then
				set theAccount to first account whose service type is SMS
			else
				set theAccount to first account whose service type is iMessage
			end if
		on error errorText number errorNumber
			if errorNumber is -1728 or errorNumber is -1719 then error number 9021
			error errorText number errorNumber
		end try
		if not (enabled of theAccount) then error number 9021
		send theText to participant theHandle of theAccount
	end tell
	return ""
end run
`,
} as const;

/** What `messages` needs from the shell it runs in. */
interface MessagesContext {
  chatId: ChatId;
  layout: WorkspaceFsLayout;
}

async function runSend(
  input: SubcommandInput,
  context: MessagesContext,
  shell: SubcommandShell,
) {
  const to = input.value("to");
  if (!to) {
    throw new Error("send needs --to, the phone number or email to send to.");
  }
  const text = textFromStdin(shell.stdin);
  if (text.trim() === "") {
    throw new Error(
      "the message goes on stdin, through a quoted heredoc (<<'EOF').",
    );
  }
  const sms = input.has("sms");
  const result = await runAppScript({
    app: MESSAGES_APP,
    chatId: context.chatId,
    command: NAME,
    errors: {
      9021: sms
        ? "Messages can't send texts from this Mac: the person's iPhone has to forward them to it, under Settings › Messages › Text Message Forwarding."
        : "Messages has no iMessage account on this Mac. The person signs in to iMessage in Messages' settings.",
    },
    layout: context.layout,
    script: MESSAGES_SCRIPTS.send,
    signal: shell.signal,
    values: [to, sms ? "sms" : "imessage", text],
  });
  return result.exitCode === 0
    ? `Messages is sending it to ${to} ${sms ? "as a text" : "by iMessage"}.\n`
    : result;
}

const runMessages = defineSubcommands<MessagesContext>({
  name: NAME,
  subcommands: {
    send: subcommand({
      booleans: ["sms"],
      flags: ["to"],
      positional: 0,
      run: runSend,
    }),
  },
  usage: USAGE,
});

/**
 * Messages on this Mac through a fixed script the app ships, so the agent
 * sends without writing any AppleScript: what it supplies reaches the
 * script only as `on run argv` values.
 */
export function createMessagesCommand(
  chatId: ChatId,
  layout: WorkspaceFsLayout,
) {
  return defineCommand(NAME, (args, ctx) =>
    runMessages(args, { chatId, layout }, ctx),
  );
}
