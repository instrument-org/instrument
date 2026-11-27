// Writes this fixture's chat: three hundred generated turns of tool work, each
// ending in a reply with a table, code or the files it made, so a transcript
// read back costs what a long working chat costs. Deterministic, so running it
// again rewrites the same file.
//
//   node fixtures/workspaces/long-work-chat/generate.ts

import { writeFileSync } from "node:fs";
import path from "node:path";

const TURNS = 300;
const SESSION = "ses_01MP0000000000000000000000";
const START = Date.parse("2026-11-02T08:00:00Z");
const FILES = [
  "/mnt/Instrument/harbor-survey/berths.csv",
  "/mnt/Instrument/harbor-survey/tides.md",
  "/mnt/Instrument/harbor-survey/report.html",
  "/mnt/Instrument/harbor-survey/moorings.json",
];
const MODEL = {
  author: "openai",
  canonicalId: "gpt-6-luna",
  features: ["inputFile", "inputImage", "inputText", "outputText", "tools"],
  name: "GPT 6 Luna",
  params: { provider: "openai", providerConfigId: "openai-config-id" },
  providerId: "gpt-6-luna",
  providerName: "OpenAI",
  releasedAt: "2026-09-14",
  tags: ["new", "coding", "recommended"],
  uri: "openai/gpt-6-luna?provider=openai&providerConfigId=openai-config-id",
};
const PIERS = ["north", "south", "east", "west", "outer", "ferry", "fuel"];
const BOATS = ["Kestrel", "Marigold", "Osprey", "Tern", "Bluebell", "Heron"];

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
let serial = 0;
/** A ULID-shaped id that sorts in the order it was made. */
function id(prefix: string): string {
  serial += 1;
  let n = serial;
  let tail = "";
  for (let i = 0; i < 12; i++) {
    tail = (CROCKFORD[n % 32] ?? "0") + tail;
    n = Math.floor(n / 32);
  }
  return `${prefix}_01MP${"0".repeat(10)}${tail}`;
}

let clock = START;
function at(seconds: number): string {
  clock += seconds * 1000;
  return new Date(clock).toISOString().replace(".000Z", "Z");
}

type Part = Record<string, unknown>;

function meta(messageId: string, extra: Record<string, unknown> = {}) {
  return {
    createdAt: at(1),
    id: id("prt"),
    messageId,
    sessionId: SESSION,
    ...extra,
  };
}

function bash(
  messageId: string,
  command: string,
  output: string,
  explanation: string,
): Part {
  return {
    input: { activity: explanation, command, explanation, yieldMs: 1000 },
    metadata: meta(messageId, { endedAt: at(2), startedAt: at(1) }),
    output: {
      command,
      commands: [command.split(" ")[0]],
      durationMs: 60,
      exitCode: 0,
      omittedBytes: 0,
      output,
      spillFilePath: null,
    },
    preliminary: false,
    state: "output-available",
    toolCallId: id("call"),
    type: "tool-bash",
  };
}

function readFile(messageId: string, filePath: string, content: string): Part {
  const lines = content.split("\n").length;
  return {
    input: { explanation: `Reading ${path.basename(filePath)}`, filePath },
    metadata: meta(messageId, { endedAt: at(1), startedAt: at(1) }),
    output: {
      content,
      displayedLines: lines,
      filePath,
      hasMoreLines: false,
      modifiedAt: clock,
      offset: 1,
      state: "exists",
      totalLines: lines,
      truncatedByBytes: false,
    },
    preliminary: false,
    state: "output-available",
    toolCallId: id("call"),
    type: "tool-read_file",
  };
}

function editFile(
  messageId: string,
  filePath: string,
  oldString: string,
  newString: string,
): Part {
  return {
    input: {
      explanation: `Updating ${path.basename(filePath)}`,
      filePath,
      newString,
      oldString,
    },
    metadata: meta(messageId, { endedAt: at(1), startedAt: at(1) }),
    output: {
      diff: [
        `Index: ${filePath}`,
        "===================================================================",
        `--- ${filePath}`,
        `+++ ${filePath}`,
        "@@ -1,1 +1,1 @@",
        `-${oldString}`,
        `+${newString}`,
      ].join("\n"),
      filePath,
      modifiedAt: clock,
    },
    preliminary: false,
    state: "output-available",
    toolCallId: id("call"),
    type: "tool-edit_file",
  };
}

