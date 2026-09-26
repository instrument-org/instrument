import { type Draft } from "@/client/atoms/orchestrator";
import { rpcClient } from "@/client/rpc/client";
import { skipToken, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { type Topic } from "./threads";

/**
 * How sure the decision model has to be before it files a draft. Measured on
 * realistic drafts, a clear fit comes back near 1 and a vague or unrelated
 * message goes to `none`, so the bar sits high: a missed filing costs a click,
 * a wrong one costs trust.
 */
const CONFIDENT = 0.8;
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
  // which it would only guess at; names are unique within an orchestrator.
  const criteria = Object.fromEntries(
    topics.map((topic) => [topic.name, topic.about ?? null]),
  );
  const { data } = useQuery({
    queryFn: asking
      ? ({ signal }) =>
          rpcClient.workspace.systemOne.ask.call(
            {
              questions: {
                topic: {
                  criteria: { [NONE]: "No topic clearly fits", ...criteria },
                  instructions:
                    "The state is a message starting a new chat. Which of the user's topics should the chat be filed under? Pick none unless one clearly fits.",
                  type: "choice",
                },
              },
              state: settled,
            },
            { signal },
          )
      : skipToken,
    queryKey: ["draft-topic", settled, criteria],
    retry: false,
    staleTime: Infinity,
  });

  const answer = data?.answers.topic;
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
