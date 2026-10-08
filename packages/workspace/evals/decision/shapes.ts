import { decisionBar } from "@instrument-org/shared/decision-bars";
import { createRequire } from "node:module";
import path from "node:path";

import {
  appMeaningRequest,
  getAppCatalog,
  pickMeant,
} from "../../src/lib/apps/catalog";
import { titleStillFits } from "../../src/lib/chat/retitle";
import { type Answer, type Asked, ask, type Question } from "./client";
import appCases from "./corpus/apps.json";
import backfillCases from "./corpus/backfill.json";
import realChats from "./corpus/chats.json";
import draftSets from "./corpus/drafts.json";
import emojiCases from "./corpus/emoji.json";
import padding from "./corpus/padding.json";
import retitleChats from "./corpus/retitle.json";
import searchCases from "./corpus/searches.json";
import settingsCorpus from "./corpus/settings.json";
import { type DecisionModel } from "./models";

/**
 * What one case adds to its shape's totals: counts summed across cases, and
 * the scores of what should and should not have been offered, pooled for a
 * threshold-free AUC. The product's bars were tuned on one model, and a model
 * that ranks well on a different scale would look worse through them than it
 * is; the AUC says how well it separates regardless of where its scale sits.
 */
export interface Metrics {
  counts: Record<string, number>;
  negatives?: number[];
  positives?: number[];
}

export interface ShapeCase {
  label: string;
  run: (model: DecisionModel) => Promise<{ asked: Asked; metrics: Metrics }>;
}

export interface Shape {
  about: string;
  cases: ShapeCase[];
  /** Columns read off the summed counts. */
  columns: {
    header: string;
    value: (counts: Record<string, number>) => string;
  }[];
  name: string;
}

type Body = { questions: Record<string, Question>; state: unknown };

/** A case asked in one decision, the way most shapes are. */
function single(
  label: string,
  request: (model: DecisionModel) => Body,
  score: (
    answers: Record<string, Answer>,
    model: string | undefined,
  ) => Metrics,
): ShapeCase {
  return {
    label,
    run: async (model) => {
      const asked = await ask(model, request(model));
      return { asked, metrics: score(asked.answers, asked.model) };
    },
  };
}

const ratio = (a: string, b: string) => (counts: Record<string, number>) =>
  `${counts[a] ?? 0}/${counts[b] ?? 0}`;
const count = (key: string) => (counts: Record<string, number>) =>
  String(counts[key] ?? 0);

// ---------------------------------------------------------------------------
// Chat search: apps/studio/src/client/components/window/use-chat-search-fallback.ts
// ---------------------------------------------------------------------------

const MEANINGFUL = "meaningful";
const MEANINGFUL_AT_LEAST = 0.3;
const FITS_AT_LEAST = { clef: 0.45, clefFlash: 0.6, other: 0.6 };
const MOST_CHATS_SHOWN = 12;

function chatSearchRequest(search: string, titles: string[]): Body {
  const questions: Record<string, Question> = {
    [MEANINGFUL]: {
      instructions:
        "Does the search in the state name a subject, task, or thing a chat could be about, rather than random keystrokes or filler?",
      type: "noul",
    },
  };
  titles.forEach((title, index) => {
    questions[String(index)] = {
      instructions: `Is the chat titled "${title}" related to what the search in the state names?`,
      type: "noul",
    };
  });
  return { questions, state: { search } };
}

function chatSearch(name: string, about: string, titles: string[]): Shape {
  return {
    about,
    cases: searchCases.map((labeled) =>
      single(
        labeled.query,
        () => chatSearchRequest(labeled.query, titles),
        (answers, model) => {
          const chance = (index: number) => answers[String(index)]?.noul ?? 0;
          const shown =
            (answers[MEANINGFUL]?.noul ?? 0) < MEANINGFUL_AT_LEAST
              ? []
              : titles
                  .map((_, index) => index)
                  .filter(
                    (index) =>
                      chance(index) >= decisionBar(model, FITS_AT_LEAST),
                  )
                  .toSorted((a, b) => chance(b) - chance(a))
                  .slice(0, MOST_CHATS_SHOWN);
          const must = new Set(labeled.must);
          const fine = new Set([...labeled.must, ...labeled.ok]);
          return {
            counts: {
              found: shown.filter((index) => must.has(index)).length,
              meant: Math.min(must.size, MOST_CHATS_SHOWN),
              wrong: shown.filter((index) => !fine.has(index)).length,
            },
            negatives: titles
              .map((_, index) => index)
              .filter((index) => !fine.has(index))
              .map(chance),
            positives: labeled.must.map(chance),
          };
        },
      ),
    ),
    columns: [
      { header: "found", value: ratio("found", "meant") },
      { header: "wrong", value: count("wrong") },
    ],
    name,
  };
}

