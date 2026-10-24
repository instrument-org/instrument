import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { finishedWorkFolder } from "../../src/lib/chat/output-folder";
import { FFMPEG_PATH, FFPROBE_PATH } from "../../src/lib/ffmpeg";
import { chatDir, chatOwnFolder } from "../../src/lib/record-folders";
import { workDir } from "../../src/lib/work-dir";
import { getWorkspaceConfig } from "../../src/lib/workspace-config";
import { workspaceLayout } from "../../src/lib/workspace-layout";
import { type Session } from "../../src/schemas/session";
import { type Assertion, defineEval } from "../harness";

/**
 * The person's Instrument folder is often synced (iCloud Drive, Dropbox,
 * OneDrive), so a `node_modules`, `.venv` or build folder the agent makes in
 * it goes to every device they have. Each case asks for work on a folder of
 * theirs that tempts an install or a build there, and is scored on three
 * things: no dependency or build folder lands in the workspace, the result
 * lands where they asked, and the agent did the work on their files rather
 * than shying away from them.
 *
 * The last four tempt no install. They catch the opposite failure: work the
 * person asked for left in the work folder, where they never look, or a
 * file of theirs not changed where it is.
 *
 * Every case in a run shares one workspace, so run each case in a process of
 * its own (`pnpm eval run workspace-hygiene-<name>`) for a clean scan.
 */

/** Folders an install, a build, or a tool's cache leaves, by name. */
const DEPENDENCY_DIR_NAMES = new Set([
  ".cache",
  ".next",
  ".parcel-cache",
  ".pnpm-store",
  ".turbo",
  ".venv",
  ".vite",
  "node_modules",
  "site-packages",
  "venv",
]);

type Found = { files: number; path: string };

/** Files under `root`, counted up to `limit`. */
function countFiles(root: string, limit = 100_000): number {
  let count = 0;
  const stack = [root];
  while (stack.length > 0 && count < limit) {
    const dir = stack.pop() ?? "";
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        stack.push(path.join(dir, entry.name));
      } else {
        count++;
      }
    }
  }
  return count;
}

/**
 * Every dependency, build, or cache folder in the workspace outside the
 * app's own `.instrument/` and what the eval keeps beside it (the runtime
 * and the machine folder, which holds the work folders here): one named for
 * what makes it, a virtualenv by any name (it has a `pyvenv.cfg`), or a Cargo
 * `target/`.
 */
function dependencyDirsIn(root: string): Found[] {
  const config = getWorkspaceConfig();
  const skipped = new Set([
    workspaceLayout(root).dataDir,
    config.runtimeDir,
    config.workspaceMachineDir,
    config.workFoldersDir,
  ]);
  const found: Found[] = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const full = path.join(dir, entry.name);
      if (skipped.has(full)) {
        continue;
      }
      const isDependency =
        DEPENDENCY_DIR_NAMES.has(entry.name) ||
        fs.existsSync(path.join(full, "pyvenv.cfg")) ||
        (entry.name === "target" &&
          fs.existsSync(path.join(dir, "Cargo.toml")));
      if (isDependency) {
        found.push({
          files: countFiles(full),
          path: path.relative(root, full),
        });
      } else {
        walk(full);
      }
    }
  };
  walk(root);
  return found;
}

const keepsDependenciesOutOfTheWorkspace: Assertion = {
  check: () => {
    const found = dependencyDirsIn(getWorkspaceConfig().rootDir);
    return {
      evidence:
        found.length === 0
          ? "No dependency, build, or cache folder in the workspace"
          : found.map((one) => `${one.path} (${one.files} files)`).join(", "),
      passed: found.length === 0,
      text: "Keeps dependency, build, and cache folders out of the workspace",
    };
  },
  text: "Keeps dependency, build, and cache folders out of the workspace",
};

/** Every bash command the run made, in order. */
function bashCommands(sessions: Session.WithMessagesAndParts[]): string[] {
  return sessions.flatMap((session) =>
    session.messages.flatMap((message) =>
      message.parts.flatMap((part) =>
        part.type === "tool-bash" && part.input?.command !== undefined
          ? [String(part.input.command)]
          : [],
      ),
    ),
  );
}

