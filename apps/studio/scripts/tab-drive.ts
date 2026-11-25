// Random sequences of tab commands, played through the menus of a running
// app, checked against what the window shows after each step. The model test
// (tab-sequences.test.ts) finds mistakes in how tabs move in thousands of
// sequences a second; this finds the ones it cannot see, in the code between
// that model and the screen, at about a step a second.
//
//   pnpm --filter @instrument-org/studio tabs:drive [--seconds 120] [--seed 1]
//   pnpm --filter @instrument-org/studio tabs:drive --replay split,next,closeReopen
//
// Boots its own instance on the `documents` fixture (studio-drive), serves the
// pages it opens from 127.0.0.1, and stops the instance when it ends.

import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";

const STUDIO = path.resolve(import.meta.dirname, "..");
const DRIVE = path.resolve(
  STUDIO,
  "../../.agents/skills/studio-chrome-devtools/scripts/studio-drive.mjs",
);
const WORKSPACE = ["--workspace", "documents"];

/** Rules a running window can break that the model has no picture of. */
export const APP_RULES = {
  closeSplitKeepsOther:
    "Close Split closes the side with the keyboard and leaves the other as it was",
  focusSide:
    "Focus Left Side and Focus Right Side move the keyboard and nothing else",
  groupAndBack:
    "Next Tab Group then Previous Tab Group leaves the group as it was",
  noErrors: "The page throws nothing",
  panesShowUp: "Each side's pane shows the tab that is up there",
  splitOpens: "New Tab in Split opens a second side with the new tab up",
  stripShowsTabs:
    "Each strip shows its side's tabs in order, the one up selected",
} as const;

/** The model's rules by name, read from tab-sequences.ts, which this script cannot import. */
export function modelRules(): Record<string, string> {
  const source = fs.readFileSync(
    path.join(STUDIO, "src/client/components/window/tab-sequences.ts"),
    "utf8",
  );
  const block =
    /export const RULES = \{([\s\S]*?)\n\} as const/.exec(source)?.[1] ?? "";
  const rules: Record<string, string> = {};
  for (const [, key, text] of block.matchAll(/^\s+(\w+): "([^"]*)",$/gm)) {
    if (key !== undefined && text !== undefined) {
      rules[key] = text;
    }
  }
  return rules;
}

const FindingSchema = z.object({
  bad: z.array(z.object({ detail: z.string(), rule: z.string() })),
  names: z.array(z.string()),
  repeats: z.boolean().optional(),
  seed: z.number().optional(),
  story: z.array(z.string()),
});
const RunSchema = z.object({
  error: z.string().optional(),
  value: z
    .object({
      found: z.record(z.string(), FindingSchema),
      seconds: z.number(),
      sequences: z.number(),
      steps: z.number(),
    })
    .optional(),
});

/**
 * One studio-drive command. Its output goes through files and it is done when
 * it exits: `boot` leaves the app it started holding whatever pipes it had,
 * so waiting for those to close would wait for the app.
 */
function drive(args: string[], timeoutMs = 300_000) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tab-drive-"));
  const out = path.join(dir, "out");
  const err = path.join(dir, "err");
  const child = spawn(process.execPath, [DRIVE, ...args], {
    cwd: STUDIO,
    stdio: ["ignore", fs.openSync(out, "w"), fs.openSync(err, "w")],
  });
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`studio-drive ${args[0] ?? ""} took over ${String(timeoutMs / 1000)}s`));
    }, timeoutMs);
    child.on("error", reject);
    child.on("exit", (code) => {
      clearTimeout(timer);
      const stdout = fs.readFileSync(out, "utf8");
      const stderr = fs.readFileSync(err, "utf8");
      fs.rmSync(dir, { force: true, recursive: true });
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`studio-drive ${args[0] ?? ""} failed: ${stderr || stdout}`));
      }
    });
  });
}

/** A page with nothing on it, at a new address for each `?x=`. */
function servePages() {
  const server = http.createServer((_, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end("<!doctype html><title>Page</title><p>Page</p>");
  });
  return new Promise<{ close: () => void; url: string }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({
        close: () => server.close(),
        url: `127.0.0.1:${String(port)}/page.html`,
      });
    });
  });
}

async function main() {
  const { values } = parseArgs({
    options: {
      inspect: { default: "9338", type: "string" },
      replay: { type: "string" },
      seconds: { default: "120", type: "string" },
      seed: { default: "1", type: "string" },
    },
  });
  const rules: Record<string, string> = { ...modelRules(), ...APP_RULES };
  const pages = await servePages();
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "tab-drive-"));
  const argsFile = path.join(scratch, "args.json");
  const progress = path.join(scratch, "progress.log");
  fs.writeFileSync(
    argsFile,
    JSON.stringify({
      inspect: values.inspect,
      progress,
      replay: values.replay?.split(","),
      seconds: Number(values.seconds),
      seed: Number(values.seed),
      site: pages.url,
    }),
  );
  try {
    console.error("Booting an instance on the documents fixture…");
    await drive([
      "boot",
      "--purpose",
      "tab driver",
      ...WORKSPACE,
      "--inspect",
      values.inspect,
    ]);
    console.error(
      values.replay
        ? `Replaying ${values.replay}…`
        : `Playing sequences for ${values.seconds}s from seed ${values.seed}…`,
    );
    const run = RunSchema.parse(
      JSON.parse(
        await drive([
          "run",
          path.join(STUDIO, "scripts/tab-drive-run.ts"),
          ...WORKSPACE,
          "--args",
          `@${argsFile}`,
        ], (Number(values.seconds) + 240) * 1000).catch((error: unknown) => {
          const steps = fs.existsSync(progress)
            ? fs.readFileSync(progress, "utf8").trim().split("\n").slice(-5)
            : [];
          throw new Error(
            `${error instanceof Error ? error.message : String(error)}\nlast steps:\n${steps.join("\n")}`,
          );
        }),
      ),
    );
    if (!run.value) {
      throw new Error(`the run stopped: ${run.error ?? "no result"}`);
    }
    const { found, seconds, sequences, steps } = run.value;
    console.log(
      `${String(sequences)} sequences, ${String(steps)} steps, ${String(seconds)}s`,
    );
    for (const [rule, finding] of Object.entries(found)) {
      console.log(
        `\nBROKE "${rules[rule] ?? rule}"${finding.repeats === false ? " (did not repeat)" : ""}`,
      );
      for (const line of finding.story) {
        console.log(`  ${line}`);
      }
      for (const { detail } of finding.bad) {
        console.log(`  ${detail}`);
      }
      console.log(
        `  replay: pnpm --filter @instrument-org/studio tabs:drive --replay ${finding.names.join(",")}${finding.seed === undefined ? "" : `  (seed ${String(finding.seed)})`}`,
      );
    }
    process.exitCode = Object.keys(found).length > 0 ? 1 : 0;
  } finally {
    pages.close();
    await drive(["stop", ...WORKSPACE]).catch((error: unknown) => {
      console.error(error);
    });
  }
}

if (import.meta.main) {
  await main();
}