function searchWeb(messageId: string, query: string): Part {
  return {
    input: { explanation: "Searching for the harbor notices", query },
    metadata: meta(messageId, { endedAt: at(2), startedAt: at(1) }),
    output: {
      results: {
        kind: "excerpts",
        sources: [
          {
            text: "Berth closures for the winter season.",
            title: "Harbor notices",
            url: "https://www.gov.uk/guidance/harbour-notices",
          },
          {
            text: "Tide tables for the coming month.",
            title: "Tide tables",
            url: "https://tidesandcurrents.noaa.gov/",
          },
          {
            text: "Mooring fees and how they are set.",
            title: "Mooring fees",
            url: "https://en.wikipedia.org/wiki/Mooring",
          },
        ],
      },
      state: "success",
    },
    preliminary: false,
    state: "output-available",
    toolCallId: id("call"),
    type: "tool-web_search",
  };
}

function text(messageId: string, words: string): Part {
  return {
    metadata: meta(messageId),
    state: "done",
    text: words,
    type: "text",
  };
}

function assistant(
  parts: (messageId: string) => Part[],
  finishReason: string,
  step: number,
) {
  const messageId = id("msg");
  const createdAt = at(2);
  const body = parts(messageId);
  return {
    id: messageId,
    metadata: {
      aiGatewayModel: MODEL,
      createdAt,
      finishedAt: at(1),
      finishReason,
      modelId: "gpt-6-luna",
      providerId: "openai",
      sessionId: SESSION,
    },
    parts: [
      { metadata: meta(messageId, { stepCount: step }), type: "step-start" },
      ...body,
    ],
    role: "assistant",
  };
}

function berthRows(turn: number, count: number): string[] {
  return Array.from({ length: count }, (_, row) => {
    const pier = PIERS[(turn + row) % PIERS.length];
    const boat = BOATS[(turn * 3 + row) % BOATS.length];
    return `| ${pier} ${(row + 1).toString()} | ${boat ?? ""} | ${(((turn * 7 + row * 13) % 40) + 8).toString()} m | ${row % 3 === 0 ? "moved" : "kept"} |`;
  });
}

function codeBlock(turn: number, lines: number): string {
  const body = Array.from({ length: lines }, (_, line) =>
    line === 0
      ? `const berths = await readCsv("berths.csv"); // pass ${turn.toString()}`
      : `berths[${line.toString()}].length = Math.max(berths[${line.toString()}].length, ${(((turn + line) % 30) + 10).toString()});`,
  );
  return ["```ts", ...body, "```"].join("\n");
}

/** The reply a turn ends on, longer and richer every few turns, as real ones are. */
function reply(turn: number): string {
  const kind = turn % 4;
  const lead = `Pass ${turn.toString()}: the survey of the **${PIERS[turn % PIERS.length] ?? ""} pier** is done, and the berth list matches the harbor master's notice.`;
  const table = [
    "| Berth | Boat | Length | Change |",
    "| --- | --- | --- | --- |",
    ...berthRows(turn, 4 + (turn % 5)),
  ].join("\n");
  const files = [
    "```files",
    FILES[turn % FILES.length],
    FILES[(turn + 1) % FILES.length],
    "```",
  ].join("\n");
  switch (kind) {
    case 0: {
      return `${lead}\n\n## What moved\n\n${table}\n\nThe two boats marked moved are on the outer wall until the dredging ends.\n\n${files}`;
    }
    case 1: {
      return `${lead}\n\nThe script that rebuilt the list:\n\n${codeBlock(turn, 6 + (turn % 9))}\n\nIt keeps each berth at least as long as the longest boat assigned to it.`;
    }
    case 2: {
      return `${lead}\n\n- The tide table for the week is in **tides.md**.\n- Mooring fees are unchanged.\n- The fuel pier opens an hour later on Sundays.\n\n${table}\n\n${files}`;
    }
    default: {
      return `${lead} Nothing else changed since the last pass, so the report stands as it was.`;
    }
  }
}

