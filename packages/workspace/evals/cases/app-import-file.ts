/**
 * Asked to put things into a Mac app, does the work arrive as the file the app
 * imports, rather than as minutes of clicking through the app's windows?
 *
 * Found in real use: asked to recreate a user's Raycast snippets, a task
 * told to do it "through Raycast's interface" spent three minutes on 33 GUI-scripting calls through System Events and
 * created none. Raycast documents a JSON format its Import Snippets command
 * reads; once the user pointed at it, the same task made the file in under
 * forty seconds. `osascript` now refuses GUI scripting and names the routes to
 * take instead, and this case measures whether a run ends at the file.
 *
 * It runs as a chat, and the work is scored wherever it happened: in the chat
 * or in a task it forked. The date snippets are what show the docs were read: Raycast expands
 * `{date format="..."}` when a snippet fires, and a file with today's date
 * typed in is wrong tomorrow.
 *
 * Run against a build without the refusal, this case drives Raycast on the
 * machine it runs on.
 */
import { worksAppWindows } from "../../src/lib/shell-commands/osascript";
import { type Session } from "../../src/schemas/session";
import { type Assertion, type AssertionResult, defineEval } from "../harness";

/** What a session wrote, by path, whether with write_file or a command. */
function writes(
  sessions: Session.WithMessagesAndParts[],
): { content: string; path: string }[] {
  return sessions.flatMap((session) =>
    session.messages.flatMap((message) =>
      message.parts.flatMap((part) => {
        if (part.type === "tool-write_file") {
          const path: string | undefined = part.input?.filePath;
          const content: string | undefined = part.input?.content;
          return path === undefined ? [] : [{ content: content ?? "", path }];
        }
        if (part.type === "tool-bash") {
          const command: string | undefined = part.input?.command;
          return command === undefined ? [] : [{ content: command, path: "" }];
        }
        return [];
      }),
    ),
  );
}

/** What the chat and every task it forked wrote. */
async function treeWrites({
  childSessions,
  sessions,
}: Parameters<Assertion["check"]>[0]): Promise<
  { content: string; path: string }[]
> {
  const children = await childSessions();
  return [
    ...writes(sessions),
    ...children.flatMap((child) => writes(child.sessions)),
  ];
}

function result(
  text: string,
  passed: boolean,
  evidence: string,
): AssertionResult {
  return { evidence, passed, text };
}

function oneLine(text: string): string {
  return text.slice(0, 240).replaceAll("\n", " ⏎ ");
}

const makesAnImportFile: Assertion = {
  check: async (ctx) => {
    const text = "makes a JSON file for Raycast to import";
    const all = await treeWrites(ctx);
    const direct = all.find((write) => write.path.endsWith(".json"));
    if (direct !== undefined) {
      return result(text, true, direct.path);
    }
    // A script that holds the snippets and names its .json output.
    const scripted = all.find(
      (write) =>
        write.content.includes("sam@example.com") &&
        write.content.includes(".json"),
    );
    return scripted !== undefined
      ? result(
          text,
          true,
          `written by a script or command: ${oneLine(scripted.content)}`,
        )
      : result(
          text,
          false,
          `no .json written; wrote ${
            all
              .map((write) => write.path)
              .filter(Boolean)
              .join(", ") || "nothing"
          }`,
        );
  },
  text: "makes a JSON file for Raycast to import",
};

const leavesTheWindowsAlone: Assertion = {
  check: async (ctx) => {
    const text = "nothing tries to work an app's windows";
    const tried = (await treeWrites(ctx))
      .map((write) => write.content)
      .filter(
        (content) => /\bosascript\b/.test(content) && worksAppWindows(content),
      );
    return tried.length === 0
      ? result(text, true, "no GUI-scripting osascript call")
      : result(
          text,
          false,
          `${tried.length} calls, first: ${oneLine(tried[0] ?? "")}`,
        );
  },
  text: "nothing tries to work an app's windows",
};

const datesStayCurrent: Assertion = {
  check: async (ctx) => {
    const text = "the date snippets use Raycast's {date} placeholder";
    const placeholder = (await treeWrites(ctx)).find((write) =>
      /\{date\b/.test(write.content),
    );
    return placeholder === undefined
      ? result(text, false, "no {date ...} placeholder in anything written")
      : result(
          text,
          true,
          `in ${placeholder.path || "a command"}: ${/\{date[^}]*\}/.exec(placeholder.content)?.[0] ?? ""}`,
        );
  },
  text: "the date snippets use Raycast's {date} placeholder",
};

export const APP_IMPORT_FILE_EVALS = [
  defineEval({
    assertions: [makesAnImportFile, leavesTheWindowsAlone, datesStayCurrent],
    kind: "chat",
    // Asking the user for a folder waits on a picker no eval answers, until
    // the run's time cap; the chat chose its way in, and the run is scored.
    shouldStop: (part) => part.type === "tool-request_folder",
    name: "chat-raycast-snippets-as-an-import-file",
    prompt: [
      "My Raycast snippets didn't come over when I migrated to this Mac. Can you put them back? They all started with x:",
      "- xe: my email, sam@example.com",
      "- xew: my work email, sam@example.org",
      "- xds: today's date as a short date, like 261005",
      "- xdm: today's date as a medium date, like 10/5/26",
    ].join("\n"),
  }),
];
