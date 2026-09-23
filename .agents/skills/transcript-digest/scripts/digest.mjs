#!/usr/bin/env node
// node digest.mjs <transcript.md> [--json] [--children]
// Turns an exported transcript into what is worth reading: where the time
// went, which calls failed or repeated, and one line per step with its line
// number, so the Markdown is read at the flagged ranges rather than end to end.
import fs from "node:fs";
import path from "node:path";

import { loadChildren } from "./children.mjs";
import { analyze, fmt, groupFlags, parseTranscript, short } from "./parse.mjs";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
if (!file) {
  console.error("usage: digest.mjs <transcript.md> [--json] [--children]");
  process.exit(2);
}
const asJson = args.includes("--json");

const main = load(file);
const children = args.includes("--children") ? loadChildren(main) : [];

if (asJson) {
  process.stdout.write(
    JSON.stringify(
      {
        ...toJson(main),
        duplicates: duplicates(file, main.p.meta.sessionId),
        children: children.map((c) => ({
          id: c.id,
          ...(c.p ? { file: c.file, ...toJson(c) } : { missing: c.missing }),
        })),
      },
      null,
      1,
    ) + "\n",
  );
} else {
  const out = [];
  const dups = duplicates(file, main.p.meta.sessionId);
  if (dups.length)
    out.push(
      `Same session also exported as: ${dups.map((d) => `${d.name} (${d.lines} lines, exported ${d.exportedAt}${d.identical ? ", identical" : ""})`).join("; ")}. This one was exported ${main.p.meta.transcriptGeneratedAt}.`,
      "",
    );
  out.push(...render(main));
  for (const c of children) {
    out.push(
      "",
      "=".repeat(78),
      `CHILD TASK ${c.id}${c.missing ? ` (not found: ${c.missing})` : `, transcript at ${c.file}`}`,
      "",
    );
    if (c.p) out.push(...render(c));
  }
  console.log(out.join("\n"));
}

function load(f) {
  const p = parseTranscript(f);
  return { p, a: analyze(p) };
}

// Other exports of the same session sitting next to this one (the -2, -3
// files a re-export leaves behind).
function duplicates(f, sessionId) {
  if (!sessionId) return [];
  const dir = path.dirname(f);
  const self = fs.readFileSync(f, "utf8");
  return fs
    .readdirSync(dir)
    .filter((n) => n.endsWith(".md") && path.join(dir, n) !== path.resolve(f))
    .flatMap((n) => {
      const text = fs.readFileSync(path.join(dir, n), "utf8");
      if (!text.slice(0, 3000).includes(`sessionId: "${sessionId}"`)) return [];
      const exportedAt =
        text.slice(0, 3000).match(/transcriptGeneratedAt: "([^"]+)"/)?.[1] ??
        "?";
      return [
        {
          name: n,
          lines: text.split("\n").length,
          exportedAt,
          identical: text === self,
        },
      ];
    });
}

function toJson({ p, a }) {
  return {
    meta: p.meta,
    buckets: a.buckets,
    byTool: a.byTool,
    flags: a.flags,
    steps: a.steps.map((e) => ({
      turn: e.turn,
      step: e.step,
      line: e.line,
      at: new Date(e.at).toISOString(),
      wall: e.wall,
      ttfc: e.ttfc,
      model: e.model,
      tools: e.tools,
      finishReason: e.meta.finishReason ?? null,
      served: e.meta.served ?? null,
      inputTokens: +e.meta.inputTokens || null,
      calls: e.calls.map((c) => ({
        n: c.n,
        name: c.name,
        explanation: c.args.explanation ?? null,
        label: short(c.label, 300),
        dur: c.dur,
        incomplete: c.incomplete,
        exit: c.result?.exit ?? null,
        error: !!c.result?.error,
        chars: c.result?.chars ?? 0,
        line: c.line,
      })),
    })),
  };
}

function render({ p, a }) {
  const m = p.meta;
  const out = [];
  const log = (s = "") => out.push(s);
  const served = [
    ...new Set(a.steps.map((s) => s.meta.served).filter(Boolean)),
  ].join(", ");
  log(
    `# ${m.taskName}  (${p.lineCount} lines, ${(m.modelsUsed ?? []).map((x) => x.modelId).join(", ")}${served ? `, served ${served}` : ""}, app ${m.currentAppVersion ?? "?"})`,
  );
  log(
    `${a.steps.length} model steps, ${m.toolCallCount} tool calls, ${m.userMessageCount} user messages. Active ${fmt(m.activeDurationMs)}, model ${fmt(m.aiGenerationDurationMs)}. ${m.usage?.inputTokens ?? "?"} input tokens (${Math.round((100 * (m.usage?.cacheReadTokens ?? 0)) / (m.usage?.inputTokens || 1))}% cache read), ${m.usage?.outputTokens ?? "?"} output.`,
  );
  log(`Task folder: ${m.taskDir}`);
  log();
  log("## Where the time went (inside turns)");
  const tot = Object.values(a.buckets).reduce((x, y) => x + y, 0) || 1;
  for (const [k, v] of Object.entries(a.buckets))
    log(
      `  ${fmt(v).padStart(7)}  ${String(Math.round((100 * v) / tot)).padStart(3)}%  ${k}`,
    );
  if (a.userWait.length)
    log(
      `  Between turns (the user): ${a.userWait.map((w) => `turn ${w.turn} after ${fmt(w.ms)}`).join(", ")}`,
    );
  log();
  log("## By tool");
  for (const [k, v] of Object.entries(a.byTool).sort(
    (x, y) => y[1].ms - x[1].ms,
  ))
    log(
      `  ${k.padEnd(16)} ${String(v.calls).padStart(3)} calls  ${fmt(v.ms).padStart(7)}  ${String(Math.round(v.chars / 1000)).padStart(4)}k chars back${v.fails ? `  ${v.fails} failed` : ""}`,
    );
  log();
  log(`## Flags (${a.flags.length})`);
  if (!a.flags.length) log("  none");
  for (const g of groupFlags(a.flags))
    log(
      g.count > 1
        ? `  [${g.sev}] ${g.count}x ${g.kind}, lines ${g.lines.slice(0, 12).join(", ")}${g.count > 12 ? ", …" : ""}. First: ${g.first}`
        : `  [${g.sev}] L${g.lines[0]}  ${g.first}`,
    );
  log();
  log("## Steps  (L = line in the transcript; wall = until the next step)");
  for (const e of a.timeline) {
    if (e.kind === "user") {
      log(
        `L${e.line}  USER turn ${e.turn} @ ${new Date(e.at).toISOString().slice(11, 19)}: ${short(e.say, 140)}`,
      );
      continue;
    }
    log(
      `L${e.line}  ${e.turn}.${e.step}  wall ${fmt(e.wall)}  ttfc ${fmt(e.ttfc)}  in ${e.meta.inputTokens ?? "?"}  ${e.meta.finishReason ?? ""}`,
    );
    if (e.say) log(`        says: ${short(e.say, 160)}`);
    for (const c of e.calls) {
      const r = c.result;
      const st = c.incomplete
        ? `INCOMPLETE ${c.incomplete}`
        : r?.error || (r?.exit ?? 0) !== 0
          ? `FAIL${r?.exit != null ? " " + r.exit : ""}`
          : "ok";
      log(
        `        #${c.n} ${c.name} ${fmt(c.dur)} ${st} ${Math.round((r?.chars ?? 0) / 1000)}k: ${short(c.label, 130)}`,
      );
    }
  }
  return out;
}
