import { HANDOFF_NOTES_PATH } from "../../src/lib/handoff-notes";
import { type Assertion, defineEval } from "../harness";

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
    const notesFile = HANDOFF_NOTES_PATH.split("/").at(-1) ?? "";
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

export const CONTEXT_ROLLOVER_EVALS = [
  defineEval({
    assertions: [keepsItsFormat, wroteNotesToTheNamedPath],
    followUps: Array.from({ length: FOLLOW_UP_COUNT }, () => "again"),
    name: "context-rollover-keeps-its-format",
    prompt:
      "Count from 1 to 3. Choose a distinctive way of writing the numbers, and use exactly that same way every time I say again.",
  }),
];
