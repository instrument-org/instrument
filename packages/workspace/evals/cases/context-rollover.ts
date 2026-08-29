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
    text.toLowerCase().match(/[^\s\d.,;:|()[\]{}<>\-–—_*#`"'\/\\]+/gu) ?? [];
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

function lastAssistantText(sessions: { messages: unknown[] }[]): string {
  return assistantTexts(sessions).at(-1) ?? "";
}

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
 * The failure this exists for: the first answer's own vocabulary is gone from
 * the last one. In the recorded case the agent spelled each number in English,
 * then after a rollover emitted the numbering with the words missing entirely.
 */
const keepsItsFormat: Assertion = {
  check: ({ sessions }) => {
    const texts = assistantTexts(sessions);
    const first = texts[0] ?? "";
    const last = lastAssistantText(sessions);
    const wanted = contentWords(first);

    if (wanted.size === 0) {
      return {
        evidence: `Inconclusive: the first answer contributed no words of its own to carry. First answer: ${JSON.stringify(first)}`,
        passed: false,
        text: "Kept the format it chose before the rollover",
      };
    }

    const present = [...wanted].filter((word) => last.toLowerCase().includes(word));
    const ratio = present.length / wanted.size;
    return {
      evidence: `${present.length}/${wanted.size} of the first answer's words survive in the last (${Math.round(ratio * 100)}%).\nFirst: ${JSON.stringify(first)}\nLast: ${JSON.stringify(last)}`,
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
