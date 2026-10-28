import { z } from "zod";

import {
  listArgs,
  localIso,
  noteHtml,
  parseRecords,
  parseRecordWithText,
} from "./records";
import { MAIL_SCRIPTS, MESSAGES_SCRIPTS, NOTES_SCRIPTS } from "./scripts";
import {
  defineTool,
  type MacAppDefinition,
  runScript,
  type ToolContext,
  ToolRefusal,
} from "./tool";

const DEFAULT_LIMIT = 20;

const Limit = z
  .int()
  .positive()
  .optional()
  .meta({ description: `At most this many, ${DEFAULT_LIMIT} by default.` });

// Mail

const MailAccount = z.string().min(1).optional().meta({
  description: "One account by its name, as list_accounts prints it.",
});

const Mailbox = z.string().min(1).optional().meta({
  description:
    "One mailbox of that account, as list_mailboxes prints it; it goes with account.",
});

const MessageSchema = z.object({
  account: z.string(),
  date: z.string().nullable(),
  from: z.string(),
  id: z.number(),
  mailbox: z.string(),
  read: z.boolean(),
  subject: z.string(),
});

type Message = z.output<typeof MessageSchema>;

/** One message as the scripts' `messageLine` writes it. */
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

/** Messages newest first, at most `limit` of them. */
function messagesOf(output: string, limit: number): Message[] {
  return parseRecords(output)
    .map(messageOf)
    .toSorted((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
    .slice(0, limit);
}

/** The account and mailbox given, refused where a mailbox is named without its account. */
function placeOf(input: { account?: string; mailbox?: string }) {
  const account = input.account ?? "";
  const mailbox = input.mailbox ?? "";
  if (mailbox && !account) {
    throw new ToolRefusal(
      "mailbox goes with account, since accounts share mailbox names. list_mailboxes lists each account's.",
    );
  }
  return { account, mailbox };
}

/** What Mail's scripts' own errors mean, for the account and mailbox a call named. */
function mailPlaceErrors({
  account,
  mailbox,
}: {
  account: string;
  mailbox: string;
}): Record<number, string> {
  return {
    9001: `Mail has no account named "${account}". list_accounts lists them.`,
    9002: `"${account}" has no mailbox named "${mailbox || "INBOX"}". list_mailboxes with that account lists them.`,
  };
}

/** Where a call looked for a message it could not find, said for the agent. */
function messageNotFound(
  id: number,
  place: { account: string; mailbox: string },
) {
  const where = place.mailbox
    ? ` in ${place.account}'s ${place.mailbox}`
    : place.account
      ? ` in ${place.account}`
      : "";
  return `no message has the id ${id}${where}. Ids come from list_messages and search_messages.`;
}

const ComposeInput = {
  attachments: z.array(z.string().min(1)).optional().meta({
    description: "Files to attach, by their full paths.",
  }),
  bcc: z.array(z.string().min(1)).optional(),
  body: z.string().optional(),
  cc: z.array(z.string().min(1)).optional(),
  from: z.string().min(1).optional().meta({
    description: "Send from the account that has this address.",
  }),
  subject: z.string().optional(),
};

/** A new message in Mail, opened for the person or sent now. */
async function compose(
  mode: "draft" | "send",
  input: {
    attachments?: string[];
    bcc?: string[];
    body?: string;
    cc?: string[];
    from?: string;
    subject?: string;
    to?: string[];
  },
  context: ToolContext,
) {
  const to = input.to ?? [];
  const files = input.attachments ?? [];
  const text = (input.body ?? "").replace(/[\r\n]+$/, "");
  if (mode === "send" && text.trim() === "" && files.length === 0) {
    throw new ToolRefusal("send_message needs a body or an attachment.");
  }
  const subject = input.subject ?? "";
  await runScript(
    context,
    MAIL_SCRIPTS.compose,
    [
      mode,
      subject,
      // Mail puts each file after the message's last paragraph, which an
      // empty message lacks.
      files.length > 0 ? `${text}\n` : text,
      input.from ?? "",
      ...listArgs(to),
      ...listArgs(input.cc ?? []),
      ...listArgs(input.bcc ?? []),
      ...listArgs(files),
    ],
    {
      9004: "Mail has no account to send from on this Mac. The person adds one in Mail's settings.",
    },
  );
  const titled = subject ? ` "${subject}"` : "";
  const toWhom = to.length > 0 ? ` to ${to.join(", ")}` : "";
  // Mail sends in the background and tells the person itself when a
  // message can't go out.
  return {
    structured: { sent: mode === "send", subject, to },
    text:
      mode === "send"
        ? `Mail is sending${titled || " it"}${toWhom}.`
        : `Opened a new message${titled}${toWhom} in Mail for the person to look over and send.`,
  };
}

export const MAIL_APP: MacAppDefinition = {
  about:
    "Mail on this Mac, with every account added to it, Gmail and Exchange ones included. It can't flag a message or save its attachments, and a reply goes out as a new message rather than in its thread.",
  bundleId: "com.apple.mail",
  name: "Mail",
  server: "apple-mail",
  through: "script",
  tools: [
    defineTool({
      description:
        "Every account added to Mail, with its addresses and whether it is on.",
      input: {},
      name: "list_accounts",
      output: {
        accounts: z.array(
          z.object({
            account: z.string(),
            emails: z.array(z.string()),
            enabled: z.boolean(),
          }),
        ),
      },
      readOnly: true,
      run: async (_input, context) => ({
        structured: {
          accounts: parseRecords(
            await runScript(context, MAIL_SCRIPTS.accounts, []),
          ).map(([account, emails, enabled]) => ({
            account: account ?? "",
            emails: (emails ?? "").split(",").filter(Boolean),
            enabled: enabled === "true",
          })),
        },
      }),
    }),
    defineTool({
      description:
        "The mailboxes of every account that is on, or of one, with how many messages in each are unread.",
      input: { account: MailAccount },
      name: "list_mailboxes",
      output: {
        mailboxes: z.array(
          z.object({
            account: z.string(),
            mailbox: z.string(),
            unread: z.number(),
          }),
        ),
      },
      readOnly: true,
      run: async (input, context) => {
        const account = input.account ?? "";
        const output = await runScript(
          context,
          MAIL_SCRIPTS.mailboxes,
          [account],
          mailPlaceErrors({ account, mailbox: "" }),
        );
        return {
          structured: {
            mailboxes: parseRecords(output).map(([name, mailbox, unread]) => ({
              account: name ?? "",
              mailbox: mailbox ?? "",
              unread: Number(unread),
            })),
          },
        };
      },
    }),
    defineTool({
      description:
        "The newest messages: from every account's inbox, from one account's with account, or from the mailbox named, which goes with account.",
      input: {
        account: MailAccount,
        limit: Limit,
        mailbox: Mailbox,
        unread: z
          .boolean()
          .optional()
          .meta({ description: "Only the unread ones." }),
      },
      name: "list_messages",
      output: { messages: z.array(MessageSchema) },
      readOnly: true,
      run: async (input, context) => {
        const place = placeOf(input);
        const limit = input.limit ?? DEFAULT_LIMIT;
        const output = await runScript(
          context,
          MAIL_SCRIPTS.list,
          [
            place.account,
            place.mailbox,
            input.unread ? "1" : "",
            String(limit),
          ],
          mailPlaceErrors(place),
        );
        return { structured: { messages: messagesOf(output, limit) } };
      },
    }),
    defineTool({
      description:
        "Messages whose subject or sender holds the words, as one phrase, newest first: from every mailbox unless account or mailbox narrows it, and the more mailboxes, the longer it takes.",
      input: {
        account: MailAccount,
        limit: Limit,
        mailbox: Mailbox,
        query: z.string().trim().min(1),
      },
      name: "search_messages",
      output: { messages: z.array(MessageSchema) },
      readOnly: true,
      run: async (input, context) => {
        const place = placeOf(input);
        const limit = input.limit ?? DEFAULT_LIMIT;
        const output = await runScript(
          context,
          MAIL_SCRIPTS.search,
          [input.query, place.account, place.mailbox, String(limit)],
          mailPlaceErrors(place),
        );
        return { structured: { messages: messagesOf(output, limit) } };
      },
    }),
    defineTool({
      description:
        "One message whole: who it is from and to, when it came, the names of its attachments, and its text. Passing the account and mailbox list_messages or search_messages printed finds it faster.",
      input: {
        account: MailAccount,
        id: z.int().nonnegative(),
        mailbox: Mailbox,
      },
      name: "read_message",
      output: {
        message: MessageSchema.extend({
          attachments: z.array(z.string()),
          cc: z.string(),
          text: z.string(),
          to: z.string(),
        }),
      },
      readOnly: true,
      run: async (input, context) => {
        const place = placeOf(input);
        const output = await runScript(
          context,
          MAIL_SCRIPTS.read,
          [String(input.id), place.account, place.mailbox],
          { ...mailPlaceErrors(place), 9003: messageNotFound(input.id, place) },
        );
        const fields = parseRecordWithText(output, 11);
        const message = messageOf(fields);
        const [to = "", cc = "", attachments = "", text = ""] = fields.slice(7);
        return {
          structured: {
            message: {
              ...message,
              attachments: attachments ? attachments.split(", ") : [],
              cc,
              text,
              to,
            },
          },
          text: [
            `From: ${message.from}`,
            `To: ${to}`,
            ...(cc ? [`Cc: ${cc}`] : []),
            `Date: ${message.date ?? ""}`,
            `Subject: ${message.subject}`,
            `Mailbox: ${message.account ? `${message.account} › ` : ""}${message.mailbox}`,
            ...(attachments ? [`Attachments: ${attachments}`] : []),
            "",
            text,
          ].join("\n"),
        };
      },
    }),
    defineTool({
      description:
        "Open a new message in Mail with all of this filled in, for the person to look over and send themselves.",
      files: ["attachments"],
      input: { ...ComposeInput, to: z.array(z.string().min(1)).optional() },
      name: "draft_message",
      output: {
        sent: z.boolean(),
        subject: z.string(),
        to: z.array(z.string()),
      },
      readOnly: false,
      run: (input, context) => compose("draft", input, context),
    }),
    defineTool({
      description:
        "Send a message now. Send only what the person asked you to send, worded as they saw it.",
      files: ["attachments"],
      input: { ...ComposeInput, to: z.array(z.string().min(1)).min(1) },
      name: "send_message",
      output: {
        sent: z.boolean(),
        subject: z.string(),
        to: z.array(z.string()),
      },
      readOnly: false,
      run: (input, context) => compose("send", input, context),
    }),
    defineTool({
      description:
        "Move a message to another mailbox of its own account, such as Archive or Trash. account and mailbox say where it is now, as list_messages printed them.",
      input: {
        account: MailAccount,
        id: z.int().nonnegative(),
        mailbox: Mailbox,
        to_mailbox: z.string().min(1),
      },
      name: "move_message",
      output: { account: z.string(), id: z.number(), mailbox: z.string() },
      readOnly: false,
      run: async (input, context) => {
        const place = placeOf(input);
        const output = await runScript(
          context,
          MAIL_SCRIPTS.move,
          [String(input.id), place.account, place.mailbox, input.to_mailbox],
          {
            ...mailPlaceErrors(place),
            9003: messageNotFound(input.id, place),
            9005: `the message's account has no mailbox named "${input.to_mailbox}". list_mailboxes lists each account's.`,
          },
        );
        const [account = "", mailbox = input.to_mailbox] =
          parseRecords(output)[0] ?? [];
        return {
          structured: { account, id: input.id, mailbox },
          text: `Moved message ${input.id} to ${mailbox}${account ? ` in ${account}` : ""}.`,
        };
      },
    }),
  ],
};

// Notes

const NotesAccount = z.string().min(1).optional().meta({
  description:
    "The account to look in, by its name; the one Notes puts new notes in when left out.",
});

const Folder = z.string().min(1).optional().meta({
  description:
    "A folder as a path from its account, as list_folders prints it (Work/Clients).",
});

const NoteSchema = z.object({
  account: z.string(),
  folder: z.string(),
  id: z.string(),
  locked: z.boolean(),
  modified: z.string().nullable(),
  name: z.string(),
});

type Note = z.output<typeof NoteSchema>;

/** One note as the scripts' `noteLine` writes it. */
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

/** Notes most recently changed first, at most `limit` of them. */
function notesOf(output: string, limit: number): Note[] {
  return parseRecords(output)
    .map(noteOf)
    .toSorted((a, b) => (b.modified ?? "").localeCompare(a.modified ?? ""))
    .slice(0, limit);
}

function notesPlaceErrors(
  account: string,
  folder: string,
): Record<number, string> {
  return {
    9011: `Notes has no account named "${account}". list_folders names each account's folders.`,
    9012: `${account ? `"${account}"` : "The account Notes puts new notes in"} has no folder "${folder}". list_folders lists them.`,
  };
}

function noteErrors(id: string): Record<number, string> {
  return {
    9013: `no note has the id "${id}". Ids come from list_notes and search_notes.`,
    9014: "that note is locked, so only the person can open it, in Notes.",
    9015: "that note has attachments, which adding to it through Notes' scripting would drop. Make a new note instead, or ask the person to add to it.",
  };
}

export const NOTES_APP: MacAppDefinition = {
  about:
    "Notes on this Mac, with the notes synced to it, iCloud's included. A locked note can be listed but not read or changed, and a note with attachments can't be added to.",
  bundleId: "com.apple.Notes",
  name: "Notes",
  server: "apple-notes",
  through: "script",
  tools: [
    defineTool({
      description:
        "Every folder, as a path from its account (Work/Clients), with how many notes it has.",
      input: { account: NotesAccount },
      name: "list_folders",
      output: {
        folders: z.array(
          z.object({
            account: z.string(),
            folder: z.string(),
            notes: z.number(),
          }),
        ),
      },
      readOnly: true,
      run: async (input, context) => {
        const account = input.account ?? "";
        const output = await runScript(
          context,
          NOTES_SCRIPTS.folders,
          [account],
          notesPlaceErrors(account, ""),
        );
        return {
          structured: {
            folders: parseRecords(output).map(([name, folder, notes]) => ({
              account: name ?? "",
              folder: folder ?? "",
              notes: Number(notes),
            })),
          },
        };
      },
    }),
    defineTool({
      description:
        "The notes changed most recently, from every folder or from one.",
      input: { account: NotesAccount, folder: Folder, limit: Limit },
      name: "list_notes",
      output: { notes: z.array(NoteSchema) },
      readOnly: true,
      run: async (input, context) => {
        const account = input.account ?? "";
        const folder = input.folder ?? "";
        const output = await runScript(
          context,
          NOTES_SCRIPTS.list,
          [account, folder],
          notesPlaceErrors(account, folder),
        );
        return {
          structured: {
            notes: notesOf(output, input.limit ?? DEFAULT_LIMIT),
          },
        };
      },
    }),
    defineTool({
      description: "Notes whose title or text holds the words, as one phrase.",
      input: {
        account: NotesAccount,
        folder: Folder,
        limit: Limit,
        query: z.string().trim().min(1),
      },
      name: "search_notes",
      output: { notes: z.array(NoteSchema) },
      readOnly: true,
      run: async (input, context) => {
        const account = input.account ?? "";
        const folder = input.folder ?? "";
        const limit = input.limit ?? DEFAULT_LIMIT;
        const output = await runScript(
          context,
          NOTES_SCRIPTS.search,
          [input.query, account, folder, String(limit)],
          notesPlaceErrors(account, folder),
        );
        return { structured: { notes: notesOf(output, limit) } };
      },
    }),
    defineTool({
      description:
        "One note's text, by the id list_notes or search_notes printed.",
      input: { id: z.string().min(1) },
      name: "read_note",
      output: { note: NoteSchema.extend({ text: z.string() }) },
      readOnly: true,
      run: async (input, context) => {
        const output = await runScript(
          context,
          NOTES_SCRIPTS.read,
          [input.id],
          noteErrors(input.id),
        );
        const fields = parseRecordWithText(output, 7);
        const note = noteOf(fields);
        const text = fields[6] ?? "";
        return {
          structured: { note: { ...note, text } },
          text: [
            `Title: ${note.name}`,
            `Folder: ${note.account ? `${note.account} › ` : ""}${note.folder}`,
            `Modified: ${note.modified ?? ""}`,
            `Id: ${note.id}`,
            "",
            text,
          ].join("\n"),
        };
      },
    }),
    defineTool({
      description:
        "Make a new note. Without a title, its first line is its title, as in Notes. Without a folder it goes where Notes puts new notes. Each line of body becomes a line of the note.",
      input: {
        account: NotesAccount,
        body: z.string().optional(),
        folder: Folder,
        title: z.string().min(1).optional(),
      },
      name: "create_note",
      output: {
        note: NoteSchema.pick({
          account: true,
          folder: true,
          id: true,
          name: true,
        }),
      },
      readOnly: false,
      run: async (input, context) => {
        const text = (input.body ?? "").replace(/[\r\n]+$/, "");
        if (!input.title && text.trim() === "") {
          throw new ToolRefusal("create_note needs a title, a body, or both.");
        }
        const account = input.account ?? "";
        const folder = input.folder ?? "";
        const output = await runScript(
          context,
          NOTES_SCRIPTS.create,
          [account, folder, noteHtml(text, input.title)],
          notesPlaceErrors(account, folder),
        );
        const [
          id = "",
          name = input.title ?? "",
          path = folder,
          accountName = "",
        ] = parseRecords(output)[0] ?? [];
        return {
          structured: {
            note: { account: accountName, folder: path, id, name },
          },
          text: `Created "${name}" in ${accountName ? `${accountName} › ` : ""}${path}. Its id is ${id}.`,
        };
      },
    }),
    defineTool({
      description:
        "Add lines to the end of a note, each line of text a line of the note.",
      input: { id: z.string().min(1), text: z.string().trim().min(1) },
      name: "append_to_note",
      output: { note: z.object({ id: z.string(), name: z.string() }) },
      readOnly: false,
      run: async (input, context) => {
        const output = await runScript(
          context,
          NOTES_SCRIPTS.append,
          [input.id, noteHtml(input.text.replace(/[\r\n]+$/, ""))],
          noteErrors(input.id),
        );
        const [id = input.id, name = input.id] = parseRecords(output)[0] ?? [];
        return {
          structured: { note: { id, name } },
          text: `Added to "${name}".`,
        };
      },
    }),
  ],
};

// Messages

export const MESSAGES_APP: MacAppDefinition = {
  about:
    "Messages on this Mac, which sends iMessages, and texts through the person's iPhone. Messages' scripting can't read conversations, so nothing here reads them; the only ways to are Full Disk Access or Accessibility for Instrument, which you never reach for on your own.",
  bundleId: "com.apple.MobileSMS",
  name: "Messages",
  server: "apple-messages",
  through: "script",
  tools: [
    defineTool({
      description:
        "Send a message to one person, as an iMessage, or as a text with sms, which needs their iPhone to forward texts to this Mac. Send only what the person asked you to send, worded as they saw it.",
      input: {
        sms: z.boolean().optional(),
        text: z.string().trim().min(1),
        to: z
          .string()
          .min(1)
          .meta({ description: "A phone number or an email." }),
      },
      name: "send_message",
      output: { sms: z.boolean(), to: z.string() },
      readOnly: false,
      run: async (input, context) => {
        const sms = input.sms === true;
        await runScript(
          context,
          MESSAGES_SCRIPTS.send,
          [input.to, sms ? "sms" : "imessage", input.text],
          {
            9021: sms
              ? "Messages can't send texts from this Mac: the person's iPhone has to forward them to it, under Settings › Messages › Text Message Forwarding."
              : "Messages has no iMessage account on this Mac. The person signs in to iMessage in Messages' settings.",
          },
        );
        return {
          structured: { sms, to: input.to },
          text: `Messages is sending it to ${input.to} ${sms ? "as a text" : "by iMessage"}.`,
        };
      },
    }),
  ],
};
