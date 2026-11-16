import fs from "node:fs";
import path from "node:path";

import { HANDOFF_NOTES_FILE_NAME } from "../../src/constants";
import { type Assertion, defineEval } from "../harness";
import { fail, HOME, pass } from "./handoff";

/**
 * A rollover drops the agent's own turns and keeps the user's. Anything the
 * agent decided for itself therefore has to survive in the handoff notes or not
 * at all, which is why the prompt below never says how to answer: a format
 * named in a user message would still be in front of the model afterwards and
 * the case would pass without testing anything.
 *
 * "again" is the whole of every later turn for the same reason. It carries no
 * clue about what to repeat, so after a rollover the notes are the only thing
 * standing between the agent and a guess.
 *
 * Needs `INSTRUMENT_CONTEXT_LENGTH_OVERRIDE=16000` to reach a rollover in a
 * handful of short turns; against a real window this counts to three a dozen
 * times and proves nothing.
 *
 * Six, because a squeezed window is expensive rather than cheap: every turn
 * pays rollover machinery and a read and write of the notes, and a measured run
 * crossed two rollovers and a million tokens in five turns. Twelve reached the
 * harness token cap and stopped there, which reports as a stopped run rather
 * than a result. Six clears two rollovers, which is what the question needs:
 * one proves the handoff happens, the second proves the notes were kept current
 * rather than written once and left.
 */
const FOLLOW_UP_COUNT = 6;

/**
 * Words either side contributes regardless, including the prompt's own, so that
 * echoing the question back cannot look like keeping a format.
 */
const STOP_WORDS = new Set([
  "again",
  "and",
  "are",
  "choose",
  "count",
  "counting",
  "distinctive",
  "every",
  "exactly",
  "for",
  "from",
  "here",
  "numbers",
  "same",
  "say",
  "that",
  "the",
  "time",
  "use",
  "way",
  "writing",
  "you",
  "your",
]);

function assistantTexts(sessions: { messages: unknown[] }[]): string[] {
  const texts: string[] = [];
  for (const session of sessions) {
    for (const message of session.messages as {
      parts: { text?: string; type: string }[];
      role: string;
    }[]) {
      if (message.role !== "assistant") {
        continue;
      }
      const text = message.parts
        .filter((part) => part.type === "text" && part.text)
        .map((part) => part.text)
        .join("\n")
        .trim();
      if (text) {
        texts.push(text);
      }
    }
  }
  return texts;
}

/**
 * What the agent chose, rather than what either side would emit anyway. Digits
 * and separators are excluded because they survive the failure: the recorded
 * degradation kept `1. 2. 3.` and lost everything the agent had added to it, so
 * a signature built from digits would call that a pass.
 */
function contentWords(text: string): Set<string> {
  const tokens =
    text.toLowerCase().match(/[^\s\d.,;:|()[\]{}<>\-–—_*#`"'/\\]+/gu) ?? [];
  return new Set(tokens.filter((token) => !STOP_WORDS.has(token)));
}

function lastAssistantText(sessions: { messages: unknown[] }[]): string {
  return assistantTexts(sessions).at(-1) ?? "";
}

/**
 * The failure this exists for: the answer the agent settled on is gone from the
 * last one. In the recorded case it spelled each number in English, then after
 * a rollover emitted the numbering with the words missing entirely.
 *
 * Compares the lines that carry the count rather than everything the model
 * wrote. A first answer often explains the format it just chose, and a later
 * one has no reason to repeat that sentence, so scoring whole answers marks a
 * perfectly preserved format as lost -- measured, one model kept
 * `1. One / 2. Two / 3. Three` exactly and scored 21% on its prose alone.
 * Short lines are the answer; long ones are talk about it.
 */
const MAX_ANSWER_LINE_LENGTH = 40;

function answerLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length > 0 &&
        line.length <= MAX_ANSWER_LINE_LENGTH &&
        contentWords(line).size > 0,
    );
}

/**
 * The form two answers are compared in, so a format that survived is not
 * reported as lost over characters no reader can see.
 *
 * Every run of whitespace becomes one plain space. A model that separated its
 * numbers with U+202F on the first turn and U+0020 on the last wrote the same
 * answer both times, and measured, one did exactly that and scored zero.
 * JavaScript's `\s` already covers the no-break and narrow no-break spaces, so
 * this needs no list of its own to maintain.
 */
