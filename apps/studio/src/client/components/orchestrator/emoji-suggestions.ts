import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { skipToken, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { type Emoji } from "./emoji-set";

/**
 * Most options one Choice question takes is 255; one of them is `none`, so an
 * irrelevant chunk can say so instead of handing its least-bad emoji a high
 * probability that would outrank a real match from another chunk.
 */
const CHUNK = 250;

type Answer = RPCOutput["workspace"]["systemOne"]["ask"];
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
  // Typed up front: the placeholder callback reads the answer type back, so it
  // cannot also be inferred from the query function.
  const query = useQuery<Answer, Error, Answer, string[]>({
    // Only an answer about the same words, a letter more or less, stands in:
    // a different query's picks would read as answers to this one.
    placeholderData: (previous, previousQuery) => {
      const previousText = previousQuery?.queryKey[1] ?? "";
      return previousText &&
        (settled.startsWith(previousText) || previousText.startsWith(settled))
        ? previous
        : undefined;
    },
    // The question set is the same for every call, so the text alone keys it.
    queryFn: asking
      ? ({ signal }) =>
          rpcClient.workspace.systemOne.ask.call(
            { questions, state: settled },
            { signal },
          )
      : skipToken,
    queryKey: ["emoji-suggestions", settled],
    retry: false,
    staleTime: Infinity,
  });

  const suggestions = useMemo(() => {
    const ranked: { emoji: Emoji; probability: number }[] = [];
    for (const answer of Object.values(query.data?.answers ?? {})) {
      for (const [unicode, probability] of Object.entries(
        answer.probabilities ?? {},
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
  }, [byUnicode, query.data]);

  return {
    error: asking ? query.error : null,
    /** Whether an answer for this text, or one before it, has arrived. */
    hasAnswer: asking && query.data !== undefined,
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
