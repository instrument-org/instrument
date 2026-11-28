// Whether the agent's own account of the app still matches the app: questions
// people ask about where something is and how to do it, each with the answer
// read off the code. The monitored-release skill runs it.
//
//   node scripts/ui-truth.ts check --since <ref>
//   node scripts/ui-truth.ts ask --out <file> [--guide-from <ref>] [--only 3,12]
//
// `check` reads the answer key against the code. Each answer names the text it
// was read off, and one whose text is gone is out of date (exit 1). One whose
// files changed since the ref is listed to be read again.
//
// `ask` puts each question to a model that has the product guide and nothing
// else, one at a time, and writes a sheet with the key's answer beside each
// reply, to be graded by whoever reads it. `--guide-from` takes the guide from
// another commit, which says whether a wrong reply is new.
import { execFile, execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs, promisify } from "node:util";

const ROOT = path.resolve(import.meta.dirname, "..");
const QUESTIONS = ".agents/skills/monitored-release/ui-truth/questions.json";
const GUIDE = "packages/workspace/system-skills/instrument-guide";

/** A small model, which answers from what it is given more than from what it can guess. */
const MODEL = "claude-haiku-5-5";
const ANSWER_TIMEOUT_MS = 90_000;

export interface Question {
  answer: string;
  id: number;
  question: string;
  /** Text the answer was read off, which has to still be in its file. */
  readOff: { file: string; text: string }[];
}

/** The questions whose answer names text its file no longer has. */
export function outOfDate(
  questions: Question[],
  read: (file: string) => string | undefined,
): { id: number; missing: string }[] {
  return questions.flatMap(({ id, readOff }) =>
    readOff.flatMap(({ file, text }) => {
      const source = read(file);
      if (source === undefined) {
        return [{ id, missing: `${file} is gone` }];
      }
      return source.includes(text)
        ? []
        : [{ id, missing: `${file} has no ${JSON.stringify(text)}` }];
    }),
  );
}

/** The questions answered from a file that changed, with the files that did. */
export function toReread(
  questions: Question[],
  changed: ReadonlySet<string>,
): { files: string[]; id: number }[] {
  return questions.flatMap(({ id, readOff }) => {
    const files = [...new Set(readOff.map(({ file }) => file))].filter((file) =>
      changed.has(file),
    );
    return files.length > 0 ? [{ files, id }] : [];
  });
}

export function loadQuestions(): Question[] {
  // The file is this repo's own, and the test reads every field of it.
  return JSON.parse(
    readFileSync(path.join(ROOT, QUESTIONS), "utf8"),
  ) as Question[];
}

/** The guide as a commit has it, or as it is on disk. */
function guide(ref: string | undefined): string {
  return ["SKILL.md", "reference.md", "places.md"]
    .map((name) =>
      ref === undefined
        ? readFileSync(path.join(ROOT, GUIDE, name), "utf8")
        : execFileSync("git", ["show", `${ref}:${GUIDE}/${name}`], {
            cwd: ROOT,
            encoding: "utf8",
          }),
    )
    .join("\n\n");
}

async function check(since: string): Promise<number> {
  const questions = loadQuestions();
  const { stdout } = await promisify(execFile)(
    "git",
    ["diff", "--name-only", since],
    { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 },
  );
  const stale = outOfDate(questions, (file) => {
    try {
      return readFileSync(path.join(ROOT, file), "utf8");
    } catch {
      return undefined;
    }
  });
  const reread = toReread(questions, new Set(stdout.split("\n")));
  const asked = new Map(questions.map((each) => [each.id, each.question]));
  console.log(`${stale.length} out of date:`);
  for (const { id, missing } of stale) {
    console.log(`  ${String(id)}. ${asked.get(id) ?? ""}\n     ${missing}`);
  }
  console.log(`${reread.length} answered from files changed since ${since}:`);
  for (const { files, id } of reread) {
    console.log(`  ${String(id)}. ${asked.get(id) ?? ""}`);
    for (const file of files) {
      console.log(`     ${file}`);
    }
  }
  return stale.length > 0 ? 1 : 0;
}

/** One question, answered from the guide alone. */
function ask(question: string, systemPromptFile: string, cwd: string) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(
      "claude",
      [
        "-p",
        "--model",
        MODEL,
        "--setting-sources",
        "",
        "--strict-mcp-config",
        "--disable-slash-commands",
        "--tools",
        "",
        "--system-prompt-file",
        systemPromptFile,
      ],
      { cwd, stdio: ["pipe", "pipe", "pipe"], timeout: ANSWER_TIMEOUT_MS },
    );
    let out = "";
    let err = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      out += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      err += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0 && out.trim() !== "") {
        resolve(out.trim());
      } else {
        reject(new Error(err.trim() || `claude exited with ${String(code)}`));
      }
    });
    child.stdin.end(question);
  });
}

async function askAll(options: {
  guideFrom: string | undefined;
  only: Set<number> | undefined;
  out: string;
}): Promise<number> {
  const questions = loadQuestions().filter(
    ({ id }) => options.only?.has(id) ?? true,
  );
  const dir = mkdtempSync(path.join(os.tmpdir(), "ui-truth-"));
  const prompt = path.join(dir, "prompt.md");
  const sheet = [
    `# What the guide has the agent say${options.guideFrom ? `, as of ${options.guideFrom}` : ""}`,
  ];
  let failed = 0;
  try {
    writeFileSync(
      prompt,
      `You are Instrument, a desktop app's own agent, answering a person who is using the app on a Mac. Answer in a few sentences from the guide below. Say so when it doesn't say.\n\n${guide(options.guideFrom)}`,
    );
    for (const { answer, id, question } of questions) {
      const reply = await ask(question, prompt, dir).catch((error: unknown) => {
        failed += 1;
        return `NOT ASKED: ${String(error)}`;
      });
      sheet.push(
        `## ${id}. ${question}`,
        `**Key:** ${answer}`,
        `**Reply:** ${reply}`,
      );
      writeFileSync(options.out, `${sheet.join("\n\n")}\n`);
    }
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
  console.log(
    `${questions.length - failed} of ${questions.length} answered, in ${options.out}`,
  );
  return failed > 0 ? 1 : 0;
}

async function main(): Promise<number> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      "guide-from": { type: "string" },
      only: { type: "string" },
      out: { type: "string" },
      since: { type: "string" },
    },
  });
  if (positionals[0] === "check" && values.since) {
    return check(values.since);
  }
  if (positionals[0] === "ask" && values.out) {
    return askAll({
      guideFrom: values["guide-from"],
      only: values.only
        ? new Set(values.only.split(",").map(Number))
        : undefined,
      out: path.resolve(values.out),
    });
  }
  console.error(
    "usage: ui-truth.ts check --since <ref> | ask --out <file> [--guide-from <ref>] [--only <ids>]",
  );
  return 2;
}

if (import.meta.main) {
  process.exitCode = await main();
}
