import { type DecisionAnswer, useDecision } from "@/client/hooks/use-decision";
import { decisionBar } from "@instrument-org/shared/decision-bars";
import { useEffect, useState } from "react";

import { byActivity, type Chat } from "./chats";

/**
 * Most questions one request carries: the API refuses more than 512, and the
 * question about the search itself rides in the first. A longer search is
 * split evenly rather than in 500s, so no request is short enough for the API
 * to answer it from another model than the rest.
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
 * on its own rather than against the best fit. On 34 labeled searches over
 * 376 real chats, Clef-flash at 0.6 finds 86 of the 97 chats meant with 15
 * wrong, and Clef at 0.45 as many with 14; padded to 1000 chats, Clef offers
 * 30 wrong where Clef-flash offers 53.
 */
const FITS_AT_LEAST = { clef: 0.45, clefFlash: 0.6, other: 0.6 };
const MOST = 12;
/**
 * The most chats one search asks about, the most recently active first: two
 * requests, about 38 tokens a chat, so a search costs under a cent with
 * clef-flash however long the history grows.
 */
const MOST_ASKED = 1000;
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
  candidates: all,
  search,
}: {
  active: boolean;
  candidates: Chat[];
  search: string;
}) {
  const candidates =
    all.length > MOST_ASKED ? byActivity(all).slice(0, MOST_ASKED) : all;
  const [settled, setSettled] = useState(search.trim());
  useEffect(() => {
    const timer = setTimeout(() => {
      setSettled(search.trim());
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [search]);

  const settledNow = settled === search.trim();
  const askable = active && candidates.length > 0 && search.trim().length > 1;
  const { answer, available, isAsking } = useDecision({
    ask:
      askable && settledNow
        ? requestsFor(candidates).map((questions) => ({
            questions,
            state: { search: settled },
          }))
        : undefined,
    checkAvailable: active,
    usage: { purpose: "chat-search", surface: "chats" },
    key: [
      "chat-search",
      settled,
      candidates.map((chat) => `${chat.id}:${chat.title}`).join("\n"),
    ],
  });

  return {
    chats: answer ? fitting(answer, candidates) : [],
    /**
     * Whether an answer is coming: from the first key the words find nothing
     * for, while it is not yet known that nothing could answer, until the
     * answer arrives. So the list says it is looking through the pause rather
     * than "Nothing matches" a moment before the answer, and says nothing
     * matched straight away when no model could answer.
     */
    isLooking: askable && available !== false && (!settledNow || isAsking),
  };
}

/** The chats the answers say the search is after, best fit first, or none when the search names nothing. */
function fitting(
  { answers, model }: DecisionAnswer,
  candidates: Chat[],
): Chat[] {
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
    .filter(({ chance }) => chance >= decisionBar(model, FITS_AT_LEAST))
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
  const size = Math.ceil(
    questions.length / Math.ceil(questions.length / PER_REQUEST),
  );
  const requests = [];
  for (let start = 0; start < questions.length; start += size) {
    requests.push(Object.fromEntries(questions.slice(start, start + size)));
  }
  return requests;
}
