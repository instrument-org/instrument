/**
 * What realistic work costs, for sizing the usage limits.
 *
 * Every case runs to the end, in a chat as a person starts one, and is scored
 * only on having delivered: the point is the cost of the whole job, so
 * nothing stops a run early. The browsing cases use the live web and the
 * shopping, news and recipe sites people actually ask about, so a run's cost
 * includes what real pages put into the conversation. With
 * `EVAL_SEARCH_ACCOUNT` set, web search goes through the platform as it does
 * in Studio; without it every lookup falls back to browsing.
 *
 * The two `marathon` cases are one long conversation each, the shape that
 * cost the most in the beta: a chat carried across many turns, its context
 * growing with every one.
 */
import fs from "node:fs";
import path from "node:path";

import { type Assertion, defineEval, type EvalCase } from "../harness";
import {
  fail,
  HOME,
  pass,
  recentFilesUnder,
  runStartedAt,
  workspaceFolder,
} from "./handoff";

const MARATHON_TOKENS = 8_000_000;

/** A file matching `name` made anywhere in the workspace folder during the run. */
function delivered(name: RegExp, what: string): Assertion {
  const text = `delivered ${what}`;
  return {
    check: ({ sessions }) => {
      const files = recentFilesUnder(
        workspaceFolder(),
        runStartedAt(sessions),
        5,
      ).filter((file) => name.test(path.basename(file)));
      return files.length > 0
        ? pass(text, files.map((file) => path.basename(file)).join(", "))
        : fail(text, `nothing matching ${name.source}`);
    },
    text,
  };
}

const deliveredAPage = delivered(/\.html?$/i, "a page");

// ---------------------------------------------------------------------------
// A Downloads folder of the size people actually let pile up.

const DOWNLOAD_KINDS: [string, (index: number) => string][] = [
  ["Invoice-{n}.pdf", (n) => `%PDF-1.4\nInvoice ${n}\nTotal: $${n * 13}.00\n`],
  ["IMG_{n}.jpg", (n) => `JPEG stand-in ${n}`],
  ["Screen Shot 2026-0{m}-1{n} at 10.2{n}.png", (n) => `PNG stand-in ${n}`],
  ["export ({n}).csv", (n) => `date,amount\n2026-01-0${n % 9},${n * 7}\n`],
  ["Zoom_{n}.pkg", (n) => `installer ${n}`],
  ["notes-{n}.txt", (n) => `Meeting notes ${n}: follow up with the vendor.`],
  ["Q{q} report draft v{n}.docx", (n) => `Draft ${n} of the quarterly report`],
  ["boarding-pass-{n}.pdf", (n) => `%PDF-1.4\nBoarding pass ${n}\n`],
  ["resume_final_FINAL{n}.pdf", (n) => `%PDF-1.4\nResume version ${n}\n`],
  ["lease-signed-{n}.pdf", (n) => `%PDF-1.4\nLease page ${n}\n`],
];

function seedBigDownloads() {
  const dir = path.join(HOME, "Downloads");
  fs.rmSync(dir, { force: true, recursive: true });
  fs.mkdirSync(dir, { recursive: true });
  for (let n = 1; n <= 8; n++) {
    for (const [pattern, body] of DOWNLOAD_KINDS) {
      const name = pattern
        .replaceAll("{n}", String(n))
        .replaceAll("{m}", String((n % 9) + 1))
        .replaceAll("{q}", String((n % 4) + 1));
      fs.writeFileSync(path.join(dir, name), body(n));
    }
  }
}

const sortedDownloads: Assertion = {
  check: () => {
    const text = "sorted Downloads into folders";
    const dir = path.join(HOME, "Downloads");
    const folders = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory()).length;
    return folders >= 3
      ? pass(text, `${folders} folders`)
      : fail(text, `${folders} folders`);
  },
  text: "sorted Downloads into folders",
};

// ---------------------------------------------------------------------------

