import { type Draft } from "@/client/atoms/window";
import { useDecision } from "@/client/hooks/use-decision";
import { useEffect, useState } from "react";

import { type Topic } from "./chats";

/**
 * How sure the decision model has to be before it files a draft. Clef-flash
 * picks the right topic but scores plain fits 0.7-0.9 where Jev gives near 1.
 * Over 91 hand-labeled drafts and 247 real opening messages it filed nothing
 * clearly wrong at 0.7 or more; below that, pasted agent prompts and near-misses
 * ("download speed" as Downloads) start to be filed. A suggestion is cheap to
 * take off, so the bar sits at the edge of that.
 */
const CONFIDENT = 0.7;
/** Fewer words than this say too little to file by ("hey", "one question"). */
const MIN_WORDS = 4;
/** A pause in typing, so the draft is read once it says something, not per word. */
const DEBOUNCE_MS = 800;
const NONE = "none";

/**
 * Files a draft under one of the topics from what it says, once: only while
 * the draft has no topic and the person has not picked or cleared one, and
 * only when the decision model is sure. What it files is marked as its own
 * (`topicSource: "suggested"`), so a person who takes it off is not second-
 * guessed, and nothing happens at all without the model: the draft stays as
 * the person left it.
 */
export function useDraftTopicSuggestion({
  draft,
  onChange,
  topics,
  words,
}: {
  draft: Draft;
  onChange: (update: (draft: Draft) => Draft) => void;
  topics: Topic[];
  words: string;
}) {
  const open = draft.topicId === undefined && draft.topicSource === undefined;

  const [settled, setSettled] = useState(words.trim());
  useEffect(() => {
    const timer = setTimeout(() => {
      setSettled(words.trim());
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [words]);

  const asking =
    open && topics.length > 0 && settled.split(/\s+/).length >= MIN_WORDS;
  // Topics are offered by name, which the model reads, rather than by id,
  // which it would only guess at; names are unique, each a folder of its own.
  const criteria = Object.fromEntries(
    topics.map((topic) => [topic.name, topic.about ?? null]),
  );
  const { answer: decision } = useDecision({
    ask: asking
      ? {
          questions: {
            topic: {
              criteria: { [NONE]: "No topic clearly fits", ...criteria },
              // A sentence holding the message rather than the message as
              // the state: read as the state, a long pasted message drew a
              // fit under the bar and pasted agent prompts were filed under
              // unrelated topics.
              instructions: `Which of the user's topics should a new chat be filed under when it opens with "${settled.replace(/\s+/g, " ")}"? Pick none unless one clearly fits.`,
              type: "choice",
            },
          },
          state: {},
        }
      : undefined,
    usage: { purpose: "topic-suggestion", surface: "draft" },
    key: ["draft-topic", settled, criteria],
  });

  const answer = decision?.answers.topic;
  const pick =
    answer?.choice && answer.choice !== NONE
      ? topics.find((topic) => topic.name === answer.choice)
      : undefined;
  const probability = pick ? (answer?.probabilities?.[pick.name] ?? 0) : 0;

  useEffect(() => {
    if (!open || !pick || probability < CONFIDENT) {
      return;
    }
    onChange((current) =>
      // Read again at write time: the person may have picked one meanwhile.
      current.topicId === undefined && current.topicSource === undefined
        ? { ...current, topicId: pick.id, topicSource: "suggested" }
        : current,
    );
  }, [onChange, open, pick, probability]);
}
