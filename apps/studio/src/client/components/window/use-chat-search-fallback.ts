import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { skipToken, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { type Chat } from "./chats";
import { useDecisionModelAvailable } from "./use-decision-model-available";

/**
 * Most questions one request carries: the API refuses more than 512, and the
 * question about the search itself rides in the first.
 */
const PER_REQUEST = 500;
const MEANINGFUL = "meaningful";
/**
 * How sure the model has to be that the search names anything at all. Measured,
 * real searches ("accountant stuff", "1099s") land at 0.45 and up, and
 * keystrokes or filler ("asdf", "the") at 0.2 and under; without this, one
 * model scores a few chats high for any search, nonsense included.
 */
const MEANINGFUL_AT_LEAST = 0.3;
/**
 * How sure the model has to be that a chat is related to the search, judged
 * on its own rather than against the best fit: on 34 labeled searches over
 * 376 real chats, clef-flash found 89% of the chats each search meant, and
 * nonsense and searches about nothing there ("asdf", "taxes") top out at 0.4.
 */
const FITS_AT_LEAST = 0.6;
const MOST = 12;
const DEBOUNCE_MS = 250;

/**
 * The chats a search means when none of them contains its words: the
 * decision model reads each candidate's title and says of each on its own
 * whether it is related to the search, so "accountant
 * stuff" finds the chat about 1099 forms and "shopping" every chat that
 * compared prices. Asked only while `active`, which the caller sets when the
 * words turned up nothing; without the model it finds nothing, which is what
 * the search already said.
 */
export function useChatSearchFallback({
  active,
  candidates,
  search,
}: {
  active: boolean;
  candidates: Chat[];
  search: string;
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

  // Not asked when no provider could answer, so the list says straight away
  // that nothing matched rather than looking first.
  const available = useDecisionModelAvailable(active);
  const askable =
    active &&
    available !== false &&
    candidates.length > 0 &&
    search.trim().length > 1;
  // Asked once typing pauses and the model is known to be there; until then
  // the list says it is looking, so it does not say "Nothing matches" a
  // moment before an answer arrives.
  const asking = askable && available === true && settled === search.trim();
  const { data, isError, isFetching } = useQuery({
    queryFn: asking
      ? async ({ signal }) => {
          const asked = await Promise.all(
            requestsFor(candidates).map((questions) =>
              rpcClient.workspace.decision.ask.call(
                { questions, state: { search: settled } },
                { signal },
              ),
            ),
          );
          return asked.reduce<Answers>(
            (all, { answers }) => ({ ...all, ...answers }),
            {},
          );
        }
      : skipToken,
    queryKey: [
      "chat-search",
      settled,
      candidates.map((chat) => `${chat.id}:${chat.title}`).join("\n"),
    ],
    retry: false,
    staleTime: Infinity,
  });

  return {
    chats: asking && data ? fitting(data, candidates) : [],
    /** Whether the model was asked and could not be reached, which is not the same as finding nothing. */
    failed: asking && isError,
    /** Whether the model is being asked, so the list can say it is looking rather than that nothing matched. */
    isLooking: askable && (!asking || isFetching),
  };
}

type Answers = RPCOutput["workspace"]["decision"]["ask"]["answers"];

/** The chats the answers say the search is after, best fit first, or none when the search names nothing. */
function fitting(answers: Answers, candidates: Chat[]): Chat[] {
  if ((answers[MEANINGFUL]?.noul ?? 0) < MEANINGFUL_AT_LEAST) {
    return [];
  }
  // Questions are keyed by where the chat sits in `candidates`.
  const fits = candidates
    .map((chat, index) => ({
      chat,
      chance: answers[String(index)]?.noul ?? 0,
    }))
    .toSorted((a, b) => b.chance - a.chance);
  return fits
    .filter(({ chance }) => chance >= FITS_AT_LEAST)
    .slice(0, MOST)
    .map(({ chat }) => chat);
}

/**
 * One yes-or-no per chat, split across as many requests as the API's cap
 * needs. Each question is a sentence rather than an object: one decision
 * model reads a structured question poorly and scores every chat alike. The
 * title alone, asked whether it is related: measured against asking whether
 * the chat, with its topics and opening ask, is about the search, it found
 * more of the chats meant (89% against 80%) with less than half the wrong
 * ones, on a quarter fewer tokens; the opening ask mostly added noise.
 */
function requestsFor(candidates: Chat[]) {
  const questions: [string, { instructions: string; type: "noul" }][] =
    candidates.map((chat, index) => [
      String(index),
      {
        instructions: `Is the chat titled "${chat.title}" related to what the search in the state names?`,
        type: "noul",
      },
    ]);
  questions.unshift([
    MEANINGFUL,
    {
      instructions:
        "Does the search in the state name a subject, task, or thing a chat could be about, rather than random keystrokes or filler?",
      type: "noul",
    },
  ]);
  const requests = [];
  for (let start = 0; start < questions.length; start += PER_REQUEST) {
    requests.push(
      Object.fromEntries(questions.slice(start, start + PER_REQUEST)),
    );
  }
  return requests;
}
