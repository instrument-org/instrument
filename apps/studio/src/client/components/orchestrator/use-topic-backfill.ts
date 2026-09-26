import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { skipToken, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { askOf, byActivity, type Thread } from "./threads";

/** A chat a new topic could be filed on at once: which, and what it is called and asks. */
export interface BackfillCandidate {
  asked: string;
  id: Thread["id"];
  title: string;
}

type Answer = RPCOutput["workspace"]["systemOne"]["ask"];

/**
 * How sure the decision model has to be that a chat belongs. Measured, chats
 * that fit a topic's name land at 0.7 to 0.95 and the rest at 0.2 or under,
 * so the bar sits in the gap.
 */
const BELONGS = 0.6;
/** The newest this many are read: one request, a fraction of a cent, well inside the model's context. */
const MOST_READ = 200;
const ASK_MAX = 200;
/** Long enough that a name is read once it is typed, not once a letter. */
const DEBOUNCE_MS = 600;

/**
 * The chats a new topic is offered to be filed on as it is made: the newest
 * ones filed under nothing, still in the inbox. Only these, so filing them
 * never takes a topic a chat already has or adds a second one to it.
 */
export function backfillCandidates(threads: Thread[]): BackfillCandidate[] {
  return byActivity(
    threads.filter((thread) => thread.topics.length === 0 && !thread.archived),
  )
    .slice(0, MOST_READ)
    .map((thread) => ({
      asked: askOf(thread).slice(0, ASK_MAX),
      id: thread.id,
      title: thread.title,
    }));
}

/**
 * Which of `candidates` belong under a topic called `name`, by the decision
 * model: one yes-or-no per chat, all in one request, asked when typing the
 * name pauses. It runs only while the new-topic dialog is open, which is
 * rare, and finds nothing without the model, so the dialog is the one it
 * always was.
 */
export function useTopicBackfill({
  candidates,
  name,
  open,
}: {
  candidates: BackfillCandidate[];
  name: string;
  open: boolean;
}) {
  const [settled, setSettled] = useState(name.trim());
  // Cleared at once rather than after the pause: a dialog closed or opened
  // afresh has no name, and the last one's chats must not be offered in it.
  if ((!open || !name.trim()) && settled !== "") {
    setSettled("");
  }
  useEffect(() => {
    const timer = setTimeout(() => {
      setSettled(name.trim());
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [name]);

  const asking = open && candidates.length > 0 && settled.length > 1;
  const { data } = useQuery<Answer, Error, Answer, string[]>({
    // While the name is still being typed, the last answer stays up until the
    // next arrives, so the line under the name changes once per answer
    // rather than blinking out between them.
    placeholderData: (previous, previousQuery) => {
      const previousName = previousQuery?.queryKey[1] ?? "";
      return previousName &&
        (settled.startsWith(previousName) || previousName.startsWith(settled))
        ? previous
        : undefined;
    },
    queryFn: asking
      ? ({ signal }) =>
          rpcClient.workspace.systemOne.ask.call(
            {
              questions: Object.fromEntries(
                candidates.map((chat, index) => [
                  String(index),
                  {
                    instructions: {
                      chat: { asked: chat.asked, title: chat.title },
                      question:
                        "Does `chat` belong under the topic in the state?",
                    },
                    type: "noul",
                  },
                ]),
              ),
              state: { topic: { name: settled } },
            },
            { signal },
          )
      : skipToken,
    queryKey: [
      "topic-backfill",
      settled,
      candidates.map((chat) => chat.id).join("\n"),
    ],
    retry: false,
    staleTime: Infinity,
  });

  if (!asking || !data) {
    return [];
  }
  return candidates.filter(
    (_, index) => (data.answers[String(index)]?.noul ?? 0) >= BELONGS,
  );
}
