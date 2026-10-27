/**
 * The Mac apps' MCP server with a stand-in for the helper and the scripts:
 * the real tools, answering from the plain data below instead of the
 * person's Calendar or Mail, so a test or an eval meets no macOS prompt and
 * leaves nothing behind. Started as `<this file> <state file> <server>`;
 * every call it gets is appended to the state file's `log` as a JSON line,
 * and a server the state file's `refuse` names answers as macOS refusing it.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { appendFileSync, readFileSync } from "node:fs";
import { z } from "zod";

import { macAppNamed } from "../../lib/mac-apps/apps";
import { type RunResult } from "../../lib/mac-apps/backend";
import { NOTES_SCRIPTS } from "../../lib/mac-apps/scripts";
import { createMacAppServer } from "../../lib/mac-apps/server";

const StateSchema = z.object({
  log: z.string(),
  refuse: z.array(z.string()).default([]),
});

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

const ok = (stdout: string): RunResult => ({ exitCode: 0, stderr: "", stdout });

/** The value after `--<flag>` in a helper command's words. */
function flag(args: string[], option: string): string | undefined {
  const at = args.indexOf(`--${option}`);
  return at === -1 ? undefined : args[at + 1];
}

/** What the helper would print for `args`, from no one's real data. */
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
    case "add-event": {
      return JSON.stringify({
        added: flag(args, "title") ?? "",
        calendar: flag(args, "calendar") ?? "Home",
        start: flag(args, "start") ?? null,
      });
    }
    case "add-reminder": {
      return JSON.stringify({
        added: flag(args, "title") ?? "",
        list: flag(args, "list") ?? "Reminders",
      });
    }
    default: {
      return "[]";
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
    return Promise.resolve(
      ok(
        script === NOTES_SCRIPTS.create
          ? [
              "x-coredata://stand-in/ICNote/p1",
              "New note",
              "Notes",
              "iCloud",
            ].join("\u001f")
          : "",
      ),
    );
  },
});
await server.connect(new StdioServerTransport());
