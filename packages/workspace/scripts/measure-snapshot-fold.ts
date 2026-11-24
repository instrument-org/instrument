/**
 * Runs the closed-select fold
 * (`src/lib/shell-commands/agent-browser-snapshot-fold.ts`) over the page
 * snapshots recorded sessions carry, read-only, and reports what it saves and
 * where it would have taken away a ref the model went on to use.
 *
 *   pnpm --filter @instrument-org/workspace script:measure-snapshot-fold <dir>... [--out <dir>]
 *
 * Each `<dir>` is searched for `*.jsonl` logs and reported on its own, then
 * all together. Every `bash` call's follow-up (`output.pageAfter`) of kind
 * `full` is a sample, as recorded: already cut to the follow-up's character
 * budget, so a page past the budget shows less saving here than the fold
 * gives it before the cut. `--out` writes each sample the fold changes, as
 * recorded and as folded.
 */
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { z } from "zod";

import {
  foldClosedSelects,
  parseSnapshot,
  renderSnapshot,
  type SnapshotNode,
} from "../src/lib/shell-commands/agent-browser-snapshot-fold";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { out: { type: "string" } },
});
if (positionals.length === 0) {
  throw new Error("Usage: measure-snapshot-fold <dir>... [--out <dir>]");
}

const CallSchema = z.object({
  input: z.object({ command: z.string() }),
  output: z
    .object({
      pageAfter: z
        .object({
          kind: z.string(),
          omittedLines: z.number().optional(),
          text: z.string(),
          url: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
  toolCallId: z.string(),
  type: z.literal("tool-bash"),
});
type Call = z.output<typeof CallSchema>;

function* logs(dir: string): Generator<string> {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const at = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!["attachments", "blobs", "node_modules"].includes(entry.name)) {
        yield* logs(at);
      }
    } else if (entry.name.endsWith(".jsonl")) {
      yield at;
    }
  }
}

function callsIn(value: unknown, found: Call[]) {
  if (Array.isArray(value)) {
    for (const item of value) {
      callsIn(item, found);
    }
    return;
  }
  if (typeof value !== "object" || value === null) {
    return;
  }
  const call = CallSchema.safeParse(value);
  if (call.success) {
    found.push(call.data);
    return;
  }
  for (const inner of Object.values(value)) {
    callsIn(inner, found);
  }
}

/** A log's bash calls in order, each as its last record. */
function callsOf(file: string): Call[] {
  const text = fs.readFileSync(file, "utf8");
  if (!text.includes("agent-browser")) {
    return [];
  }
  const last = new Map<string, Call>();
  for (const line of text.split("\n")) {
    if (!line.includes("tool-bash")) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const found: Call[] = [];
    callsIn(parsed, found);
    for (const call of found) {
      last.set(call.toolCallId, call);
    }
  }
  return [...last.values()];
}

const refsUsed = (command: string) =>
  [...command.matchAll(/@(e\d+)\b/g)].map((match) => match[1] ?? "");
const hasRef = (text: string, ref: string) =>
  new RegExp(`\\bref=${ref}\\b`).test(text);
const host = (url: string | undefined) => {
  try {
    return url === undefined ? "(no address)" : new URL(url).host;
  } catch {
    return "(no address)";
  }
};

function walk(
  nodes: readonly SnapshotNode[],
  visit: (n: SnapshotNode) => void,
) {
  for (const node of nodes) {
    visit(node);
    walk(node.children, visit);
  }
}

const tally = () => ({
  /** Full follow-ups cut to the character budget when recorded. */
  capped: 0,
  /** Full follow-ups the fold changes. */
  changed: 0,
  charsAfter: 0,
  charsBefore: 0,
  /** Characters of every follow-up of any kind, the fold's share of which is `saved`. */
  charsOfAllFollowUps: 0,
  followUps: 0,
  full: 0,
  /** Closed comboboxes with options the fold leaves, by why. */
  leftClosed: 0,
  logsWithFollowUps: 0,
  /** Full follow-ups with a ref the next two calls used. */
  nextUsedARef: 0,
  /** Full follow-ups that do not read as a tree, left as recorded. */
  unparsed: 0,
});
type Tally = ReturnType<typeof tally>;

const total = tally();
const perRoot: Record<string, Tally> = {};
const perHost: Record<
  string,
  { after: number; before: number; changed: number; full: number }
> = {};
const folds: { options: number; sample: string; saved: number }[] = [];
const hidden: { command: string; line: string; ref: string; sample: string }[] =
  [];
const unparsed: { line: string; sample: string }[] = [];

for (const root of positionals) {
  const own = tally();
  perRoot[root] = own;
  const add = (key: keyof Tally, amount = 1) => {
    own[key] += amount;
    total[key] += amount;
  };
  for (const file of logs(root)) {
    const calls = callsOf(file);
    if (!calls.some((call) => call.output?.pageAfter)) {
      continue;
    }
    add("logsWithFollowUps");
    const log = path.relative(root, file).replaceAll(path.sep, "__");
    for (const [index, call] of calls.entries()) {
      const page = call.output?.pageAfter;
      if (!page) {
        continue;
      }
      add("followUps");
      add("charsOfAllFollowUps", page.text.length);
      if (page.kind !== "full") {
        continue;
      }
      add("full");
      if (page.omittedLines !== undefined) {
        add("capped");
      }
      const sample = `${log}#${index}`;
      const site = (perHost[host(page.url)] ??= {
        after: 0,
        before: 0,
        changed: 0,
        full: 0,
      });
      site.full += 1;
      site.before += page.text.length;
      add("charsBefore", page.text.length);
      const tree = parseSnapshot(page.text);
      if (!tree) {
        add("unparsed");
        add("charsAfter", page.text.length);
        site.after += page.text.length;
        const bad = page.text
          .split("\n")
          .find((line) => parseSnapshot(line.trimStart()) === undefined);
        unparsed.push({ line: (bad ?? "(nesting)").slice(0, 120), sample });
        continue;
      }
      walk(tree, (node) => {
        const [folded] = foldClosedSelects([node]);
        if (folded?.children[0]?.role === "") {
          folds.push({
            options: node.children.length,
            sample,
            saved:
              renderSnapshot([node]).length - renderSnapshot([folded]).length,
          });
        } else if (
          node.role === "combobox" &&
          node.attrs.includes("expanded=false") &&
          node.children.some((child) => child.role === "option")
        ) {
          add("leftClosed");
        }
      });
      const after = renderSnapshot(foldClosedSelects(tree));
      add("charsAfter", after.length);
      site.after += after.length;
      if (after !== page.text) {
        add("changed");
        site.changed += 1;
        if (values.out) {
          fs.mkdirSync(values.out, { recursive: true });
          fs.writeFileSync(
            path.join(values.out, `${sample}.before.txt`),
            `${page.text}\n`,
          );
          fs.writeFileSync(
            path.join(values.out, `${sample}.after.txt`),
            `${after}\n`,
          );
        }
      }
      const next = calls
        .slice(index + 1, index + 3)
        .flatMap(({ input }) =>
          refsUsed(input.command).map((ref) => ({
            command: input.command,
            ref,
          })),
        )
        .filter(({ ref }) => hasRef(page.text, ref));
      if (next.length > 0) {
        add("nextUsedARef");
      }
      for (const { command, ref } of next) {
        if (!hasRef(after, ref)) {
          const line = page.text.split("\n").find((l) => hasRef(l, ref)) ?? "";
          hidden.push({
            command: command.slice(0, 200),
            line: line.trim(),
            ref,
            sample,
          });
        }
      }
    }
  }
}

const saved = (before: number, after: number) =>
  before === 0 ? "0%" : `${(((before - after) / before) * 100).toFixed(1)}%`;

console.log(
  JSON.stringify(
    {
      total: {
        ...total,
        saved: saved(total.charsBefore, total.charsAfter),
        savedOfAllFollowUps: saved(
          total.charsOfAllFollowUps,
          total.charsOfAllFollowUps - (total.charsBefore - total.charsAfter),
        ),
      },
      perRoot: Object.fromEntries(
        Object.entries(perRoot).map(([root, own]) => [
          root,
          { ...own, saved: saved(own.charsBefore, own.charsAfter) },
        ]),
      ),
      perHost: Object.fromEntries(
        Object.entries(perHost)
          .toSorted(([, a], [, b]) => b.before - b.after - (a.before - a.after))
          .map(([name, site]) => [
            name,
            { ...site, saved: saved(site.before, site.after) },
          ]),
      ),
      folds: folds.toSorted((a, b) => b.saved - a.saved),
      hidden,
      unparsed,
    },
    undefined,
    2,
  ),
);