function chatCase(
  evalCase: Omit<EvalCase, "kind"> & { name: string },
): EvalCase {
  return defineEval({ ...evalCase, kind: "chat", name: `cost-${evalCase.name}` });
}

export const COST_STUDY_EVALS = [
  chatCase({
    assertions: [deliveredAPage],
    name: "headphones-comparison",
    prompt:
      "I'm deciding between the Sony WH-1000XM6 and the Bose QuietComfort Ultra headphones. Look at the official product pages and a couple of real reviews, check current prices at Best Buy, and make me a comparison page I can come back to.",
  }),
  chatCase({
    assertions: [deliveredAPage],
    name: "recipes-shopping-list",
    prompt:
      "Find me three vegetarian weeknight dinners from Serious Eats that take under 45 minutes, then make a page with the three recipes and one combined shopping list grouped by grocery aisle.",
  }),
  chatCase({
    assertions: [delivered(/\.(md|html?)$/i, "a summary")],
    name: "hacker-news-digest",
    prompt:
      "Go to Hacker News, open the top five stories on the front page right now, skim each article and its comments, and write me a short digest of what people are actually saying about each one.",
  }),
  chatCase({
    assertions: [deliveredAPage],
    name: "trip-plan",
    prompt:
      "My partner and I are going to Lisbon for four days in March. Plan it out: which neighborhood to stay in, a day-by-day plan with a mix of sights and food, rough costs, and how to get from the airport. Make it a page.",
  }),
  chatCase({
    assertions: [deliveredAPage],
    name: "research-brief",
    prompt:
      "I'm thinking about replacing our gas furnace with a heat pump. We live outside Minneapolis. Research whether cold-climate heat pumps actually work here, what they cost installed, and what rebates exist right now, and give me a one-page brief with sources.",
  }),
  chatCase({
    assertions: [sortedDownloads],
    name: "downloads-cleanup",
    prompt:
      "My Downloads folder is a disaster. Sort it into sensible folders, put the duplicates and old drafts somewhere I can review them, and tell me what you did. Don't delete anything.",
    allowsFolders: 1,
    setup: seedBigDownloads,
  }),
  chatCase({
    assertions: [deliveredAPage],
    name: "marathon-planning",
    maxRunTokens: MARATHON_TOKENS,
    prompt:
      "I'm hosting a dinner party for eight next Saturday. Two guests are vegetarian and one can't have gluten. Help me plan a menu.",
    followUps: [
      { prompt: "Love it. Can you find actual recipes online for each dish?", settled: true },
      { prompt: "Swap the dessert for something that can be made the day before.", settled: true },
      { prompt: "Make me a page with the menu and the recipes.", settled: true },
      { prompt: "Now a combined shopping list on that page, grouped by store section.", settled: true },
      { prompt: "Check Whole Foods' site for rough prices on the main ingredients and add an estimated total.", settled: true },
      { prompt: "Add a cooking timeline for the day so everything is ready at 7pm.", settled: true },
      { prompt: "What wine would go with the main course? Something under $25.", settled: true },
      { prompt: "Add the wine to the page.", settled: true },
      { prompt: "Actually one more guest is coming, so nine. Update the quantities.", settled: true },
      { prompt: "Can you make the page look nicer? More like a menu card at the top.", settled: true },
      { prompt: "Write a short text I can send the guests with the time and what to bring.", settled: true },
      { prompt: "Add a section for a playlist vibe, with a few artist suggestions.", settled: true },
      { prompt: "The gluten-free guest also can't have dairy. Which dishes need to change?", settled: true },
      { prompt: "Make those changes on the page.", settled: true },
      { prompt: "Give me a printable one-page version of just the timeline.", settled: true },
      { prompt: "Last thing: double-check every recipe link still works.", settled: true },
    ],
  }),
  chatCase({
    assertions: [deliveredAPage],
    name: "marathon-all-day",
    maxRunTokens: 30_000_000,
    prompt:
      "We're thinking about moving from Chicago to Denver next summer with two kids (7 and 10). Help me figure it out over the day. Start with which neighborhoods we should even be looking at.",
    followUps: [
      "Look up actual rentals on Zillow or Apartments.com for 3-bedrooms in the top three, under $3,500.",
      "What are the elementary schools like in each? Check GreatSchools.",
      "How long would the commute be from each to downtown Denver, by car and by transit? Check Google Maps or RTD.",
      "Start a page that compares the three neighborhoods with what we have so far.",
      "My partner works from home. Which has the best internet options? Check provider sites.",
      "Look up what Colorado state income tax would be compared to Illinois for about $180k household income.",
      "Add a cost-of-living section to the page.",
      "What's the weather actually like in winter? Snow days, sunshine, anything to worry about?",
      "Find a few kids' activities near each neighborhood: rec centers, soccer, swimming. Check the city's parks and rec site.",
      "Add those to the page.",
      "How much would a moving company cost for a 3-bedroom from Chicago to Denver? Get a couple of quotes from moving company sites.",
      "Compare that with renting a truck ourselves. Check U-Haul and Penske.",
      "Add a moving-costs section with both options.",
      "What do we need to do for car registration and driver's licenses in Colorado? Check the DMV site.",
      "Make a checklist on the page of everything to do before and after the move, in order.",
      "Look at the second neighborhood's Reddit or Nextdoor discussions for what people actually complain about.",
      "Add a 'what locals say' line to each neighborhood.",
      "Check crime stats for each neighborhood from the Denver police open data.",
      "Update the comparison table with crime.",
      "Find two or three listings in the best neighborhood that are available around June.",
      "Put those listings on the page with links and the key details.",
      "What are the best grocery stores near the top listing?",
      "Are there any good parks within walking distance of it? Check the map.",
      "My 10-year-old plays travel soccer. Find clubs in that area and their tryout dates.",
      "Add soccer clubs to the page.",
      "What's the timeline for school enrollment in Denver Public Schools? Check the DPS site.",
      "Add enrollment deadlines to the checklist.",
      "Look up how much health insurance would be on the Colorado marketplace if my partner's job doesn't cover us.",
      "Add that to cost of living.",
      "Recheck the three rental listings: are they still available?",
      "Make the page look polished: a summary at the top with our recommendation.",
      "Double-check every link on the page still works and fix any broken ones.",
      "Give me a short email I can send to the landlord of the top listing.",
      "Last thing: what are we forgetting?",
    ].map((prompt) => ({ prompt, settled: true })),
  }),
  chatCase({
    assertions: [delivered(/\.html?$/i, "the app")],
    name: "marathon-coding",
    maxRunTokens: MARATHON_TOKENS,
    prompt:
      "Build me a simple habit tracker as a web app in a Habit Tracker folder in my workspace: plain HTML, CSS and JavaScript, saving to localStorage. Habits down the side, the last 14 days across, click a cell to mark it done.",
    followUps: [
      { prompt: "Open it in the browser and make sure clicking actually works.", settled: true },
      { prompt: "Add a streak count next to each habit.", settled: true },
      { prompt: "Let me rename and delete habits.", settled: true },
      { prompt: "Add a dark mode that follows the system setting.", settled: true },
      { prompt: "The grid is cramped on my phone. Make it work on a narrow screen.", settled: true },
      { prompt: "Add a weekly summary chart under the grid, no libraries.", settled: true },
      { prompt: "Let me export and import my data as a JSON file.", settled: true },
      { prompt: "Write some tests for the streak logic and run them.", settled: true },
      { prompt: "There's a bug: the streak resets when a day in the past is unchecked. Fix it.", settled: true },
      { prompt: "Add reminders: a note at the top if a habit hasn't been done today after 8pm.", settled: true },
      { prompt: "Clean up the code, split it into a few files, and make sure everything still works in the browser.", settled: true },
      { prompt: "Write a short README explaining how to use it.", settled: true },
    ],
  }),
];