/** What the agent wrote to the person. */
function replyText(sessions: Session.WithMessagesAndParts[]): string {
  return sessions
    .flatMap((session) => session.messages)
    .filter((message) => message.role === "assistant")
    .flatMap((message) => message.parts)
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("\n");
}

/**
 * Not scored: the install and build commands the run made, so a report
 * shows what was tempted and where it ran.
 */
const recordsInstalls: Assertion = {
  check: ({ sessions }) => {
    const installs = bashCommands(sessions).filter((command) =>
      /\b(?:pnpm|npm|yarn|bun)\s+(?:i|install|add)\b|\buv\s+(?:sync|venv|add|init|pip\s+install)\b|\bpip3?\s+install\b|-m\s+venv\b|\bcargo\s+build\b|\bvite\s+build\b|\bpnpm\s+(?:run\s+)?build\b/.test(
        command,
      ),
    );
    return {
      evidence:
        installs.length === 0
          ? "No install or build"
          : installs.map((command) => command.slice(0, 200)).join(" | "),
      passed: true,
      text: "Records the install and build commands",
    };
  },
  text: "Records the install and build commands",
};

/** Files under `folder` in the workspace whose names match, outside dependency folders. */
function filesIn(folder: string, name: RegExp): string[] {
  const root = path.join(getWorkspaceConfig().rootDir, folder);
  try {
    return fs
      .readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && name.test(entry.name))
      .map((entry) =>
        path.relative(root, path.join(entry.parentPath, entry.name)),
      )
      .filter(
        (file) =>
          !file.split(path.sep).some((part) => DEPENDENCY_DIR_NAMES.has(part)),
      );
  } catch {
    return [];
  }
}

function delivers(
  folder: string,
  name: RegExp,
  text: string,
  also?: (sessions: Session.WithMessagesAndParts[]) => string | undefined,
): Assertion {
  return {
    check: ({ sessions }) => {
      const files = filesIn(folder, name);
      const missing = also?.(sessions);
      return {
        evidence:
          files.length === 0
            ? `Nothing matching ${name.source} in ${folder}. Reply: ${replyText(sessions).slice(-300)}`
            : (missing ?? `${folder}: ${files.slice(0, 8).join(", ")}`),
        passed: files.length > 0 && missing === undefined,
        text,
      };
    },
    text,
  };
}

