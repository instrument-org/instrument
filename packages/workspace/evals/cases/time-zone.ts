/**
 * Does the agent use the computer's time zone as a region rather than as the
 * user's city?
 *
 * The context names the zone so "what's the weather" or "is it too late to
 * call" has something to go on. Named by its IANA id ("America/Chicago"), it
 * hands the agent a city the user may not live in, and the agent answers as
 * if they did ("In Chicago, daylight saving time ends…"), which then reaches
 * the chat's title. Each case runs on a computer set to Chicago time:
 *
 * - `time-zone-dst`: a date question is answered for the region, without a
 *   city.
 * - `time-zone-weather`: the ask a city would serve, scored on whether the
 *   agent asks where the user is or says which place it answered for, rather
 *   than presenting a city it was never told.
 * - `time-zone-call`: local time still works: the agent compares the user's
 *   time with London's.
 */
import { type Assertion, defineEval } from "../harness";
import { replyText } from "./background-processes";

const ZONE = "America/Chicago";
let zoneBefore: string | undefined;

/** The computer the case runs on keeps Chicago time for the run alone. */
const onChicagoTime = {
  setup: () => {
    zoneBefore = process.env.TZ;
    process.env.TZ = ZONE;
  },
  teardown: () => {
    if (zoneBefore === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = zoneBefore;
    }
  },
};

function replyMatches(pattern: RegExp, text: string): Assertion {
  return {
    check: ({ sessions }) => {
      const reply = replyText(sessions);
      return {
        evidence: reply.slice(-400),
        passed: pattern.test(reply),
        text,
      };
    },
    text,
  };
}

/**
 * Scored on what the agent says, without its links: a source it cites may
 * name a city ("timeanddate.com/…/usa/chicago") without the reply claiming
 * the user lives there.
 */
function replyAvoids(pattern: RegExp, text: string): Assertion {
  return {
    check: ({ sessions }) => {
      const reply = replyText(sessions)
        .replaceAll(/\[[^\]]*\]\([^)]*\)/g, "")
        .replaceAll(/https?:\/\/\S+/g, "");
      return {
        evidence: reply.slice(-400),
        passed: !pattern.test(reply),
        text,
      };
    },
    text,
  };
}

const NO_CITY = replyAvoids(
  /\bchicago\b/i,
  "the reply names no city the user never gave",
);

export const TIME_ZONE_EVALS = [
  defineEval({
    ...onChicagoTime,
    assertions: [
      NO_CITY,
      replyMatches(
        /november\s+1\b|nov\.?\s+1\b/i,
        "the reply gives November 1",
      ),
    ],
    kind: "chat",
    name: "time-zone-dst",
    prompt: "when is daylight savings",
  }),
  defineEval({
    ...onChicagoTime,
    assertions: [
      NO_CITY,
      replyMatches(
        /\?|\bwhere\b|\bwhich (?:city|town)\b|\bfor (?:[A-Z][a-z]+)/,
        "the reply asks where the user is or says which place it answered for",
      ),
    ],
    kind: "chat",
    name: "time-zone-weather",
    prompt: "what's the weather",
  }),
  defineEval({
    ...onChicagoTime,
    assertions: [
      NO_CITY,
      replyMatches(
        /\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)|\d{1,2}:\d{2}/i,
        "the reply gives a time",
      ),
    ],
    kind: "chat",
    name: "time-zone-call",
    prompt: "is it too late to call my mom in london",
  }),
];
