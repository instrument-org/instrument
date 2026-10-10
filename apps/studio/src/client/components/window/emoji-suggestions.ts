import { useDecision } from "@/client/hooks/use-decision";
import { useEffect, useMemo, useState } from "react";

import { type Emoji } from "./emoji-set";

/**
 * Most options one Choice question takes is 255; one of them is `none`, so an
 * irrelevant chunk can say so instead of handing its least-bad emoji a high
 * probability that would outrank a real match from another chunk.
 */
const CHUNK = 250;

const NONE = "none";

/** Below this an emoji is the model shrugging, not suggesting. */
const FLOOR = 0.05;
/** One row of the picker's grid. */
const MOST = 8;

/**
 * Emoji that fit what `text` is about, ranked by the decision model: every
 * emoji is an option of one of a handful of Choice questions asked in a single
 * request, and the probabilities across all of them are merged into one list.
 * A keyword search finds 🍕 for "pizza"; this also finds 🦖 🧬 🎬 🌴 for
 * "jurassic park", which no emoji's name or tags contain.
 *
 * While the text is still being typed, the last answer stays up until the
 * next arrives, so what is shown changes once per answer rather than
 * blanking between them.
 */
export function useEmojiSuggestions(
  text: string,
  all: Emoji[] | undefined,
  {
    debounceMs = 150,
  }: {
    /** How long typing has to pause before the text is asked about. */
    debounceMs?: number;
  } = {},
) {
  const [settled, setSettled] = useState(text.trim());
  // Emptied at once rather than after the pause, so text that is gone (a
  // cleared field, a form opened afresh) is never answered for.
  if (!text.trim() && settled !== "") {
    setSettled("");
  }
  useEffect(() => {
    const timer = setTimeout(() => {
      setSettled(text.trim());
    }, debounceMs);
    return () => {
      clearTimeout(timer);
    };
  }, [debounceMs, text]);

  const questions = useMemo(() => (all ? questionsFor(all) : undefined), [all]);
  const byUnicode = useMemo(
    () => new Map((all ?? []).map((emoji) => [emoji.unicode, emoji])),
    [all],
  );

  const asking = questions !== undefined && settled.length > 1;
  // The question set is the same for every call, so the text alone keys it.
  const { answer, available } = useDecision({
    ask: asking ? { questions, state: settled } : undefined,
    checkAvailable: questions !== undefined,
    // Only an answer about the same words, a letter more or less, stands in:
    // a different query's picks would read as answers to this one.
    keepPrevious: ([, previousText]) =>
      typeof previousText === "string" &&
      previousText !== "" &&
      (settled.startsWith(previousText) || previousText.startsWith(settled)),
    key: ["emoji-suggestions", settled],
  });

  const suggestions = useMemo(() => {
    const ranked: { emoji: Emoji; probability: number }[] = [];
    for (const question of Object.values(answer?.answers ?? {})) {
      for (const [unicode, probability] of Object.entries(
        question.probabilities ?? {},
      )) {
        const emoji = byUnicode.get(unicode);
        if (emoji && probability >= FLOOR) {
          ranked.push({ emoji, probability });
        }
      }
    }
    return ranked
      .toSorted((a, b) => b.probability - a.probability)
      .slice(0, MOST);
  }, [answer, byUnicode]);

  return {
    /**
     * Whether suggestions can come, known before any are asked for, so a
     * picker draws a place for them only when a model can answer, rather
     * than one that never fills or one that shows and then goes.
     */
    available: available === true,
    /** Whether an answer for this text, or one before it, has arrived. */
    hasAnswer: asking && answer !== undefined,
    suggestions: asking ? suggestions : [],
  };
}

function questionsFor(all: Emoji[]) {
  const questions: Record<
    string,
    { criteria: Record<string, string>; instructions: string; type: "choice" }
  > = {};
  // Skin tones and hair styles alone (group 2) and the ungrouped regional
  // letters are never the answer, and each costs tokens on every request.
  const options = all.filter(
    (emoji) => emoji.group !== undefined && emoji.group !== 2,
  );
  for (let start = 0; start < options.length; start += CHUNK) {
    const criteria: Record<string, string> = { [NONE]: "None of these fit" };
    for (const emoji of options.slice(start, start + CHUNK)) {
      criteria[emoji.unicode] = emoji.label;
    }
    questions[`emoji-${start / CHUNK}`] = {
      criteria,
      instructions:
        "Which emoji best represents the topic named in the state? Pick none if nothing fits.",
      type: "choice",
    };
  }
  return questions;
}
