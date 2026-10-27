/**
 * The Mac apps' MCP server with a stand-in for the helper and the scripts:
 * the real tools, answering from a small store of their own instead of the
 * person's Calendar or Notes, so a test or an eval meets no macOS prompt and
 * leaves nothing behind. Started as `<this file> <state file> <server>`;
 * every call it gets is appended to the state file's `log` as a JSON line, a
 * server the state file's `refuse` names answers as macOS refusing it, and
 * what a call adds (an event, a reminder, a note) is kept in its `store`, so
 * a later call that reads it back finds it, as it would in the real app.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  appendFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { z } from "zod";

import { macAppNamed } from "../../lib/mac-apps/apps";
import { type RunResult } from "../../lib/mac-apps/backend";
import { NOTES_SCRIPTS } from "../../lib/mac-apps/scripts";
import { createMacAppServer } from "../../lib/mac-apps/server";

const StateSchema = z.object({
  log: z.string(),
  refuse: z.array(z.string()).default([]),
  store: z.string(),
});

const NoteSchema = z.object({
  folder: z.string(),
  id: z.string(),
  name: z.string(),
  text: z.string(),
});

const StoreSchema = z.object({
  events: z.array(z.record(z.string(), z.unknown())).default([]),
  notes: z.array(NoteSchema).default([]),
  reminders: z.array(z.record(z.string(), z.unknown())).default([]),
});

type Store = z.output<typeof StoreSchema>;

const [stateFile = "", name = ""] = process.argv.slice(2);
const app = macAppNamed(name);
if (app === undefined) {
  process.stderr.write(`No Mac app server is called "${name}".\n`);
  process.exit(64);
}
const state = StateSchema.parse(JSON.parse(readFileSync(stateFile, "utf8")));
const refused = state.refuse.includes(app.server);

function logged(call: object) {
  appendFileSync(
    state.log,
    `${JSON.stringify({ server: app?.server, ...call })}\n`,
  );
}

function readStore(): Store {
  return StoreSchema.parse(
    existsSync(state.store)
      ? JSON.parse(readFileSync(state.store, "utf8"))
      : {},
  );
}

/** Runs `change` on the store and keeps what it left. */
function changeStore<T>(change: (store: Store) => T): T {
  const store = readStore();
  const answer = change(store);
  writeFileSync(state.store, JSON.stringify(store));
  return answer;
}

const ok = (stdout: string): RunResult => ({ exitCode: 0, stderr: "", stdout });

/** The value after `--<option>` in a helper command's words. */
function flag(args: string[], option: string): string | undefined {
  const at = args.indexOf(`--${option}`);
  return at === -1 ? undefined : args[at + 1];
}

/** What the helper would print for `args`, from the stand-in's own store. */
function helperAnswer(args: string[]): string {
  switch (args[0]) {
    case "calendars": {
      return JSON.stringify([
        { account: "iCloud", name: "Home", writable: true },
      ]);
    }
    case "lists": {
      return JSON.stringify([
        { account: "iCloud", name: "Reminders", writable: true },
      ]);
    }
    case "events": {
      return JSON.stringify(readStore().events);
    }
    case "reminders": {
      return JSON.stringify(readStore().reminders);
    }
    case "contacts": {
      return "[]";
    }
    case "add-event": {
      const event = {
        allDay: false,
        calendar: flag(args, "calendar") ?? "Home",
        end: flag(args, "end") ?? null,
        location: flag(args, "location") ?? null,
        start: flag(args, "start") ?? null,
        title: flag(args, "title") ?? "",
      };
      changeStore((store) => store.events.push(event));
      return JSON.stringify({
        added: event.title,
        calendar: event.calendar,
        start: event.start,
      });
    }
    case "add-reminder": {
      const reminder = {
        completed: false,
        due: flag(args, "due") ?? null,
        list: flag(args, "list") ?? "Reminders",
        notes: flag(args, "notes") ?? null,
        title: flag(args, "title") ?? "",
      };
      changeStore((store) => store.reminders.push(reminder));
      return JSON.stringify({ added: reminder.title, list: reminder.list });
    }
    default: {
      return "[]";
    }
  }
}

const US = "\u001f";
const RS = "\u001e";
const MODIFIED = "2026-10-27T09:00:00";

/** A note as the scripts' `noteLine` writes it. */
function noteLine(note: z.output<typeof NoteSchema>): string {
  return [note.id, note.name, note.folder, "iCloud", MODIFIED, "false"].join(
    US,
  );
}

/** A note's HTML body as plain lines, the first its name. */
function plainText(html: string): string {
  return html
    .replaceAll(/<br>/g, "")
    .replaceAll(/<\/div>/g, "\n")
    .replaceAll(/<[^>]+>/g, "")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&")
    .trimEnd();
}

/** What one of Notes' scripts would print for `values`, from the store. */
function notesAnswer(script: string, values: string[]): RunResult {
  const notFound: RunResult = {
    exitCode: 1,
    stderr: "execution error: An error of type 9013 has occurred. (9013)",
    stdout: "",
  };
  switch (script) {
    case NOTES_SCRIPTS.create: {
      const [, folder = "", html = ""] = values;
      const text = plainText(html);
      const note = changeStore((store) => {
        const made = {
          folder: folder || "Notes",
          id: `x-coredata://stand-in/ICNote/p${store.notes.length + 1}`,
          name: text.split("\n")[0] ?? "",
          text,
        };
        store.notes.push(made);
        return made;
      });
      return ok([note.id, note.name, note.folder, "iCloud"].join(US));
    }
    case NOTES_SCRIPTS.append: {
      const [id, html = ""] = values;
      const note = changeStore((store) => {
        const found = store.notes.find((each) => each.id === id);
        if (found) {
          found.text = `${found.text}\n${plainText(html)}`;
        }
        return found;
      });
      return note ? ok([note.id, note.name].join(US)) : notFound;
    }
    case NOTES_SCRIPTS.read: {
      const note = readStore().notes.find((each) => each.id === values[0]);
      return note ? ok(`${noteLine(note)}${US}${note.text}`) : notFound;
    }
    case NOTES_SCRIPTS.list: {
      return ok(readStore().notes.map(noteLine).join(RS));
    }
    case NOTES_SCRIPTS.search: {
      const query = (values[0] ?? "").toLowerCase();
      return ok(
        readStore()
          .notes.filter((note) =>
            `${note.name}\n${note.text}`.toLowerCase().includes(query),
          )
          .map(noteLine)
          .join(RS),
      );
    }
    case NOTES_SCRIPTS.folders: {
      return ok(["iCloud", "Notes", String(readStore().notes.length)].join(US));
    }
    default: {
      return ok("");
    }
  }
}

const server = createMacAppServer(app, {
  helper: (args) => {
    logged({ helper: args });
    return Promise.resolve(
      refused
        ? {
            exitCode: 2,
            stderr: `Instrument is not allowed to use your ${app.name.toLowerCase()}.`,
            stdout: "",
          }
        : ok(`${helperAnswer(args)}\n`),
    );
  },
  script: (script, values) => {
    logged({ script: true, values });
    if (refused) {
      return Promise.resolve({
        exitCode: 1,
        stderr: `execution error: Not authorized to send Apple events to ${app.name}. (-1743)`,
        stdout: "",
      });
    }
    return Promise.resolve(notesAnswer(script, values));
  },
});
await server.connect(new StdioServerTransport());