function seed(file: string, content: string | Buffer) {
  const target = path.join(getWorkspaceConfig().rootDir, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

const SALES = [
  "month,revenue",
  "Jan,12400",
  "Feb,13100",
  "Mar,15800",
  "Apr,14900",
  "May,17200",
  "Jun,18950",
].join("\n");

const DESIGN = `# Landing page

- Hero: headline "Plan trips together", subhead "One shared board for every trip you take with friends."
- One email field and a "Join the waitlist" button under the subhead.
- Warm off-white background, dark green (#1f4d3a) button, rounded corners.
`;

function seedClip() {
  const target = path.join(getWorkspaceConfig().rootDir, "Movies", "clip.mp4");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  execFileSync(FFMPEG_PATH, [
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc=duration=4:size=320x240:rate=24",
    "-pix_fmt",
    "yuv420p",
    target,
  ]);
}

function clipSeconds(): number {
  const clip = path.join(getWorkspaceConfig().rootDir, "Movies", "clip.mp4");
  try {
    return Number(
      execFileSync(FFPROBE_PATH, [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "csv=p=0",
        clip,
      ])
        .toString()
        .trim(),
    );
  } catch {
    return Number.NaN;
  }
}

const speedsUpTheClipInPlace: Assertion = {
  check: ({ sessions }) => {
    const seconds = clipSeconds();
    // Four seconds at twice the speed is two; a little either way for frames.
    const passed = seconds > 1.5 && seconds < 2.6;
    return {
      evidence: `Movies/clip.mp4 is ${seconds}s. Reply: ${replyText(sessions).slice(-200)}`,
      passed,
      text: "Changes the person's video where it is, as asked",
    };
  },
  text: "Changes the person's video where it is, as asked",
};

const ranTheScraper = (sessions: Session.WithMessagesAndParts[]) =>
  /example domain/i.test(replyText(sessions))
    ? undefined
    : "The script is there, but the reply never gave the page's title";

/** Files under `root` whose names match, by path relative to it. */
function filesUnder(root: string, name: RegExp): string[] {
  try {
    return fs
      .readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && name.test(entry.name))
      .map((entry) =>
        path.relative(root, path.join(entry.parentPath, entry.name)),
      );
  } catch {
    return [];
  }
}

/**
 * A chart with no place given lands where the person sees it: the
 * conversation's own folder, or anywhere else in their Instrument folder,
 * never only in the work folder.
 */
const deliversTheChartWhereTheyLook: Assertion = {
  check: ({ chatId, sessions }) => {
    const chart = /\.(?:png|svg|jpe?g|pdf|html)$/i;
    const own = finishedWorkFolder(chatOwnFolder(chatDir(chatId)));
    const visible = filesUnder(own, chart);
    const workOnly = filesUnder(workDir(chatId), chart);
    return {
      evidence:
        visible.length > 0
          ? `${path.basename(own)}: ${visible.slice(0, 5).join(", ")}`
          : workOnly.length > 0
            ? `Only in the work folder: ${workOnly.slice(0, 5).join(", ")}`
            : `No chart anywhere. Reply: ${replyText(sessions).slice(-300)}`,
      passed: visible.length > 0,
      text: "Puts the chart in the conversation's own folder, where the person sees it",
    };
  },
  text: "Puts the chart in the conversation's own folder, where the person sees it",
};

const CONTACTS = [
  "name,email",
  "Ana Ruiz , ana@example.com",
  "Ben Ito,ben@example.com",
  "Ana Ruiz , ana@example.com",
  " Cleo Park,cleo@example.com ",
  "Ben Ito,ben@example.com",
].join("\n");

const cleansNextToTheOriginal: Assertion = {
  check: ({ sessions }) => {
    const folder = path.join(getWorkspaceConfig().rootDir, "Data");
    const original = fs.readFileSync(path.join(folder, "contacts.csv"), "utf8");
    const cleaned = filesUnder(folder, /\.csv$/i)
      .filter((file) => file !== "contacts.csv")
      .filter((file) => {
        const text = fs.readFileSync(path.join(folder, file), "utf8");
        const rows = text.trim().split(/\r?\n/);
        return rows.length === 4 && !/ ,| \n|^ /m.test(text);
      });
    const kept = original === CONTACTS;
    return {
      evidence:
        cleaned.length > 0
          ? `Data: ${cleaned.join(", ")}${kept ? "" : "; the original changed"}`
          : `No cleaned CSV beside the original. Data: ${filesUnder(folder, /./).join(", ")}. Reply: ${replyText(sessions).slice(-200)}`,
      passed: cleaned.length > 0 && kept,
      text: "Saves the cleaned CSV next to the original and keeps the original",
    };
  },
  text: "Saves the cleaned CSV next to the original and keeps the original",
};

const TODO = "# To do\n\n- Renew passport\n- Book dentist\n";

const editsTheListInPlace: Assertion = {
  check: ({ sessions }) => {
    const file = path.join(getWorkspaceConfig().rootDir, "Notes", "todo.md");
    const text = fs.readFileSync(file, "utf8");
    const passed =
      /call the plumber/i.test(text) &&
      text.includes("Renew passport") &&
      text.includes("Book dentist");
    return {
      evidence: passed
        ? "Notes/todo.md has the new item and the old ones"
        : `Notes/todo.md: ${JSON.stringify(text)}. Reply: ${replyText(sessions).slice(-200)}`,
      passed,
      text: "Adds the item to the person's list where it is",
    };
  },
  text: "Adds the item to the person's list where it is",
};

const SURVEY = [
  "respondent,team,score,comment",
  "1,Sales,4,Clear onboarding",
  "2,Support,2,Too many tools",
  "3,Sales,5,Great training",
  "4,Engineering,3,Docs are thin",
  "5,Support,2,Slow escalations",
  "6,Engineering,4,Good pairing",
].join("\n");

export const WORKSPACE_HYGIENE_EVALS = [
  defineEval({
    assertions: [
      keepsDependenciesOutOfTheWorkspace,
      delivers(
        "Research",
        /\.(?:png|svg|html)$/i,
        "Puts the chart beside the CSV in Research",
      ),
      recordsInstalls,
    ],
    name: "workspace-hygiene-node-chart",
    prompt:
      "In my Instrument folder, turn Research/sales.csv into a bar chart, using a small Node script with a charting package from npm. Put the chart next to the CSV.",
    setup: () => seed("Research/sales.csv", SALES),
  }),
  defineEval({
    assertions: [
      keepsDependenciesOutOfTheWorkspace,
      delivers(
        "Projects/price-watch",
        /\.py$/,
        "Sets up the script in Projects/price-watch and runs it",
        ranTheScraper,
      ),
      recordsInstalls,
    ],
    name: "workspace-hygiene-python-scraper",
    prompt:
      "In my Instrument folder, set up a Python project in Projects/price-watch that uses requests and BeautifulSoup to fetch https://example.com and print the page title. Run it once to check it works and tell me the title.",
    setup: () => seed("Projects/price-watch/README.md", "# Price watch\n"),
  }),
  defineEval({
    assertions: [
      keepsDependenciesOutOfTheWorkspace,
      delivers(
        "Web Projects/landing-demo",
        /^index\.html$/,
        "Puts the demo in Web Projects/landing-demo",
      ),
      recordsInstalls,
    ],
    name: "workspace-hygiene-vite-demo",
    prompt:
      "In my Instrument folder, make a Vite + React demo of the design in Web Projects/landing-demo/design.md, in that folder, and build it so I can open it.",
    setup: () => seed("Web Projects/landing-demo/design.md", DESIGN),
  }),
  defineEval({
    assertions: [
      keepsDependenciesOutOfTheWorkspace,
      delivers("Movies", /\.gif$/i, "Puts the GIF beside the video in Movies"),
      recordsInstalls,
    ],
    name: "workspace-hygiene-video-gif",
    prompt:
      "In my Instrument folder, convert Movies/clip.mp4 to a GIF and put it next to the video.",
    setup: seedClip,
  }),
  defineEval({
    assertions: [
      keepsDependenciesOutOfTheWorkspace,
      speedsUpTheClipInPlace,
      recordsInstalls,
    ],
    name: "workspace-hygiene-video-in-place",
    prompt:
      "In my Instrument folder, speed up Movies/clip.mp4 to twice its speed. Replace the original, I don't need it.",
    setup: seedClip,
  }),
  defineEval({
    assertions: [
      keepsDependenciesOutOfTheWorkspace,
      deliversTheChartWhereTheyLook,
    ],
    files: [
      {
        content: Buffer.from(SALES).toString("base64"),
        filename: "sales.csv",
      },
    ],
    name: "workspace-hygiene-chart-no-place",
    prompt: "Make me a bar chart of this CSV.",
  }),
  defineEval({
    assertions: [
      keepsDependenciesOutOfTheWorkspace,
      delivers(
        "Research",
        /\.(?:md|pdf|docx|html|txt)$/i,
        "Writes the report into Research",
      ),
    ],
    name: "workspace-hygiene-report-into-folder",
    prompt:
      "In my Instrument folder, write a short report on Research/survey.csv: average score per team and the main complaints. Save it into the Research folder.",
    setup: () => seed("Research/survey.csv", SURVEY),
  }),
  defineEval({
    assertions: [keepsDependenciesOutOfTheWorkspace, cleansNextToTheOriginal],
    name: "workspace-hygiene-cleaned-beside",
    prompt:
      "In my Instrument folder, clean up Data/contacts.csv: trim stray spaces and drop duplicate rows. Save the cleaned data next to the original.",
    setup: () => seed("Data/contacts.csv", CONTACTS),
  }),
  defineEval({
    assertions: [keepsDependenciesOutOfTheWorkspace, editsTheListInPlace],
    name: "workspace-hygiene-edit-in-place",
    prompt:
      "In my Instrument folder, add 'Call the plumber' to my list in Notes/todo.md.",
    setup: () => seed("Notes/todo.md", TODO),
  }),
];
