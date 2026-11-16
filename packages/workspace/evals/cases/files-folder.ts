/**
 * Where does finished work land, and what is it called? Scored from the disk:
 * every file a run added or changed in the person's Instrument folder and
 * home, outside the chat's work folder and the app's own data.
 *
 * Contrived cases pin one edge each (a quick answer, earlier work to
 * continue, unrelated earlier work, a project, a file the person sent, a
 * place the person named, several files from one job, a revision). The
 * `files-real-*` cases replay the first messages of chats from real use.
 *
 * Every case records the files it made (`placement`), which passes always
 * and carries the list a reader compares across runs; the other assertions
 * score the expectation the case was written for.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { outputFolderPath } from "../../src/lib/chat/output-folder";
import { type Assertion, defineEval, type EvalCase } from "../harness";
import { fail, pass } from "./handoff";

const DAY = 24 * 60 * 60 * 1000;

/** The Files folder at the top of the Instrument folder. */
function filesRoot(): string {
  return path.join(outputFolderPath(), "Files");
}

/** Folders no run's finished work is looked for in. */
const SKIPPED = new Set([
  ".instrument",
  ".instrument-dev",
  ".instrument-preview",
  "Library",
  "node_modules",
  ".venv",
  ".git",
  ".cache",
  ".npm",
  ".local",
  ".config",
]);

function walk(root: string, depth = 0, into = new Map<string, number>()) {
  if (depth > 7 || !fs.existsSync(root)) {
    return into;
  }
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (SKIPPED.has(entry.name) || entry.name === ".DS_Store") {
      continue;
    }
    // Dot folders in the home folder are tools' own (the work folder lives
    // under one), never where a person looks.
    if (entry.isDirectory() && entry.name.startsWith(".")) {
      continue;
    }
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      walk(full, depth + 1, into);
    } else if (entry.isFile()) {
      into.set(full, fs.statSync(full).mtimeMs);
    }
  }
  return into;
}

function snapshot(): Map<string, number> {
  const all = walk(outputFolderPath());
  walk(os.homedir(), 0, all);
  return all;
}

let before = new Map<string, number>();