function comparable(text: string): string {
  return text.replaceAll(/\s+/gu, " ").trim();
}

/**
 * A line as it is looked for in a later answer, with trailing punctuation gone.
 *
 * A first answer often ends its count with a full stop and a later one does
 * not, which says nothing about whether the format held: measured, a model kept
 * `I, II, III` across two rollovers and failed on the period. Only the end is
 * stripped, because punctuation inside the line is part of the format the agent
 * chose, and `1. 2. 3.` differs from `1 2 3` in exactly the way this is
 * supposed to notice.
 */
function comparableLine(line: string): string {
  return comparable(line).replace(/[.,;:!?]+$/u, "");
}

const keepsItsFormat: Assertion = {
  check: ({ sessions }) => {
    const texts = assistantTexts(sessions);
    const first = texts[0] ?? "";
    const last = lastAssistantText(sessions);
    const wanted = answerLines(first);

    if (wanted.length === 0) {
      return {
        evidence: `Inconclusive: the first answer had no short line carrying anything of the agent's own. First answer: ${JSON.stringify(first)}`,
        passed: false,
        text: "Kept the format it chose before the rollover",
      };
    }

    const comparableLast = comparable(last);
    const kept = wanted.filter((line) =>
      comparableLast.includes(comparableLine(line)),
    );
    const ratio = kept.length / wanted.length;
    return {
      evidence: `${kept.length}/${wanted.length} of the first answer's lines appear in the last, ignoring whitespace and trailing punctuation (${Math.round(ratio * 100)}%).\nFirst: ${JSON.stringify(first)}\nLast: ${JSON.stringify(last)}`,
      passed: ratio >= 0.7,
      text: "Kept the format it chose before the rollover",
    };
  },
  text: "Kept the format it chose before the rollover",
};

/**
 * The other half, and the one the fix actually built: the warning names a path,
 * so notes written anywhere else are notes the assembler will not find.
 */
const wroteNotesToTheNamedPath: Assertion = {
  check: ({ sessions }) => {
    const notesFile = HANDOFF_NOTES_FILE_NAME;
    const wrote = sessions
      .flatMap((s) => s.messages as { parts: { type: string }[] }[])
      .flatMap((m) => m.parts)
      .some((part) => JSON.stringify(part).includes(notesFile));
    return {
      evidence: wrote
        ? `Touched ${notesFile}`
        : `Nothing in the run mentions ${notesFile}; the recorded failure was notes written to work/handoff.md or nowhere`,
      passed: wrote,
      text: "Wrote its handoff notes where the assembler reads them",
    };
  },
  text: "Wrote its handoff notes where the assembler reads them",
};

/**
 * Words that only turn up in a reply when the agent is talking about its own
 * rollover. The recorded failure (feedback:76pmzbpfqf3h) ended an answer with
 * "I also saved my research notes to `handoff-notes.md`" and a link to it.
 */
const BOOKKEEPING_WORDS =
  /hand-?off|rollover|rolled over|context window|ran out of context|was summari[sz]ed/iu;

