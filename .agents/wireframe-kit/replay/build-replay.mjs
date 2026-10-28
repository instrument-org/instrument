// node build-replay.mjs <records-dir> <out.html> --design <part.js> --title "Chat replay: ..." [--chat "..."] [--at seconds] [--line "..."] [--source "..."]
// Builds a replay: one chat's records played back as a prototype, drawn with the pieces of a design part, with a
// scrubber under it. <records-dir> holds the chat's ses_*.jsonl logs, its tasks' included: a chat's folder under
// .instrument/chats/<id>/, which an eval keeps in its run's workspace. --design is the wireframe part whose design
// the replay draws with; the replay takes everything above its "// ---- the scenario" line (or its META), so the
// part's own scenario stays out. --chat is the chat's title in the window, --at the second the replay opens on.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { recordsToTimeline } from "./records-to-timeline.mjs";

const here = path.dirname(new URL(import.meta.url).pathname);
const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    design: { type: "string" },
    title: { type: "string" },
    chat: { type: "string" },
    at: { type: "string" },
    line: { type: "string" },
    source: { type: "string" },
  },
});
const [recordsDir, outPath] = positionals;
if (!recordsDir || !outPath || !values.design || !values.title)
  throw new Error('usage: node build-replay.mjs <records-dir> <out.html> --design <part.js> --title "Chat replay: ..."');

const tl = recordsToTimeline(recordsDir);
const design = fs.readFileSync(values.design, "utf8");
const cutAt = [design.indexOf("// ---- the scenario"), design.search(/^const META\s*=/m)].find((i) => i >= 0);
if (cutAt === undefined) throw new Error(`${values.design} has no "// ---- the scenario" line or META to end its pieces at`);
const replay = {
  title: values.title,
  chat: values.chat ?? values.title,
  at: Number(values.at ?? 0),
  line: values.line ?? "A chat played back from its records at the real pace, drawn in this design.",
  source: values.source ?? `Played back from the records of chat ${path.basename(path.resolve(recordsDir))}; every message, step, task and time is the record's, and the list's other chats are the kit's.`,
};
const part = [
  design.slice(0, cutAt),
  "// ---- the replay data",
  `const TL = ${JSON.stringify(tl)};`,
  `const REPLAY = ${JSON.stringify(replay)};`,
  fs.readFileSync(path.join(here, "replay.js"), "utf8"),
].join("\n");
const partPath = outPath.replace(/\.html$/, ".part.js");
fs.writeFileSync(partPath, part);
execFileSync("node", [path.join(here, "../build.mjs"), partPath, outPath], { stdio: "inherit" });
