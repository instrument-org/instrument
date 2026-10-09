import { type SettingsTab } from "@/client/atoms/settings-modal";
import { providerMetadataAtom } from "@/client/atoms/provider-metadata";
import {
  matchSettings,
  SETTINGS_INDEX,
  type SettingsEntry,
  type SettingsMatch,
} from "@/client/components/settings/settings-index";
import {
  useDecisionModelAvailable,
  useNoteDecisionModelUnreachable,
} from "@/client/components/window/use-decision-model-available";
import { useDeveloperMode } from "@/client/hooks/use-developer-mode";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { FEATURE_METADATA } from "@/shared/features";
import { decisionBar } from "@instrument-org/shared/decision-bars";
import { skipToken, useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { useDeferredValue, useEffect, useState } from "react";

const DEBOUNCE_MS = 300;
/** The shortest search worth asking the model about. */
const MEANING_MIN_LENGTH = 2;
/** Most results the model's answer adds, best fit first. */
const MOST = 8;
/** Most entries one search asks the model about: one request's worth. */
const MOST_ASKED = 400;
const MEANINGFUL = "meaningful";
/**
 * How sure the model has to be that the search names anything at all, taken
 * from chat search, which measured it on real chats.
 */
const MEANINGFUL_AT_LEAST = 0.3;
/**
 * How sure the answering model has to be that an entry fits; each scores on
 * its own scale. On 22 labeled settings searches (`pnpm eval:decision --shape
 * settings-search`), these find 16 to 19 of the 20 rows meant with two to
 * four offered that weren't.
 */
const FITS_AT_LEAST = { clef: 0.3, clefFlash: 0.2, other: 0.3 };

/**
 * Settings search: what the pages in `tabs` hold that matches `query`, by its
 * words, and by what it means only when the words find nothing and the
 * decision model can be reached.
 *
 * The providers the Providers page lists are read only while there is a
 * search, from the same query the page uses.
 */
export function useSettingsSearch({
  query,
  tabs,
}: {
  query: string;
  tabs: SettingsTab[];
}) {
  const active = query.trim().length > 0;
  const entries = useSettingsEntries({ active, tabs });
  const deferredQuery = useDeferredValue(query);
  const matches = matchSettings(entries, deferredQuery);
  const fallback = useMeaningFallback({
    active: matches.length === 0 && query.trim().length >= MEANING_MIN_LENGTH,
    // Read as soon as there is a search, so whether the model can answer is
    // known before the words run out rather than found out then.
    checkAvailable: active,
    // A page is found by its name, and a label by its row, so the model is
    // asked only about rows.
    candidates: entries.filter((entry) => !entry.page && !entry.mark),
    search: query,
  });
  return {
    isLooking: fallback.isLooking,
    matches:
      matches.length > 0
        ? matches
        : fallback.entries.map(
            (entry): SettingsMatch => ({
              entry,
              pageRanges: null,
              titleRanges: null,
            }),
          ),
  };
}

function useSettingsEntries({
  active,
  tabs,
}: {
  active: boolean;
  tabs: SettingsTab[];
}): SettingsEntry[] {
  const isDeveloperMode = useDeveloperMode();
  const { providerMetadataMap } = useAtomValue(providerMetadataAtom);
  const { data: providers = [] } = useQuery(
    rpcClient.providerConfig.live.list.experimental_liveOptions({
      enabled: active,
    }),
  );
  if (!active) {
    return [];
  }

  const pages = tabs.map(
    (tab): SettingsEntry => ({
      id: `page:${tab}`,
      page: true,
      tab,
      title: tab,
    }),
  );
  const entries: SettingsEntry[] = [
    ...pages,
    ...SETTINGS_INDEX.filter(
      (entry) =>
        isDeveloperMode || !("developerOnly" in entry && entry.developerOnly),
    ),
    ...providers.map((config) => ({
      detail: providerMetadataMap.get(config.type)?.name,
      id: `provider:${config.id}`,
      tab: "Providers" as const,
      title:
        config.displayName ||
        providerMetadataMap.get(config.type)?.name ||
        config.type,
    })),
    ...Object.entries(FEATURE_METADATA).map(([name, feature]) => ({
      detail: feature.description,
      id: `feature:${name}`,
      tab: "Features" as const,
      title: feature.title,
    })),
  ];
  return entries.filter((entry) => tabs.includes(entry.tab));
}

type Answers = RPCOutput["workspace"]["decision"]["ask"]["answers"];

/**
 * The entries a search means when none of them contain its words: the
 * decision model reads each one's title and gist and says of each on its own
 * whether it is what the search is after, so "night mode" can find Theme and
 * "stop sending data" Usage metrics. Asked once typing pauses, and only
 * while `active`. Nothing is sent with no provider that could answer, or for
 * a while after a request fails; each search is asked once and its answer
 * kept, so typing back to an earlier search reuses it.
 */
function useMeaningFallback({
  active,
  checkAvailable,
  candidates: all,
  search,
}: {
  active: boolean;
  checkAvailable: boolean;
  candidates: SettingsEntry[];
  search: string;
}) {
  const candidates = all.slice(0, MOST_ASKED);
  const [settled, setSettled] = useState(search.trim());
  useEffect(() => {
    const timer = setTimeout(() => {
      setSettled(search.trim());
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [search]);

  const available = useDecisionModelAvailable(checkAvailable);
  const noteUnreachable = useNoteDecisionModelUnreachable();
  const askable = active && available === true && candidates.length > 0;
  const asking = askable && settled === search.trim();
  const { data, isFetching } = useQuery({
    queryFn: asking
      ? async ({ signal }) => {
          try {
            const { answers, model } =
              await rpcClient.workspace.decision.ask.call(
                {
                  questions: questionsFor(candidates),
                  state: { search: settled },
                },
                { signal },
              );
            return { answers, model };
          } catch (error) {
            if (!signal.aborted) {
              noteUnreachable();
            }
            throw error;
          }
        }
      : skipToken,
    queryKey: [
      "settings-search",
      settled,
      candidates.map((entry) => entry.id).join("\n"),
    ],
    retry: false,
    retryOnMount: false,
    staleTime: Infinity,
  });

  return {
    entries: asking && data ? fitting(data, candidates) : [],
    /**
     * Whether an answer is coming, from the first key the words find nothing
     * for until it arrives, so the list says it is searching through the
     * pause rather than "No results" and then the results.
     */
    isLooking: askable && (!asking || isFetching),
  };
}

/** The entries the answers say the search is after, best fit first, or none when the search names nothing. */
function fitting(
  { answers, model }: { answers: Answers; model: string },
  candidates: SettingsEntry[],
) {
  if ((answers[MEANINGFUL]?.noul ?? 0) < MEANINGFUL_AT_LEAST) {
    return [];
  }
  return candidates
    .map((entry, index) => ({
      chance: answers[String(index)]?.noul ?? 0,
      entry,
    }))
    .filter(({ chance }) => chance >= decisionBar(model, FITS_AT_LEAST))
    .toSorted((a, b) => b.chance - a.chance)
    .slice(0, MOST)
    .map(({ entry }) => entry);
}

/**
 * One yes-or-no per entry, as a sentence: chat search found one decision
 * model reads a structured question poorly and scores everything alike.
 * Keyed by where the entry sits in `candidates`.
 */
function questionsFor(candidates: SettingsEntry[]) {
  const questions: Record<string, { instructions: string; type: "noul" }> = {
    [MEANINGFUL]: {
      instructions:
        "Does the search in the state name a setting, feature, or thing someone could look for in an app's settings, rather than random keystrokes or filler?",
      type: "noul",
    },
  };
  for (const [index, entry] of candidates.entries()) {
    const gist = entry.detail ? ` (${entry.detail})` : "";
    questions[String(index)] = {
      instructions: `Is "${entry.title}"${gist} on the ${entry.tab} page of the app's settings what the search in the state is looking for?`,
      type: "noul",
    };
  }
  return questions;
}