const keptItsBookkeepingPrivate: Assertion = {
  check: ({ sessions }) => {
    const parts = sessions
      .flatMap((s) => s.messages as { parts: { type: string }[] }[])
      .flatMap((m) => m.parts);
    const rolledOver = parts.some(
      (part) => part.type === "data-contextRollover",
    );
    // Words are read outside code and link targets: an eval's home folder is
    // named for its case, so a linked file's path carries "context-rollover".
    const prose = (text: string) =>
      text
        .replaceAll(/```[\s\S]*?```/gu, "")
        .replaceAll(/`[^`]*`/gu, "")
        .replaceAll(/\]\([^)]*\)/gu, "]");
    const told = assistantTexts(sessions).filter(
      (text) =>
        BOOKKEEPING_WORDS.test(prose(text)) ||
        text.includes(HANDOFF_NOTES_FILE_NAME),
    );
    return {
      evidence: !rolledOver
        ? "Inconclusive: the run never rolled over"
        : told.length === 0
          ? "No reply mentions the rollover, a summary or the notes"
          : `Told the user:\n${told.map((text) => JSON.stringify(text)).join("\n")}`,
      passed: rolledOver && told.length === 0,
      text: "Rolled over without mentioning it or its notes to the user",
    };
  },
  text: "Rolled over without mentioning it or its notes to the user",
};

/**
 * Follow-ups for the summarized case: research turns, each a web search or
 * two, so the conversation grows the way the recorded chat did.
 */
const RESEARCH_FOLLOW_UPS = [
  "What about herbalism and mining on their own? Look up current numbers.",
  "Which of those holds up on a fresh server? Check a couple more sources.",
  "And alchemy once I can make flasks? Find what people report.",
  "So what should I pick? Give me your recommendation.",
];

// ---------------------------------------------------------------------------
// What a summary carries: a finding the agent worked out from files, asked
// for after the files' contents and its own turns are gone.

interface Doc {
  fact: string;
  name: string;
}

/**
 * A document long enough that a folder of six fills a price step's worth of
 * window in a turn or two: the one line that matters, buried in filler that
 * reads like the real thing.
 */
function longDoc(title: string, fact: string, seed: number): string {
  const filler = Array.from({ length: 90 }, (_, line) => {
    const n = (seed * 31 + line * 17) % 97;
    return `Line ${line + 1}: item ${n}-${seed}, standard terms apply, see section ${(n % 9) + 1} for the conditions that govern this line and the schedule it ships on.`;
  });
  return [
    title,
    "",
    ...filler.slice(0, 45),
    "",
    fact,
    "",
    ...filler.slice(45),
  ].join("\n");
}

const QUOTES: Doc[] = [
  {
    fact: "Quote QX-11872. M4 stainless bolts: $0.094 per bolt. No minimum order.",
    name: "Brightline Supply",
  },
  {
    fact: "Quote HF-58213. M4 stainless bolts: $0.071 per bolt. Minimum order 40,000 bolts.",
    name: "Harlow Fasteners",
  },
  {
    fact: "Quote 7731-B. M4 stainless bolts: $0.088 per bolt. Minimum order 5,000 bolts.",
    name: "Kestrel Industrial",
  },
  {
    fact: "Quote NW-2290. M4 stainless bolts: $0.079 per bolt. No minimum order.",
    name: "Northwind Parts",
  },
  {
    fact: "Quote OP-6604. M4 stainless bolts: $0.102 per bolt. No minimum order.",
    name: "Oakpoint Hardware",
  },
  {
    fact: "Quote TS-4417. M4 stainless bolts: $0.083 per bolt. Minimum order 10,000 bolts.",
    name: "Tidewater Supply",
  },
];

const CARRIERS: Doc[] = [
  { fact: "Ground to Denver: 4 business days.", name: "Arrow Freight" },
  { fact: "Ground to Denver: 2 business days.", name: "Summit Logistics" },
  { fact: "Ground to Denver: 5 business days.", name: "Coastal Carriers" },
  { fact: "Ground to Denver: 3 business days.", name: "Prairie Express" },
  { fact: "Ground to Denver: 6 business days.", name: "Redline Haulage" },
  { fact: "Ground to Denver: 4 business days.", name: "Granite Transport" },
];

const RETURN_DAYS = [30, 14, 60, 21, 45, 7];

const RETURNS: Doc[] = QUOTES.map((quote, index) => ({
  fact: `Returns accepted within ${String(RETURN_DAYS[index] ?? 30)} days of delivery.`,
  name: quote.name,
}));

function writeDocs(folder: string, kind: string, docs: Doc[]) {
  const dir = path.join(HOME, "Documents", folder);
  fs.mkdirSync(dir, { recursive: true });
  docs.forEach((doc, index) =>
    fs.writeFileSync(
      path.join(dir, `${doc.name} ${kind}.txt`),
      longDoc(`${doc.name}: ${kind}`, doc.fact, index + 1),
    ),
  );
}

interface StoredPart {
  input?: unknown;
  text?: string;
  type: string;
}
interface StoredMessage {
  parts: StoredPart[];
  role: string;
}

function messagesOf(sessions: { messages: unknown[] }[]): StoredMessage[] {
  return sessions.flatMap((s) => s.messages as StoredMessage[]);
}

const summarizedFirst: Assertion = {
  check: ({ sessions }) => {
    const summaries = messagesOf(sessions)
      .flatMap((m) => m.parts)
      .filter(
        (part) =>
          part.type === "data-contextRollover" &&
          JSON.stringify(part).includes('"summary"'),
      ).length;
    return summaries > 0
      ? pass("summarized before the last question", `${summaries} summaries`)
      : fail(
          "summarized before the last question",
          "Inconclusive: no summarized rollover, so the recall proves nothing",
        );
  },
  text: "summarized before the last question",
};

function lastTurn(sessions: { messages: unknown[] }[]): StoredMessage[] {
  const messages = messagesOf(sessions);
  const lastUser = messages.findLastIndex((m) => m.role === "user");
  return messages.slice(lastUser + 1);
}

/** Recorded rather than scored when it reopens: a cheap check is no failure. */
const recalledFromTheSummary: Assertion = {
  check: ({ sessions }) => {
    const turn = lastTurn(sessions);
    const text = turn
      .filter((m) => m.role === "assistant")
      .flatMap((m) => m.parts)
      .filter((part) => part.type === "text")
      .map((part) => part.text ?? "")
      .join("\n");
    const reopened = turn
      .flatMap((m) => m.parts)
      .some(
        (part) =>
          part.type.startsWith("tool-") &&
          JSON.stringify(part.input ?? "").includes("Supplier quotes"),
      );
    const wanted = [/HF-58213/u, /0?\.071/u, /40,?000/u, /Harlow/iu];
    const missing = wanted.filter((pattern) => !pattern.test(text));
    const evidence = `${reopened ? "reopened the quotes; " : ""}${text.replaceAll("\n", " ").slice(0, 400)}`;
    return missing.length === 0 && !reopened
      ? pass(
          "recalled the cheapest quote, its number, price and minimum",
          evidence,
        )
      : fail(
          "recalled the cheapest quote, its number, price and minimum",
          `missing ${missing.map(String).join(", ") || "nothing"}; ${evidence}`,
        );
  },
  text: "recalled the cheapest quote, its number, price and minimum",
};

export const CONTEXT_ROLLOVER_EVALS = [
  defineEval({
    assertions: [
      keepsItsFormat,
      wroteNotesToTheNamedPath,
      keptItsBookkeepingPrivate,
    ],
    followUps: Array.from({ length: FOLLOW_UP_COUNT }, () => "again"),
    name: "context-rollover-keeps-its-format",
    prompt:
      "Count from 1 to 3. Choose a distinctive way of writing the numbers, and use exactly that same way every time I say again.",
  }),
  /**
   * The summarized rollover a price step takes, which asks for no notes.
   * Needs `INSTRUMENT_PRICE_STEP_OVERRIDE=60000`: the fixed part of a request
   * runs to about 33K tokens, so a step much under that summarizes every turn.
   */
  defineEval({
    assertions: [keptItsBookkeepingPrivate],
    followUps: RESEARCH_FOLLOW_UPS,
    name: "context-rollover-summary-stays-private",
    prompt:
      "How much gold per hour are people making in WoW Classic right now? Search a few sources and tell me what they report.",
  }),
  /**
   * Whether a summary keeps what the agent worked out: the answer to the first
   * question comes from files, not from anything the user said, so after a
   * summary only the summary has it. Needs
   * `INSTRUMENT_PRICE_STEP_OVERRIDE=50000`, so the conversation summarizes
   * more than once, which is where a summary has gone wrong.
   */
  defineEval({
    assertions: [
      summarizedFirst,
      recalledFromTheSummary,
      keptItsBookkeepingPrivate,
    ],
    followUps: [
      "Now go through every file in Documents/Shipping terms and tell me which carrier gets to Denver fastest.",
      "And go through every file in Documents/Returns policies: which supplier takes returns for longest?",
      "Without opening the quotes again: which supplier was cheapest per bolt, what was its quote number and price, and what was the catch?",
    ],
    // Granted up front: a folder card ends the first turn, the next follow-up
    // lands at once, and the agent answers it instead of the quotes.
    folders: [{ inPlace: true, path: path.join(HOME, "Documents") }],
    name: "context-rollover-summary-keeps-a-finding",
    prompt:
      "Go through every quote in Documents/Supplier quotes and tell me which supplier is cheapest per bolt, with its quote number and any catch.",
    setup: () => {
      writeDocs("Supplier quotes", "quote", QUOTES);
      writeDocs("Shipping terms", "shipping terms", CARRIERS);
      writeDocs("Returns policies", "returns policy", RETURNS);
    },
  }),
];
