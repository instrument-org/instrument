import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { decisionBar } from "@instrument-org/shared/decision-bars";
import { skipToken, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { askOf, byActivity, type Chat } from "./chats";

/** A chat a new topic could be filed on at once: which, and what it is called and asks. */
export interface BackfillCandidate {
  asked: string;
  id: Chat["id"];
  title: string;
}

type Answer = RPCOutput["workspace"]["decision"]["ask"];

/**
 * How sure the decision model has to be that a chat belongs. On 10 labeled
 * topics over 200 real chats, Clef-flash and Jev at 0.7 find 34 and 33 of
 * the 43 that belong, with 7 and 2 wrong; Clef scores lower and at 0.55 finds
 * 35 with 1 wrong.
 */
const BELONGS = { clef: 0.55, clefFlash: 0.7, other: 0.7 };
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
export function backfillCandidates(chats: Chat[]): BackfillCandidate[] {
  return byActivity(
    chats.filter((chat) => chat.topics.length === 0 && !chat.archived),
  )
    .slice(0, MOST_READ)
    .map((chat) => ({
      asked: askOf(chat).slice(0, ASK_MAX),
      id: chat.id,
      title: chat.title,
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
          rpcClient.workspace.decision.ask.call(
            {
              questions: Object.fromEntries(
                candidates.map((chat, index) => [
                  String(index),
                  {
                    // A sentence rather than an object: one decision model
                    // reads a structured question poorly and scores every
                    // chat alike.
                    instructions: `Does the chat titled "${chat.title}", which opened with "${chat.asked.replace(/\s+/g, " ")}", belong under the topic in the state?`,
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
    (_, index) =>
      (data.answers[String(index)]?.noul ?? 0) >=
      decisionBar(data.model, BELONGS),
  );
}