function turnMessages(turn: number) {
  const pier = PIERS[turn % PIERS.length] ?? "north";
  const n = turn.toString();
  const user = id("msg");
  const userCreated = at(40);
  const messages: unknown[] = [
    {
      id: user,
      metadata: { createdAt: userCreated, sessionId: SESSION },
      parts: [
        {
          metadata: meta(user),
          text: `Pass ${n}: survey the ${pier} pier again and tell me which berths changed. Keep the report and the berth list in step.`,
          type: "text",
        },
      ],
      role: "user",
    },
    assistant(
      (m) => [
        text(m, `Reading the berth list and the notice for pass ${n}.`),
        bash(
          m,
          `head -n 12 berths.csv`,
          [
            "berth,boat,length",
            ...berthRows(turn, 10).map((row) =>
              row
                .replaceAll(" | ", ",")
                .replaceAll("| ", "")
                .replaceAll(" |", ""),
            ),
          ].join("\n"),
          "Reading the berth list",
        ),
        readFile(
          m,
          "/mnt/Instrument/harbor-survey/tides.md",
          `# Tides, pass ${n}\n\n| Day | High | Low |\n| --- | --- | --- |\n| Mon | 06:12 | 12:30 |\n| Tue | 06:58 | 13:16 |\n| Wed | 07:41 | 14:02 |`,
        ),
        searchWeb(m, `${pier} pier berth notice pass ${n}`),
      ],
      "tool-calls",
      1,
    ),
    assistant(
      (m) => [
        text(
          m,
          `The notice moves two boats on the ${pier} pier; updating the list.`,
        ),
        editFile(
          m,
          "/mnt/Instrument/harbor-survey/berths.csv",
          `${pier} 2,Tern,18`,
          `${pier} 2,Tern,21`,
        ),
        bash(
          m,
          `python3 check_berths.py --pier ${pier}`,
          `checked 48 berths\n2 moved\n0 too short\n`,
          "Checking the berths",
        ),
        ...(turn % 3 === 0
          ? [
              bash(
                m,
                "git diff --stat",
                " berths.csv | 4 ++--\n report.html | 12 ++++++------\n 2 files changed, 8 insertions(+), 8 deletions(-)\n",
                "Comparing with the last pass",
              ),
            ]
          : []),
      ],
      "tool-calls",
      2,
    ),
    assistant((m) => [text(m, reply(turn))], "stop", 3),
  ];
  return messages;
}

const messages = Array.from({ length: TURNS }, (_, index) =>
  turnMessages(index + 1),
).flat();
const DATE_KEYS = new Set([
  "createdAt",
  "endedAt",
  "finishedAt",
  "startedAt",
  "updatedAt",
]);

/** The paths superjson reads back as dates: every timestamp the records carry. */
function datePaths(value: unknown, at: string[] = []): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      datePaths(item, [...at, index.toString()]),
    );
  }
  if (value === null || typeof value !== "object") {
    return [];
  }
  return Object.entries(value).flatMap(([key, item]) =>
    DATE_KEYS.has(key) && typeof item === "string"
      ? [[...at, key].join(".")]
      : datePaths(item, [...at, key]),
  );
}

const json = {
  createdAt: new Date(START).toISOString().replace(".000Z", "Z"),
  id: SESSION,
  messages,
  title: "Harbor survey",
  updatedAt: new Date(clock).toISOString().replace(".000Z", "Z"),
};
const superjsonMeta = {
  values: Object.fromEntries(datePaths(json).map((key) => [key, ["Date"]])),
};
writeFileSync(
  path.join(import.meta.dirname, "chats/harbor-survey/session.json"),
  `${JSON.stringify({ json, meta: superjsonMeta })}\n`,
);
