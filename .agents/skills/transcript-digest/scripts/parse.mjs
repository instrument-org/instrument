// Parses an Instrument transcript export (Markdown) into a timeline of
// user turns, model steps, tool calls and results, then derives timing
// buckets and flags. Works from the file alone; no task folder needed.
import fs from "node:fs";

const ms = (s) => (s.endsWith("ms") ? parseFloat(s) : parseFloat(s) * 1000);
const t = (s) => Date.parse(s);

export function parseTranscript(file) {
  const text = fs.readFileSync(file, "utf8");
  const lines = text.split("\n");
  const meta = {};
  let i = 0;
  if (lines[0] === "---") {
    for (i = 1; lines[i] !== "---"; i++) {
      const m = lines[i].match(/^(\w+): (.*)$/);
      if (m) {
        try {
          meta[m[1]] = JSON.parse(m[2]);
        } catch {
          meta[m[1]] = m[2];
        }
      }
    }
  }
  const events = [];
  let cur = null; // the event whose body lines we are collecting
  let fence = null; // open fence marker inside a body, so embedded headings are ignored
  const push = (e) => {
    events.push(e);
    cur = e;
    e.body = [];
  };
  for (; i < lines.length; i++) {
    const l = lines[i];
    if (fence) {
      if (l.startsWith(fence) && l.trim() === fence) fence = null;
      cur?.body.push(l);
      continue;
    }
    const f = l.match(/^(`{3,}|~{3,})/);
    if (f) {
      fence = f[1];
      cur?.body.push(l);
      continue;
    }
    let m;
    if ((m = l.match(/^## User \(Turn (\d+)\) @ (\S+)/))) {
      push({ kind: "user", turn: +m[1], at: t(m[2]), line: i + 1 });
    } else if (
      (m = l.match(
        /^## Assistant \(User Turn (\d+)(?:, Step (\d+))?\) @ (\S+)/,
      ))
    ) {
      // Exports before steps were numbered write only the turn.
      const prev = events.findLast(
        (e) => e.kind === "step" && e.turn === +m[1],
      );
      push({
        kind: "step",
        turn: +m[1],
        step: m[2] ? +m[2] : (prev?.step ?? 0) + 1,
        at: t(m[3]),
        line: i + 1,
        calls: [],
      });
    } else if (
      (m = l.match(
        /^### Tool Call (\d+): (\S+)( \*\(incomplete: ([^)]*)\)\*)? @ (\S+)(?: \+(\S+))?/,
      ))
    ) {
      const step = [...events].reverse().find((e) => e.kind === "step");
      const call = {
        kind: "call",
        n: +m[1],
        name: m[2],
        incomplete: m[4] ?? null,
        at: t(m[5]),
        dur: m[6] ? ms(m[6]) : null,
        line: i + 1,
        step,
      };
      step?.calls.push(call);
      push(call);
    } else if ((m = l.match(/^### Tool Result (\d+): (\S+)/))) {
      const call = events.findLast((e) => e.kind === "call" && e.n === +m[1]);
      const r = { kind: "result", n: +m[1], name: m[2], line: i + 1, call };
      if (call) call.result = r;
      push(r);
    } else if (l.startsWith("## ") && !events.some((e) => e.kind === "user")) {
      cur = null; // a section before the conversation (context snapshot, etc.)
    } else {
      cur?.body.push(l);
    }
  }

  for (const e of events) {
    const body = e.body.join("\n");
    if (e.kind === "step") {
      const md = body.match(/^\*Response metadata: (.*)\*$/m);
      e.meta = {};
      if (md)
        for (const kv of md[1].split(", ")) {
          const [k, ...v] = kv.split("=");
          e.meta[k] = v.join("=");
        }
      e.ttfc = e.meta.timeToFirstChunk ? ms(e.meta.timeToFirstChunk) : null;
      e.gen = e.meta.generationDuration ? ms(e.meta.generationDuration) : null;
      e.say = body
        .replace(/^\*Response metadata.*$/m, "")
        .replace(/```[\s\S]*?```/g, "")
        .trim();
    } else if (e.kind === "call") {
      e.args = {};
      for (const m of body.matchAll(/^- \*\*(\w+):\*\* `(.*)`$/gm))
        e.args[m[1]] = m[2];
      for (const m of body.matchAll(
        /^\*\*(\w+)\*\*\n\n(`{3,})\w*\n([\s\S]*?)\n\2$/gm,
      ))
        e.args[m[1]] = m[3];
      // 1.x exports wrap arguments in <tool><arg>…</arg></tool>
      const xml = body.match(/^<(\w+)>\n([\s\S]*?)\n<\/\1>$/m);
      if (xml)
        for (const m of xml[2].matchAll(/<(\w+)>([\s\S]*?)<\/\1>/g))
          e.args[m[1]] ??= m[2];
      e.label =
        e.args.command ??
        e.args.path ??
        e.args.filePath ??
        e.args.file_path ??
        e.args.url ??
        e.args.name ??
        e.args.title ??
        e.args.explanation ??
        Object.values(e.args)[0] ??
        "";
    } else if (e.kind === "result") {
      e.chars = body.length;
      e.error = /^> \*\*Error:\*\*/m.test(body);
      const ex = body.match(/Exit code: (\d+)/);
      e.exit = ex ? +ex[1] : null;
      e.truncated = /\[Output truncated/.test(body);
      e.head = body
        .replace(/^`+\w*$/gm, "")
        .replace(/^> ?/gm, "")
        .replace(/Exit code: \d+\s*Command output:\s*/, "")
        .trim()
        .slice(0, 300);
    } else if (e.kind === "user") {
      e.raw = body;
      e.say = body
        .replace(/^`+\w*$/gm, "")
        .replace(/<\/?user_message>/g, "")
        .trim();
    }
  }
  return { file, meta, events, lineCount: lines.length };
}

