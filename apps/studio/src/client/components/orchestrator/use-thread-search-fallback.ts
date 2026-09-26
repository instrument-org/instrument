import { rpcClient } from "@/client/rpc/client";
import { skipToken, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { askOf, type Thread } from "./threads";

/** Most options one Choice question takes is 255; one of them is `none`. */
const CHUNK = 250;
const NONE = "none";
/**
 * The share of the answer a thread needs to be listed. A search can fit a few
 * threads at once, which split the probability between them, so the bar is
 * low; an unrelated query goes to `none` whole.
 */
const FLOOR = 0.15;
const MOST = 8;
/** How much of the opening ask describes a thread; its title carries the rest. */
const ASK_MAX = 200;
const DEBOUNCE_MS = 250;

/**
 * The threads a search means when none of them contains its words: the
 * decision model reads each candidate's title, opening ask, and topics, and
 * says which one the search is after, so "accountant stuff" finds the thread
 * about 1099 forms. Asked only while `active`, which the caller sets when the
 * words turned up nothing; without the model it finds nothing, which is what
 * the search already said.
 */
export function useThreadSearchFallback({
  active,
  candidates,
  search,
  topicNames,
}: {
  active: boolean;
  candidates: Thread[];
  search: string;
  topicNames: ReadonlyMap<string, string>;
}) {
  const [settled, setSettled] = useState(search.trim());
  useEffect(() => {
    const timer = setTimeout(() => {
      setSettled(search.trim());
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [search]);

  const askable = active && candidates.length > 0 && search.trim().length > 1;
  // Asked once typing pauses; until then the list says it is looking, so it
  // does not say "Nothing matches" a moment before an answer arrives.
  const asking = askable && settled === search.trim();
  const { data, isFetching } = useQuery({
    queryFn: asking
      ? ({ signal }) =>
          rpcClient.workspace.systemOne.ask.call(
            { questions: questionsFor(candidates, topicNames), state: settled },
            { signal },
          )
      : skipToken,
    queryKey: [
      "thread-search",
      settled,
      candidates.map((thread) => `${thread.id}:${thread.title}`).join("\n"),
    ],
    retry: false,
    staleTime: Infinity,
  });

  // Options are keyed by where the thread sits in `candidates`, chunk by
  // chunk, which is how they are read back.
  const found: { probability: number; thread: Thread }[] = [];
  for (const [name, answer] of Object.entries(data?.answers ?? {})) {
    const start = Number(name.slice("chats-".length)) * CHUNK;
    for (const [option, probability] of Object.entries(
      answer.probabilities ?? {},
    )) {
      const thread =
        option === NONE ? undefined : candidates[start + Number(option)];
      if (thread && probability >= FLOOR) {
        found.push({ probability, thread });
      }
    }
  }

  return {
    /** Whether the model is being asked, so the list can say it is looking rather than that nothing matched. */
    isLooking: askable && (!asking || isFetching),
    threads: asking
      ? found
          .toSorted((a, b) => b.probability - a.probability)
          .slice(0, MOST)
          .map(({ thread }) => thread)
      : [],
  };
}

function questionsFor(
  candidates: Thread[],
  topicNames: ReadonlyMap<string, string>,
) {
  const questions: Record<
    string,
    {
      criteria: Record<string, object | string>;
      instructions: string;
      type: "choice";
    }
  > = {};
  for (let start = 0; start < candidates.length; start += CHUNK) {
    const criteria: Record<string, object | string> = {
      [NONE]: "No chat is about this",
    };
    for (const [index, thread] of candidates
      .slice(start, start + CHUNK)
      .entries()) {
      const topics = thread.topics.flatMap((id) => topicNames.get(id) ?? []);
      criteria[String(index)] = {
        asked: askOf(thread).slice(0, ASK_MAX),
        title: thread.title,
        ...(topics.length > 0 ? { topics } : {}),
      };
    }
    questions[`chats-${start / CHUNK}`] = {
      criteria,
      instructions:
        "The state is what the user typed into the search over their chats. Which chat are they looking for? Pick none if no chat is about it.",
      type: "choice",
    };
  }
  return questions;
}