const realTitles = realChats.map((chat) => chat.title);

// ---------------------------------------------------------------------------
// Settings search: apps/studio/src/client/components/settings/use-settings-search.ts
// ---------------------------------------------------------------------------

const SETTINGS_MEANINGFUL_AT_LEAST = 0.3;
const SETTINGS_FITS_AT_LEAST = { clef: 0.35, clefFlash: 0.3, other: 0.3 };
const MOST_SETTINGS_SHOWN = 8;

function settingsSearchRequest(search: string): Body {
  const questions: Record<string, Question> = {
    [MEANINGFUL]: {
      instructions:
        "Does the search in the state name a setting, feature, or thing someone could look for in an app's settings, rather than random keystrokes or filler?",
      type: "noul",
    },
  };
  settingsCorpus.entries.forEach((entry, index) => {
    questions[String(index)] = {
      instructions: `Is "${entry.title}" (${entry.detail.slice(0, 160)}) on the ${entry.tab} page of the app's settings what the search in the state is looking for?`,
      type: "noul",
    };
  });
  return { questions, state: { search } };
}

function settingsSearch(): Shape {
  const ids = settingsCorpus.entries.map((entry) => entry.id);
  return {
    about: `${settingsCorpus.searches.length} searches over ${ids.length} settings rows and skills, one yes-or-no each`,
    cases: settingsCorpus.searches.map((labeled) =>
      single(
        labeled.query,
        () => settingsSearchRequest(labeled.query),
        (answers, model) => {
          const chance = (index: number) => answers[String(index)]?.noul ?? 0;
          const must = new Set(labeled.must);
          const fine = new Set([...labeled.must, ...labeled.ok]);
          const shown =
            (answers[MEANINGFUL]?.noul ?? 0) < SETTINGS_MEANINGFUL_AT_LEAST
              ? []
              : ids
                  .map((id, index) => ({ chance: chance(index), id }))
                  .filter(
                    ({ chance: c }) =>
                      c >= decisionBar(model, SETTINGS_FITS_AT_LEAST),
                  )
                  .toSorted((a, b) => b.chance - a.chance)
                  .slice(0, MOST_SETTINGS_SHOWN)
                  .map(({ id }) => id);
          return {
            counts: {
              found: shown.filter((id) => must.has(id)).length,
              meant: must.size,
              wrong: shown.filter((id) => !fine.has(id)).length,
            },
            negatives: ids
              .map((id, index) => ({ id, index }))
              .filter(({ id }) => !fine.has(id))
              .map(({ index }) => chance(index)),
            positives: ids
              .map((id, index) => ({ id, index }))
              .filter(({ id }) => must.has(id))
              .map(({ index }) => chance(index)),
          };
        },
      ),
    ),
    columns: [
      { header: "found", value: ratio("found", "meant") },
      { header: "wrong", value: count("wrong") },
    ],
    name: "settings-search",
  };
}

// ---------------------------------------------------------------------------
// App search: searchAppCatalogByMeaning in src/lib/apps/catalog.ts
// ---------------------------------------------------------------------------

function appSearch(): Shape {
  const browsed = getAppCatalog().filter((entry) => entry.tier !== "hidden");
  return {
    about: `"design tool" over ${browsed.length} catalog services, one yes-or-no each`,
    cases: appCases.map((labeled) =>
      single(
        labeled.query,
        () => appMeaningRequest(labeled.query, browsed),
        (answers) => {
          const shown = pickMeant(answers);
          const must = new Set(labeled.must);
          const fine = new Set([...labeled.must, ...labeled.ok]);
          const chance = (slug: string) => answers[slug]?.noul ?? 0;
          return {
            counts: {
              found: shown.filter((slug) => must.has(slug)).length,
              meant: must.size,
              wrong: shown.filter((slug) => !fine.has(slug)).length,
            },
            negatives: browsed
              .map((entry) => entry.slug)
              .filter((slug) => !fine.has(slug))
              .map(chance),
            positives: labeled.must.map(chance),
          };
        },
      ),
    ),
    columns: [
      { header: "found", value: ratio("found", "meant") },
      { header: "wrong", value: count("wrong") },
    ],
    name: "app-search",
  };
}

// ---------------------------------------------------------------------------
// Emoji: apps/studio/src/client/components/window/emoji-suggestions.ts
// ---------------------------------------------------------------------------

interface Emoji {
  group?: number;
  label: string;
  order?: number;
  unicode: string;
}

const EMOJI_CHUNK = 250;
const EMOJI_FLOOR = 0.05;
const EMOJI_SHOWN = 8;
const NONE = "none";

