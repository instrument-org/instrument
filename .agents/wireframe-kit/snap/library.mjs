// node .agents/wireframe-kit/snap/library.mjs [<capture dir>] [--only <state>,...]
// Turns capture.mjs's raw snapshots (`<dir>/raw/`, the library itself by default) into
// the library snap() draws from: each state's snapshot with this machine scrubbed out of
// it (`states/<name>.json`, in the wireframe skill's snapshot format), its picture and
// outline beside it. `--only` takes just those states (light and dark) and leaves the
// rest of the library as it is. Writes library.json, when and at which commit each state
// was captured, and INDEX.md, the list an agent reads first.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { STATES } from "./capture.mjs";
import { LIBRARY } from "./lib.mjs";

const argv = process.argv.slice(2);
const onlyAt = argv.indexOf("--only");
const only = onlyAt === -1 ? null : new Set(argv[onlyAt + 1].split(","));
const dir = path.resolve(argv.find((a, i) => onlyAt === -1 || (i !== onlyAt && i !== onlyAt + 1)) ?? LIBRARY);
const raw = path.join(dir, "raw");
const outStates = path.join(LIBRARY, "states");
fs.mkdirSync(outStates, { recursive: true });

/**
 * This machine out of every file: the clean room's folder reads as the scenario's
 * Instrument folder in a generic home, the home folder as the kit's, every drive mounted
 * beside the startup disk as "Backup", and the person's name as "Sam". A shared page holds
 * every word its DOM had, and the app greets the signed-in person by name.
 */
const home = process.env.HOME ?? "";
const user = path.basename(home);
const literal = (/** @type {string} */ s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const run = (/** @type {string} */ cmd, /** @type {string[]} */ args) => {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
};
/**
 * The person's name, word by word: the account's full name (`id -F` on macOS), git's
 * user.name, and any names in `SNAP_SCRUB_NAMES` (comma-separated), the one to set when the
 * app is signed in as someone this machine doesn't name.
 */
const personNames = [
  ...new Set(
    [run("id", ["-F"]), run("git", ["config", "user.name"]), ...(process.env.SNAP_SCRUB_NAMES ?? "").split(",")]
      .flatMap((n) => n.split(/\s+/))
      .filter((w) => /^\p{L}{3,}$/u.test(w) && w !== user),
  ),
];
/** External drives under /Volumes, which Files lists by name; disk images are left alone. */
const drives = (fs.existsSync("/Volumes") ? fs.readdirSync("/Volumes") : []).filter((name) => {
  if (name.startsWith(".")) return false;
  const info = run("diskutil", ["info", path.join("/Volumes", name)]);
  return /Device Location:\s*External/.test(info) && !/Protocol:\s*Disk Image/.test(info);
});
const SCRUB = [
  [/\/Users\/[^/"<\s]+\/Library\/Caches\/instrument-studio-drive\/[^/"<\s]+\/clean-rooms\/Instrument/g, "/Users/mac-user/Instrument"],
  [new RegExp(literal(home), "g"), "/Users/mac-user"],
  [new RegExp(`\\b${literal(user)}\\b`, "g"), "mac-user"],
  ...drives.map((d) => [new RegExp(literal(d), "g"), "Backup"]),
  ...personNames.map((n) => [new RegExp(`(?<![\\p{L}\\p{N}])${literal(n)}(?![\\p{L}\\p{N}])`, "gu"), "Sam"]),
];
const scrubText = (/** @type {string} */ text) => SCRUB.reduce((t, [re, to]) => t.replace(/** @type {RegExp} */ (re), /** @type {string} */ (to)), text);
/** Scrubbed everywhere but inside pictures and fonts kept as data, where a name's letters can stand by chance. */
const scrub = (/** @type {string} */ text) =>
  text
    .split(/(data:[\w/+.-]+;base64,[A-Za-z0-9+/=]+)/)
    .map((part, i) => (i % 2 ? part : scrubText(part)))
    .join("");

const done = [];
for (const file of fs.readdirSync(raw).filter((f) => f.endsWith(".json")).sort()) {
  const key = file.slice(0, -5);
  if (only && !only.has(key.replace(/\.dark$/, ""))) continue;
  const snapshot = JSON.parse(fs.readFileSync(path.join(raw, file), "utf8"));
  for (const field of ["html", "url", "title"]) snapshot[field] = scrub(snapshot[field] ?? "");
  const json = JSON.stringify(snapshot);
  fs.writeFileSync(path.join(outStates, `${key}.json`), json);
  if (fs.existsSync(path.join(raw, `${key}.png`))) fs.copyFileSync(path.join(raw, `${key}.png`), path.join(outStates, `${key}.png`));
  const outline = path.join(raw, `${key}.outline.txt`);
  if (fs.existsSync(outline)) {
    // studio-drive's snapshot comes back as { depth, nodes, tree }; the tree is the outline.
    let tree = fs.readFileSync(outline, "utf8");
    try {
      tree = JSON.parse(tree).tree ?? tree;
    } catch {}
    fs.writeFileSync(path.join(outStates, `${key}.outline.txt`), scrubText(tree));
  }
  done.push({ key, kb: Math.round(json.length / 1024) });
}

let commit = "";
try {
  commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: path.dirname(new URL(import.meta.url).pathname), encoding: "utf8" }).trim();
} catch {}
const now = new Date().toISOString();
const listFile = path.join(LIBRARY, "library.json");
const previous = fs.existsSync(listFile) ? JSON.parse(fs.readFileSync(listFile, "utf8")) : {};
// A list of names, with one capturedAt for them all, dates every state by that capture.
/** @type {Record<string, { capturedAt: string, commit: string }>} */
const captured = Array.isArray(previous.states)
  ? Object.fromEntries(previous.states.map((/** @type {string} */ k) => [k, { capturedAt: previous.capturedAt, commit: previous.commit }]))
  : (previous.states ?? {});
for (const d of done) captured[d.key] = { capturedAt: now, commit };
const keys = fs
  .readdirSync(outStates)
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.slice(0, -5))
  .sort();
const states = Object.fromEntries(keys.map((k) => [k, captured[k] ?? { capturedAt: "", commit: "" }]));
fs.writeFileSync(listFile, JSON.stringify({ states }, null, 2));

const names = [...new Set(keys.map((k) => k.replace(/\.dark$/, "")))];
const when = (/** @type {string} */ n) => {
  const c = states[n] ?? states[`${n}.dark`];
  return c.capturedAt ? `${c.capturedAt.slice(0, 10)}${c.commit ? ` at ${c.commit}` : ""}` : "";
};
const index = [
  "# Snapshot library",
  "",
  "Studio at 1280x800 in presentation mode, from a clean room seeded with the pricing scenario (four real chats, the Instrument folder, Screenshots). Each state is `states/<name>.json` (the snapshot), `.png` (look at it first) and `.outline.txt` (every control by the name snap() finds it by). A dark capture is `<name>.dark`. A state missing here, or captured more than a week ago, is one `snap/capture.mjs <name>` away.",
  "",
  "| State | Dark too | Captured | What it shows |",
  "|---|---|---|---|",
  ...names.map((n) => `| \`${n}\` | ${keys.includes(`${n}.dark`) ? "yes" : ""} | ${when(n)} | ${STATES[n]?.about ?? ""} |`),
  "",
];
fs.writeFileSync(path.join(LIBRARY, "INDEX.md"), index.join("\n"));
console.log(`${LIBRARY}: ${done.length} snapshots (${done.map((d) => `${d.key} ${d.kb} KB`).join(", ")})`);