const fmt = (x) =>
  x == null
    ? "?"
    : x < 1000
      ? `${Math.round(x)}ms`
      : x < 60000
        ? `${(x / 1000).toFixed(1)}s`
        : `${Math.floor(Math.round(x / 1000) / 60)}m${String(Math.round(x / 1000) % 60).padStart(2, "0")}s`;
export { fmt };

// Timing for each step: model time, tool time, and what is left before the
// next event. Left-over time after the last step of a turn is the user's.
export function analyze(p) {
  const { events, meta } = p;
  const timeline = events.filter((e) => e.kind === "user" || e.kind === "step");
  const end = t(meta.transcriptGeneratedAt ?? "") || null;
  const flags = [];
  const flag = (kind, sev, e, msg) =>
    flags.push({ kind, sev, line: e.line, at: e.at, msg });
  const seen = new Map();

  for (let k = 0; k < timeline.length; k++) {
    const e = timeline[k];
    const next = timeline[k + 1];
    if (e.kind !== "step") continue;
    const genEnd = e.at + (e.gen ?? 0);
    const toolEnd = Math.max(
      genEnd,
      ...e.calls.map((c) => (c.dur != null ? c.at + c.dur : c.at)),
    );
    e.lastEnd = toolEnd;
    e.nextAt = next?.at ?? null;
    e.wall = next?.kind === "step" ? next.at - e.at : toolEnd - e.at;
    // Split the wall clock without double counting: model first, then tool
    // time past the end of generation, then whatever is left.
    e.model = Math.min(e.gen ?? 0, e.wall);
    e.tools = Math.max(0, Math.min(toolEnd, e.at + e.wall) - genEnd);
    e.gap = Math.max(0, e.wall - e.model - e.tools);
    e.endsTurn = !next || next.kind === "user";

    if (e.ttfc != null && e.ttfc > 10000)
      flag(
        "slow-model",
        "warn",
        e,
        `Model took ${fmt(e.ttfc)} to start answering (step ${e.turn}.${e.step}, ${e.meta.inputTokens} input tokens)`,
      );
    const fr = e.meta.finishReason;
    if (fr && !["tool-calls", "stop"].includes(fr))
      flag(
        "finish",
        "bad",
        e,
        `Step ${e.turn}.${e.step} ended with finishReason=${fr}`,
      );
    if (!e.endsTurn && e.gap > 30000)
      flag(
        "gap",
        "warn",
        e,
        `${fmt(e.gap)} of nothing between step ${e.turn}.${e.step} and the next step`,
      );
    for (const c of e.calls) {
      const r = c.result;
      if (c.incomplete)
        flag(
          "incomplete",
          "bad",
          c,
          `Tool call ${c.n} (${c.name}) never finished: ${c.incomplete}`,
        );
      if (r?.error || (r?.exit != null && r.exit !== 0))
        flag(
          "error",
          "bad",
          c,
          `Tool call ${c.n} (${c.name}) failed${r.exit != null ? ` with exit ${r.exit}` : ""}: ${short(c.label)}`,
        );
      if (c.dur != null && c.dur > 20000)
        flag(
          "slow-tool",
          "warn",
          c,
          `Tool call ${c.n} (${c.name}) ran ${fmt(c.dur)}: ${short(c.label)}`,
        );
      if (r && r.chars > 25000)
        flag(
          "big-result",
          "info",
          c,
          `Tool call ${c.n} returned ${Math.round(r.chars / 1000)}k chars into context: ${short(c.label)}`,
        );
      if (r?.truncated)
        flag("truncated", "info", c, `Tool call ${c.n} output was truncated`);
      const key =
        c.name +
        "\u0000" +
        JSON.stringify({ ...c.args, explanation: undefined });
      if (!Object.keys(c.args).length) continue;
      if (seen.has(key))
        flag(
          "repeat",
          "warn",
          c,
          `Tool call ${c.n} repeats call ${seen.get(key)} exactly: ${short(c.label)}`,
        );
      else seen.set(key, c.n);
    }
  }
  const last = timeline.at(-1);
  if (last?.kind === "step" && end) {
    const open = last.calls.find((c) => c.incomplete);
    const lastEnd = last.at + last.wall;
    if (open)
      flag(
        "ended-open",
        "bad",
        last,
        `Session stopped mid-call (${open.name}); nothing happened for ${fmt(end - lastEnd)} before the export`,
      );
  }
  if (last?.kind === "user")
    flag(
      "unanswered",
      "bad",
      last,
      `Last user message (turn ${last.turn}) never got an answer`,
    );

  const steps = timeline.filter((e) => e.kind === "step");
  const sum = (f) => steps.reduce((s, e) => s + f(e), 0);
  const ttfc = sum((e) => e.ttfc ?? 0);
  const buckets = {
    "model waiting (time to first token)": ttfc,
    "model writing": sum((e) => e.model) - ttfc,
    tools: sum((e) => e.tools),
    "unaccounted (harness, waits)": sum((e) => (e.endsTurn ? 0 : e.gap)),
  };
  // Per tool name
  const byTool = {};
  for (const s of steps)
    for (const c of s.calls) {
      const b = (byTool[c.name] ??= { calls: 0, ms: 0, chars: 0, fails: 0 });
      b.calls++;
      b.ms += c.dur ?? 0;
      b.chars += c.result?.chars ?? 0;
      if (c.result?.error || (c.result?.exit ?? 0) !== 0) b.fails++;
    }
  const userWait = timeline
    .filter((e, k) => e.kind === "user" && k > 0)
    .map((u) => {
      const prev = timeline[timeline.indexOf(u) - 1];
      return {
        turn: u.turn,
        ms: Math.max(0, u.at - (prev.lastEnd ?? prev.at)),
      };
    });
  const sevRank = { bad: 0, warn: 1, info: 2 };
  flags.sort((a, b) => sevRank[a.sev] - sevRank[b.sev] || a.line - b.line);
  return { steps, timeline, flags, buckets, byTool, userWait, end };
}

function short(s, n = 90) {
  s = String(s ?? "").replace(/\s+/g, " ");
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
export { short };

// Flags of one kind collapse into a single entry once there are more than
// three of them, so a run that trips the same wire 60 times reads as one line.
export function groupFlags(flags) {
  const byKind = new Map();
  for (const f of flags) byKind.set(f.kind, [...(byKind.get(f.kind) ?? []), f]);
  const out = [];
  for (const [kind, fs] of byKind) {
    if (fs.length > 3)
      out.push({
        kind,
        sev: fs[0].sev,
        count: fs.length,
        lines: fs.map((f) => f.line),
        first: fs[0].msg,
      });
    else
      for (const f of fs)
        out.push({ kind, sev: f.sev, count: 1, lines: [f.line], first: f.msg });
  }
  const rank = { bad: 0, warn: 1, info: 2 };
  return out.sort(
    (a, b) => rank[a.sev] - rank[b.sev] || a.lines[0] - b.lines[0],
  );
}