/** The set Studio bundles, filtered and ordered the way `emoji-set.ts` does. */
function loadEmoji(): Emoji[] {
  const studio = createRequire(
    path.resolve(import.meta.dirname, "../../../../apps/studio/package.json"),
  );
  const all = studio("emojibase-data/en/compact.json") as Emoji[];
  return all
    .filter((emoji) => !emoji.label.startsWith("regional indicator"))
    .filter((emoji) => emoji.group !== undefined && emoji.group !== 2)
    .toSorted((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

/**
 * Chunks of 250 as the product asks, or smaller for a model that takes fewer
 * options a question, each with its own `none`.
 */
function emojiQuestions(options: Emoji[], maxOptions: number) {
  const chunk = Math.min(EMOJI_CHUNK, maxOptions - 1);
  const questions: Record<string, Question> = {};
  for (let start = 0; start < options.length; start += chunk) {
    const criteria: Record<string, string> = { [NONE]: "None of these fit" };
    for (const emoji of options.slice(start, start + chunk)) {
      criteria[emoji.unicode] = emoji.label;
    }
    questions[`emoji-${start / chunk}`] = {
      criteria,
      instructions:
        "Which emoji best represents the topic named in the state? Pick none if nothing fits.",
      type: "choice",
    };
  }
  return questions;
}

/** The first codepoint, without variation selectors, joiners, skin tones, or gender signs. */
function baseOf(unicode: string): string {
  const stripped = unicode
    .replaceAll(/[\uFE0F\u200D]/gu, "")
    .replaceAll(/[\u{1F3FB}-\u{1F3FF}♀♂]/gu, "");
  const first = stripped.codePointAt(0);
  return first === undefined ? "" : String.fromCodePoint(first);
}

/** Each emoji in a run of them, whole. */
const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
const eachEmoji = (run: string) =>
  Array.from(segmenter.segment(run), ({ segment }) => segment);

function emojiShape(): Shape {
  const options = loadEmoji();
  return {
    about: `${options.length} emoji as choice options, chunks of 250 (fewer where a model caps options)`,
    cases: emojiCases.map((labeled) =>
      single(
        labeled.text,
        (model) => ({
          questions: emojiQuestions(options, model.maxOptions),
          state: labeled.text,
        }),
        (answers) => {
          const ranked = Object.values(answers)
            .flatMap((answer) => Object.entries(answer.probabilities ?? {}))
            .filter(
              ([unicode, probability]) =>
                unicode !== NONE && probability >= EMOJI_FLOOR,
            )
            .toSorted((a, b) => b[1] - a[1])
            .slice(0, EMOJI_SHOWN)
            .map(([unicode]) => baseOf(unicode));
          const fits = new Set(eachEmoji(labeled.fits).map(baseOf));
          return {
            counts: {
              cases: 1,
              shown: ranked.some((unicode) => fits.has(unicode)) ? 1 : 0,
              top: fits.has(ranked[0] ?? "") ? 1 : 0,
            },
          };
        },
      ),
    ),
    columns: [
      { header: "in top 8", value: ratio("shown", "cases") },
      { header: "first", value: ratio("top", "cases") },
    ],
    name: "emoji",
  };
}

// ---------------------------------------------------------------------------
// Draft topic: apps/studio/src/client/components/window/use-draft-topic-suggestion.ts
// ---------------------------------------------------------------------------

const DRAFT_CONFIDENT = 0.7;

function draftTopic(): Shape {
  const cases = Object.values(draftSets).flatMap((set) =>
    set.cases.map((labeled) => ({ labeled, topics: set.topics })),
  );
  return {
    about: `${cases.length} opening messages, one choice over the user's topics plus none`,
    cases: cases.map(({ labeled, topics }) => {
      const [text, expected, alternates] = labeled as [
        string,
        string,
        string[]?,
      ];
      return single(
        text.slice(0, 60),
        () => ({
          questions: {
            topic: {
              criteria: {
                [NONE]: "No topic clearly fits",
                ...Object.fromEntries(topics.map((topic) => [topic, null])),
              },
              instructions: `Which of the user's topics should a new chat be filed under when it opens with "${text.replaceAll(/\s+/gu, " ")}"? Pick none unless one clearly fits.`,
              type: "choice",
            },
          },
          state: {},
        }),
        (answers) => {
          const answer = answers.topic;
          const pick =
            answer?.choice && answer.choice !== NONE
              ? answer.choice
              : undefined;
          const filed =
            pick !== undefined &&
            (answer?.probabilities?.[pick] ?? 0) >= DRAFT_CONFIDENT
              ? pick
              : undefined;
          const fine = new Set([expected, ...(alternates ?? [])]);
          return {
            counts: {
              filable: expected === NONE ? 0 : 1,
              right: filed !== undefined && filed === expected ? 1 : 0,
              wrong: filed !== undefined && !fine.has(filed) ? 1 : 0,
            },
          };
        },
      );
    }),
    columns: [
      { header: "filed right", value: ratio("right", "filable") },
      { header: "wrong", value: count("wrong") },
    ],
    name: "draft-topic",
  };
}

// ---------------------------------------------------------------------------
// Topic backfill: apps/studio/src/client/components/window/use-topic-backfill.ts
// ---------------------------------------------------------------------------

const BACKFILL_READ = 200;
const BELONGS = { clef: 0.55, clefFlash: 0.7, other: 0.7 };

function topicBackfill(): Shape {
  const candidates = realChats.slice(0, BACKFILL_READ);
  return {
    about: `a new topic's name against the newest ${candidates.length} chats, one yes-or-no each`,
    cases: backfillCases.map((labeled) =>
      single(
        labeled.topic,
        () => ({
          questions: Object.fromEntries(
            candidates.map((chat, index) => [
              String(index),
              {
                instructions: `Does the chat titled "${chat.title}", which opened with "${chat.ask.replaceAll(/\s+/gu, " ")}", belong under the topic in the state?`,
                type: "noul",
              },
            ]),
          ),
          state: { topic: { name: labeled.topic } },
        }),
        (answers, model) => {
          const chance = (index: number) => answers[String(index)]?.noul ?? 0;
          const filed = candidates
            .map((_, index) => index)
            .filter((index) => chance(index) >= decisionBar(model, BELONGS));
          const yes = new Set(labeled.yes);
          const fine = new Set([...labeled.yes, ...labeled.ok]);
          return {
            counts: {
              belong: yes.size,
              found: filed.filter((index) => yes.has(index)).length,
              wrong: filed.filter((index) => !fine.has(index)).length,
            },
            negatives: candidates
              .map((_, index) => index)
              .filter((index) => !fine.has(index))
              .map(chance),
            positives: labeled.yes.map(chance),
          };
        },
      ),
    ),
    columns: [
      { header: "found", value: ratio("found", "belong") },
      { header: "wrong", value: count("wrong") },
    ],
    name: "topic-backfill",
  };
}

// ---------------------------------------------------------------------------
// Retitle: titleStillFits in src/lib/chat/retitle.ts, called as shipped
// ---------------------------------------------------------------------------

function retitle(): Shape {
  // Each chat against its own title, and against another chat's title, which
  // has moved by construction.
  const cases = retitleChats.flatMap((chat, index) => [
    { chat, moved: chat.drifted, title: chat.title, which: "own" },
    {
      chat,
      moved: true,
      title: retitleChats[(index + 7) % retitleChats.length]?.title ?? "",
      which: "other",
    },
  ]);
  return {
    about: `${cases.length} chats each asked whether its title still fits`,
    cases: cases.map(({ chat, moved, title, which }) => ({
      label: `${chat.title} (${which} title)`,
      run: async (model) => {
        let asked: Asked | undefined;
        let failure: unknown;
        const kept = await titleStillFits({
          ask: async ({ body }) => {
            try {
              asked = await ask(model, body);
            } catch (error) {
              failure = error;
              throw error;
            }
            return {
              ms: asked.ms,
              provider: model.id,
              response: { answers: asked.answers, model: model.id },
            };
          },
          configs: [],
          currentTitle: title,
          opening: chat.opening,
          reply: chat.reply,
        });
        if (!asked) {
          throw failure instanceof Error
            ? failure
            : new Error("No decision was asked");
        }
        const chance = asked.answers.moved?.noul ?? 0;
        return {
          asked,
          metrics: {
            counts: {
              fitting: moved ? 0 : 1,
              keptFitting: !moved && kept ? 1 : 0,
              keptStale: moved && kept ? 1 : 0,
            },
            negatives: moved ? [] : [chance],
            positives: moved ? [chance] : [],
          },
        };
      },
    })),
    columns: [
      { header: "kept fitting", value: ratio("keptFitting", "fitting") },
      { header: "kept stale", value: count("keptStale") },
    ],
    name: "retitle",
  };
}

export function allShapes(): Shape[] {
  const paddedTitles = [...realTitles, ...padding.map((chat) => chat.title)];
  return [
    chatSearch(
      "chat-search",
      `${searchCases.length} searches over ${realTitles.length} chats, one yes-or-no each`,
      realTitles,
    ),
    chatSearch(
      "chat-search-1000",
      `the same searches with ${padding.length} unrelated chats added, the most the product asks about`,
      paddedTitles,
    ),
    appSearch(),
    settingsSearch(),
    emojiShape(),
    draftTopic(),
    topicBackfill(),
    retitle(),
  ];
}
