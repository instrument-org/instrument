import { rpcClient } from "@/client/rpc/client";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
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
const FLOOR = 0.02;
const MOST = 24;

/** Long enough that a word typed at speed asks once, not once a letter. */
const DEBOUNCE_MS = 150;

/**
 * Emoji that fit what `text` is about, ranked by the decision model: every
 * emoji is an option of one of a handful of Choice questions asked in a single
 * request, and the probabilities across all of them are merged into one list.
 * A keyword search finds 🍕 for "pizza"; this also finds 🦖 🧬 🎬 🌴 for
 * "jurassic park", which no emoji's name or tags contain.
 */
export function useEmojiSuggestions(text: string, all: Emoji[] | undefined) {
  const [settled, setSettled] = useState(text.trim());
  useEffect(() => {
    const timer = setTimeout(() => {
      setSettled(text.trim());
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [text]);

  const questions = useMemo(() => (all ? questionsFor(all) : undefined), [all]);
  const byUnicode = useMemo(
    () => new Map((all ?? []).map((emoji) => [emoji.unicode, emoji])),
    [all],
  );

  const query = useQuery({
    enabled: questions !== undefined && settled.length > 1,
    placeholderData: keepPreviousData,
    // The question set is the same for every call, so the text alone keys it.
    queryFn: async ({ signal }) => {
      if (!questions) {
        return;
      }
      return rpcClient.workspace.systemOne.ask.call(
        { questions, state: settled },
        { signal },
      );
    },
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
      .slice(0, MOST)
      .map(({ emoji }) => emoji);
  }, [byUnicode, query.data]);

  return {
    error: query.error,
    /** What the last answer cost to get, for judging the spike by feel. */
    isFetching: query.isFetching,
    suggestions: settled.length > 1 ? suggestions : [],
    timing: query.data
      ? `${query.data.ms}ms via ${query.data.provider}`
      : undefined,
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
