import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";

import { callMcpTool } from "../apps/mcp/client";
import { macAppNamed } from "./apps";
import { type MacAppBackend, type RunResult } from "./backend";
import { noteHtml } from "./records";
import { macosRefusalIn } from "./refusal";
import { MAIL_SCRIPTS, MESSAGES_SCRIPTS, NOTES_SCRIPTS } from "./scripts";
import { createMacAppServer } from "./server";

const US = "\u001f";
const RS = "\u001e";

const ok = (stdout: string): RunResult => ({ exitCode: 0, stderr: "", stdout });

/** A backend that answers `answer` to every run and keeps what it was asked. */
function recording(answer: RunResult) {
  const helper: string[][] = [];
  const scripts: { script: string; values: string[] }[] = [];
  const backend: MacAppBackend = {
    helper: (args) => {
      helper.push(args);
      return Promise.resolve(answer);
    },
    script: (script, values) => {
      scripts.push({ script, values });
      return Promise.resolve(answer);
    },
  };
  return { backend, helper, scripts };
}

const clients: Client[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

async function connect(server: string, backend: MacAppBackend) {
  const app = macAppNamed(server);
  if (app === undefined) {
    throw new Error(`no ${server}`);
  }
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createMacAppServer(app, backend).connect(serverSide);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientSide);
  clients.push(client);
  return client;
}

