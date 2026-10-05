import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { skipToken, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { askOf, type Chat } from "./chats";

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
/** How sure the model has to be that a chat is what the search is after. */
const FITS_AT_LEAST = 0.6;
/**
 * How far below the best fit a chat may score and still be listed: each
 * model's scale drifts with the search, so a fit is judged against the best.
 */
const FITS_WITHIN = 0.25;
const MOST = 8;
/** How much of the opening ask describes a chat; its title carries the rest. */
const ASK_MAX = 200;
const DEBOUNCE_MS = 250;

/**
 * The chats a search means when none of them contains its words: the
 * decision model reads each candidate's title, opening ask, and topics, and
 * says of each on its own whether the search is after it, so "accountant
 * stuff" finds the chat about 1099 forms and "shopping" every chat that
 * compared prices. Asked only while `active`, which the caller sets when the
 * words turned up nothing; without the model it finds nothing, which is what
 * the search already said.
 */
export function useChatSearchFallback({
  active,
  candidates,
  search,
  topicNames,
}: {
  active: boolean;
  candidates: Chat[];
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
      ? async ({ signal }) => {
          const asked = await Promise.all(
            requestsFor(candidates, topicNames).map((questions) =>
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
  const best = fits[0]?.chance ?? 0;
  return fits
    .filter(
      ({ chance }) => chance >= FITS_AT_LEAST && chance >= best - FITS_WITHIN,
    )
    .slice(0, MOST)
    .map(({ chat }) => chat);
}

/**
 * One yes-or-no per chat, split across as many requests as the API's cap
 * needs. Each question is a sentence rather than an object: one decision
 * model reads a structured question poorly and scores every chat alike.
 */
function requestsFor(
  candidates: Chat[],
  topicNames: ReadonlyMap<string, string>,
) {
  const questions: [string, { instructions: string; type: "noul" }][] =
    candidates.map((chat, index) => {
      const topics = chat.topics.flatMap((id) => topicNames.get(id) ?? []);
      const filed =
        topics.length > 0 ? `, filed under ${topics.join(", ")}` : "";
      const asked = oneLine(askOf(chat).slice(0, ASK_MAX));
      return [
        String(index),
        {
          instructions: `Is the chat titled "${chat.title}"${filed}, which opened with "${asked}", about what the search in the state is looking for?`,
          type: "noul",
        },
      ];
    });
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

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