/** Seeds files under the Files folder, `daysAgo` old, then snapshots. */
function seed(
  files: Record<string, string> = {},
  daysAgo = 5,
  extra?: () => void,
): () => void {
  return () => {
    const when = new Date(Date.now() - daysAgo * DAY);
    for (const [file, content] of Object.entries(files)) {
      const target = path.join(filesRoot(), file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
      fs.utimesSync(target, when, when);
    }
    extra?.();
    before = snapshot();
  };
}

/** Each file the run added or changed, shown from the folder it is in. */
function made(): string[] {
  const after = snapshot();
  const out: string[] = [];
  for (const [file, mtime] of after) {
    if (before.get(file) === mtime) {
      continue;
    }
    // The app's own copy of the conversation is not the agent's work.
    if (/\/Chats\/[^/]+\/(CHAT\.md|handoff-notes\.md)$/.test(file)) {
      continue;
    }
    if (shown(file).startsWith("machine/")) {
      continue;
    }
    if (/\/Memory\/[^/]+\.md$/.test(file)) {
      continue;
    }
    out.push(shown(file));
  }
  return out.sort();
}

function shown(file: string): string {
  const instrument = outputFolderPath();
  if (file.startsWith(`${instrument}/`)) {
    return file.slice(instrument.length + 1);
  }
  const home = os.homedir();
  return file.startsWith(`${home}/`)
    ? `~/${file.slice(home.length + 1)}`
    : file;
}

const placement: Assertion = {
  check: () => {
    const files = made();
    return pass(
      "placement",
      files.length > 0 ? files.join(" | ") : "(no file)",
    );
  },
  text: "placement",
};

const noFile: Assertion = {
  check: () => {
    const files = made();
    return files.length === 0
      ? pass("answered with no file", "none")
      : fail("answered with no file", files.join(" | "));
  },
  text: "answered with no file",
};

const someFileUnder = (prefix: string, text: string): Assertion => ({
  check: () => {
    const files = made();
    const evidence = files.join(" | ") || "(no file)";
    return files.some((file) => file.startsWith(prefix))
      ? pass(text, evidence)
      : fail(text, evidence);
  },
  text,
});

const nothingUnder = (prefix: string, text: string): Assertion => ({
  check: () => {
    const files = made();
    const evidence = files.join(" | ") || "(no file)";
    return files.some((file) => file.startsWith(prefix))
      ? fail(text, evidence)
      : pass(text, evidence);
  },
  text,
});

/** Every file the run made in the Instrument folder shares one folder. */
const oneFolder: Assertion = {
  check: () => {
    const files = made().filter((file) => !file.startsWith("~/"));
    const folders = new Set(files.map((file) => path.dirname(file)));
    const evidence = files.join(" | ") || "(no file)";
    return files.length > 0 && folders.size === 1
      ? pass("one folder for the job", evidence)
      : fail("one folder for the job", evidence);
  },
  text: "one folder for the job",
};

const chat = (
  name: string,
  prompt: string,
  assertions: Assertion[],
  more: Partial<EvalCase> = {},
): EvalCase =>
  defineEval({
    assertions: [placement, ...assertions],
    kind: "chat",
    name: `files-${name}`,
    prompt,
    setup: seed(),
    ...more,
  });

const settled = (prompt: string) => ({ prompt, settled: true });

const EARLIER_WORK = {
  "Kitchen remodel/Cabinet quotes.md":
    "# Cabinet quotes\n\n| Shop | Quote |\n| --- | --- |\n| Hartwell Cabinetry | $14,200 |\n| Oak & Iron | $11,850 |\n| Home Depot custom | $9,400 |\n",
  "Kitchen remodel/Layout notes.md":
    "# Layout notes\n\nGalley layout, 11 ft run. Island 3 x 6 ft. Countertop material still open: quartz, granite, or butcher block.\n",
  "Q3 board update/Q3 board update.md":
    "# Q3 board update\n\nRevenue $1.2M (+18% QoQ). Burn $310K/mo. Hiring: 2 engineers, 1 designer.\n",
  "Denver forecast/Denver 10-day forecast.html":
    "<!doctype html><title>Denver 10-day forecast</title><h1>Denver</h1><p>Sunny, highs in the 60s.</p>",
};

const TYPO_NOTES = `# Trip notes

We land in Lisbon on Thursday at 9am. Hotel is in Alfama, check in after 3pm.
Want to se the tile museum, eat pasteis de nata at Manteigaria, and take the tram 28.
Day trip to Sintra on saturday, book the Pena palace tikets ahead.
`;

export const FILES_FOLDER_EVALS = [
  // Contrived edges.
  chat(
    "first-file",
    "Write me a packing list for a 4-day ski trip to Breckenridge as a Markdown file I can print.",
    [someFileUnder("Files/", "placed in Files")],
  ),
  chat(
    "quick-answer",
    "What's the difference between a Roth IRA and a traditional IRA, in two sentences?",
    [noFile],
  ),
  chat(
    "continues-earlier",
    "For the kitchen remodel, write up a comparison of the three countertop materials I'm deciding between, as a document I can keep with the rest.",
    [someFileUnder("Files/Kitchen remodel/", "added to Kitchen remodel")],
    { setup: seed(EARLIER_WORK) },
  ),
  chat(
    "unrelated-to-earlier",
    "Make me a spreadsheet of the 10 tallest mountains in Colorado with their elevations.",
    [
      someFileUnder("Files/", "placed in Files"),
      nothingUnder("Files/Kitchen remodel/", "kept out of Kitchen remodel"),
      nothingUnder("Files/Q3 board update/", "kept out of Q3 board update"),
      nothingUnder("Files/Denver forecast/", "kept out of Denver forecast"),
    ],
    { setup: seed(EARLIER_WORK) },
  ),
  chat(
    "similar-to-earlier",
    "Make the same kind of 10-day forecast page for Boulder.",
    [someFileUnder("Files/", "placed in Files")],
    { setup: seed(EARLIER_WORK) },
  ),
  chat(
    "project",
    "Make a seating chart template as a spreadsheet: 80 guests across 10 tables.",
    [someFileUnder("Projects/Wedding/", "placed in the project's folder")],
    {
      project: {
        instructions:
          "Our wedding is June 12 next year at Cedar Hall, Asheville. About 80 guests.",
        name: "Wedding",
      },
    },
  ),
  chat(
    "sent-file",
    "Fix the typos in ~/Documents/Trip notes.md",
    [
      someFileUnder("~/Documents/Trip notes.md", "changed where it is"),
      nothingUnder("Files/", "no copy in Files"),
    ],
    {
      allowsFolders: 1,
      setup: seed({}, 5, () => {
        const target = path.join(os.homedir(), "Documents", "Trip notes.md");
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, TYPO_NOTES);
      }),
    },
  ),
  chat(
    "named-place",
    "Make me a printable grocery list for tacos for 6 people and put it on my Desktop.",
    [
      someFileUnder("~/Desktop/", "placed on the Desktop"),
      nothingUnder("Files/", "no copy in Files"),
    ],
    { allowsFolders: 1 },
  ),
  chat(
    "several-files",
    "Write a Python script that makes a bar chart of these monthly sales: Jan 120, Feb 95, Mar 140, Apr 160. I want the script and the chart image.",
    [oneFolder],
  ),
  chat(
    "revision",
    "Write a cover letter for a barista job at a neighborhood coffee shop, as a Word document. My name is Sam Rivera and I worked 2 years at a bakery.",
    [oneFolder],
    { followUps: [settled("Make it shorter and a bit friendlier.")] },
  ),
  chat(
    "scratch-only",
    "Check whether Python and Node both work on this computer and tell me their versions.",
    [noFile],
  ),
  // Real chats, first messages as sent.
  chat("real-weather", "weather in denver?", [], {
    followUps: [
      settled("Give me the day-by-day forecast, visualize it somehow"),
      settled(
        "Nice. And also do that for the, weather based out of a town one hour West of Denver.",
      ),
    ],
  }),
  chat(
    "real-druid-page",
    "Make me an instrument page that's something super duper cute inspired by World of Warcraft and Druids.",
    [oneFolder],
    { followUps: [settled("Do a bunch more crazy stuff with this")] },
  ),
  chat(
    "real-ffmpeg",
    "Can you test out your FFmpeg version and make sure it all works as you expect it to?",
    [noFile],
  ),
  chat(
    "real-water-enhancers",
    "Is there some new phenomenon with liquid water enhancers, especially caffeinated ones, that's made them possible, or is it just a new idea that's got traction? Has there been any, like, write-ups or thoughts about them that kind of explains what they are and why they've become possible and popular? I just noticed I'm even seeing white-labeled ones everywhere. Just curious for kind of a breakdown.",
    [],
  ),
  chat(
    "real-github-projects",
    "Can you do an assessment for me? I'm wondering: is there any publicly available information that would let you determine a way to construct a list on GitHub of the repos that are undergoing the largest amount of commits, probably because somebody is working really hard with agents and doing a ton of work? I'm thinking, of course, there's well-known, enormously popular repos. Those are less interesting to me. I want the under-the-radar ones.",
    [],
    {
      followUps: [
        settled(
          "Okay, so my method of validating this will just be for you to go find a few examples of repos like this, and then I'll tell you if it's working. So go ahead and try using this approach and give me like five results",
        ),
      ],
    },
  ),
  chat(
    "real-download-audio",
    "https://commanding-heights.com/ download the audio from here please",
    [someFileUnder("Files/", "placed in Files")],
  ),
  chat(
    "real-local-models",
    "What is the state of the art for a model that can actually run on a local computer that is like 16 gigs of RAM or something, like a typical Windows or Mac laptop? Like, what's the state of the art there? Tokens per second, intelligent level, all that stuff",
    [],
  ),
];