describe("the helper apps' arguments", () => {
  it.each([
    ["apple-calendar", "list_calendars", {}, ["calendars"]],
    [
      "apple-calendar",
      "list_events",
      { calendar: "Work", from: "today", limit: 5, to: "2026-10-30" },
      [
        "events",
        "--calendar",
        "Work",
        "--from",
        "today",
        "--limit",
        "5",
        "--to",
        "2026-10-30",
      ],
    ],
    [
      "apple-calendar",
      "add_event",
      { location: "Home", start: "2026-10-29T14:00", title: "Q4 review" },
      [
        "add-event",
        "--location",
        "Home",
        "--start",
        "2026-10-29T14:00",
        "--title",
        "Q4 review",
      ],
    ],
    ["apple-reminders", "list_lists", {}, ["lists"]],
    [
      "apple-reminders",
      "list_reminders",
      { all: true, due_before: "tomorrow", list: "Home" },
      ["reminders", "--all", "--list", "Home", "--due-before", "tomorrow"],
    ],
    [
      "apple-reminders",
      "add_reminder",
      { due: "2026-11-10T12:00", title: "Try the update" },
      [
        "add-reminder",
        "--due",
        "2026-11-10T12:00",
        "--title",
        "Try the update",
      ],
    ],
    [
      "apple-contacts",
      "search_contacts",
      { search: "Maya" },
      ["contacts", "--search", "Maya"],
    ],
  ])("%s %s", async (server, tool, args, expected) => {
    const answers: Record<string, string> = {
      add_event: '{"added":"Q4 review","calendar":"Work","start":null}',
      add_reminder: '{"added":"Try the update","list":"Reminders"}',
    };
    const { backend, helper } = recording(ok(answers[tool] ?? "[]"));
    const client = await connect(server, backend);
    const result = await client.callTool({ arguments: args, name: tool });
    expect(result.isError).toBeFalsy();
    expect(helper).toEqual([expected]);
  });

  it("refuses a value the helper would read as a flag", async () => {
    const { backend, helper } = recording(ok("[]"));
    const client = await connect("apple-contacts", backend);
    const result = await client.callTool({
      arguments: { search: "--all" },
      name: "search_contacts",
    });
    expect(result.isError).toBe(true);
    expect(helper).toEqual([]);
  });

  it("names a key the tool doesn't take", async () => {
    const { backend } = recording(ok("[]"));
    const client = await connect("apple-calendar", backend);
    const result = await client.callTool({
      arguments: { title: "Lunch", when: "noon" },
      name: "add_event",
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("when");
  });

  it("answers with the helper's data, parsed", async () => {
    const event = {
      allDay: false,
      calendar: "Work",
      end: "2026-10-29T15:00:00-07:00",
      location: null,
      start: "2026-10-29T14:00:00-07:00",
      title: "Q4 review",
    };
    const { backend } = recording(ok(JSON.stringify([event])));
    const client = await connect("apple-calendar", backend);
    const result = await client.callTool({
      arguments: {},
      name: "list_events",
    });
    expect(result.structuredContent).toEqual({ events: [event] });
  });
});

describe("a stopped call", () => {
  it("aborts the helper's run when the caller's signal does", async () => {
    let started: () => void = () => {};
    const running = new Promise<void>((resolve) => {
      started = resolve;
    });
    let stopped: AbortSignal | undefined;
    const backend: MacAppBackend = {
      helper: (_args, signal) => {
        stopped = signal;
        started();
        return new Promise(() => {});
      },
      script: () => Promise.resolve(ok("")),
    };
    const client = await connect("apple-calendar", backend);
    const controller = new AbortController();
    const call = callMcpTool(client, {
      args: {},
      name: "list_events",
      signal: controller.signal,
    });
    await running;
    controller.abort();
    await expect(call).rejects.toThrow();
    await expect.poll(() => stopped?.aborted).toBe(true);
  });
});

describe("the scripted apps' values", () => {
  it.each([
    ["apple-mail", "list_accounts", {}, MAIL_SCRIPTS.accounts, []],
    [
      "apple-mail",
      "list_messages",
      { account: "Work", limit: 5, mailbox: "Clients/Acme", unread: true },
      MAIL_SCRIPTS.list,
      ["Work", "Clients/Acme", "1", "5"],
    ],
    [
      "apple-mail",
      "search_messages",
      { account: "iCloud", query: "shipping confirmation" },
      MAIL_SCRIPTS.search,
      ["shipping confirmation", "iCloud", "", "20"],
    ],
    [
      "apple-mail",
      "move_message",
      { account: "iCloud", id: 4242, mailbox: "INBOX", to_mailbox: "Archive" },
      MAIL_SCRIPTS.move,
      ["4242", "iCloud", "INBOX", "Archive"],
    ],
    [
      "apple-mail",
      "draft_message",
      {
        body: "Running late.\n",
        cc: ["lee@example.com"],
        from: "me@example.com",
        subject: "Late",
        to: ["sam@example.com", "kim@example.com"],
      },
      MAIL_SCRIPTS.compose,
      [
        "draft",
        "Late",
        "Running late.",
        "me@example.com",
        "2",
        "sam@example.com",
        "kim@example.com",
        "1",
        "lee@example.com",
        "0",
        "0",
      ],
    ],
    [
      "apple-mail",
      "send_message",
      {
        attachments: ["/Users/mac-user/Desktop/plan.pdf"],
        body: "Attached.",
        to: ["sam@example.com"],
      },
      MAIL_SCRIPTS.compose,
      [
        "send",
        "",
        "Attached.\n",
        "",
        "1",
        "sam@example.com",
        "0",
        "0",
        "1",
        "/Users/mac-user/Desktop/plan.pdf",
      ],
    ],
    ["apple-notes", "list_folders", {}, NOTES_SCRIPTS.folders, [""]],
    [
      "apple-notes",
      "create_note",
      {
        body: "tortillas\nblack beans\n",
        folder: "Recipes",
        title: "Taco night",
      },
      NOTES_SCRIPTS.create,
      [
        "",
        "Recipes",
        "<div><h1>Taco night</h1></div><div>tortillas</div><div>black beans</div>",
      ],
    ],
    [
      "apple-notes",
      "append_to_note",
      { id: "x-coredata://1/ICNote/p7", text: "limes" },
      NOTES_SCRIPTS.append,
      ["x-coredata://1/ICNote/p7", "<div>limes</div>"],
    ],
    [
      "apple-messages",
      "send_message",
      { sms: true, text: "Running ten minutes late.", to: "+15555550100" },
      MESSAGES_SCRIPTS.send,
      ["+15555550100", "sms", "Running ten minutes late."],
    ],
  ])("%s %s", async (server, tool, args, script, values) => {
    const { backend, scripts } = recording(ok(""));
    const client = await connect(server, backend);
    const result = await client.callTool({ arguments: args, name: tool });
    expect(result.isError).toBeFalsy();
    expect(scripts).toEqual([{ script, values }]);
  });

  // Whatever the agent writes reaches the script as data: each value is one
  // argv entry, and the script is the same text whatever it holds.
  it.each([
    'Q3 "plan" & (do shell script "id")',
    '«event sysoexec» given «class prmp»:"id"',
    'one\nend run\non run argv\n\tdo shell script "id"',
    "-e",
  ])("hands %j to the script as one value", async (value) => {
    const { backend, scripts } = recording(ok(""));
    const client = await connect("apple-mail", backend);
    await client.callTool({
      arguments: { body: value, subject: value, to: ["sam@example.com"] },
      name: "send_message",
    });
    expect(scripts[0]?.values.slice(0, 3)).toEqual(["send", value, value]);
    expect(MAIL_SCRIPTS.compose).not.toContain(value);
  });

  it("refuses a mailbox named without its account, before anything runs", async () => {
    const { backend, scripts } = recording(ok(""));
    const client = await connect("apple-mail", backend);
    const result = await client.callTool({
      arguments: { mailbox: "Archive" },
      name: "list_messages",
    });
    expect(result.isError).toBe(true);
    expect(scripts).toEqual([]);
  });

  it("lists messages newest first", async () => {
    const line = (id: string, date: string) =>
      [
        id,
        "iCloud",
        "INBOX",
        date,
        "Sam <sam@example.com>",
        "Hi",
        "false",
      ].join(US);
    const { backend } = recording(
      ok(
        [
          line("1", "2026-10-01T09:00:00"),
          line("2", "2026-10-02T09:00:00"),
        ].join(RS),
      ),
    );
    const client = await connect("apple-mail", backend);
    const result = await client.callTool({
      arguments: {},
      name: "list_messages",
    });
    const { messages } = result.structuredContent as {
      messages: { id: number }[];
    };
    expect(messages.map((message) => message.id)).toEqual([2, 1]);
  });

  it("says what the script's own error means", async () => {
    const { backend } = recording({
      exitCode: 1,
      stderr:
        "0:0: execution error: An error of type 9003 has occurred. (9003)",
      stdout: "",
    });
    const client = await connect("apple-mail", backend);
    const result = await client.callTool({
      arguments: { id: 7 },
      name: "read_message",
    });
    expect(result.content).toEqual([
      {
        text: "no message has the id 7. Ids come from list_messages and search_messages.",
        type: "text",
      },
    ]);
  });

  it("escapes a note's text and keeps each line, a blank one as a gap", () => {
    expect(noteHtml('a < b & "c"\n\nd', "T")).toBe(
      "<div><h1>T</h1></div><div>a &lt; b &amp; &quot;c&quot;</div><div><br></div><div>d</div>",
    );
  });
});

describe("macOS refusing the app", () => {
  it.each([
    [
      "the helper's exit code 2",
      "apple-calendar",
      "add_event",
      { start: "today", title: "Lunch" },
      {
        exitCode: 2,
        stderr: "Instrument is not allowed to use your calendars.",
        stdout: "",
      },
      { bundleId: "com.apple.iCal", reason: "denied" },
    ],
    [
      "Automation refused",
      "apple-notes",
      "list_notes",
      {},
      {
        exitCode: 1,
        stderr:
          "execution error: Not authorized to send Apple events to Notes. (-1743)",
        stdout: "",
      },
      { bundleId: "com.apple.Notes", reason: "denied" },
    ],
    [
      "an Apple Event that timed out",
      "apple-mail",
      "list_accounts",
      {},
      {
        exitCode: 1,
        stderr:
          "execution error: Mail got an error: AppleEvent timed out. (-1712)",
        stdout: "",
      },
      { bundleId: "com.apple.mail", reason: "timed-out" },
    ],
  ])(
    "names the app under its meta key: %s",
    async (_name, server, tool, args, answer, refusal) => {
      const { backend } = recording(answer);
      const client = await connect(server, backend);
      const result = await client.callTool({ arguments: args, name: tool });
      expect(result.isError).toBe(true);
      expect(macosRefusalIn(result._meta)).toEqual(refusal);
    },
  );

  it("leaves any other failure unmarked", async () => {
    const { backend } = recording({
      exitCode: 1,
      stderr: "There is no calendar named Work.",
      stdout: "",
    });
    const client = await connect("apple-calendar", backend);
    const result = await client.callTool({
      arguments: { calendar: "Work" },
      name: "list_events",
    });
    expect(result.isError).toBe(true);
    expect(macosRefusalIn(result._meta)).toBeUndefined();
  });

  it("says a build without the helper has no way in", async () => {
    const client = await connect("apple-contacts", {
      script: () => Promise.resolve(ok("")),
    });
    const result = await client.callTool({
      arguments: {},
      name: "search_contacts",
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("no way into Contacts");
  });
});
