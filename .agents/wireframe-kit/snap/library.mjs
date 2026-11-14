// node .agents/wireframe-kit/snap/library.mjs [<capture dir>]
// Turns capture.mjs's raw snapshots (`<dir>/raw/`, the library itself by default) into
// the library snap() draws from: each state's snapshot with this machine scrubbed out of
// it (`states/<name>.json`, in the wireframe skill's snapshot format), its picture and
// outline beside it. Writes INDEX.md, the list an agent reads first.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { LIBRARY } from "./lib.mjs";

const dir = path.resolve(process.argv[2] ?? LIBRARY);
const raw = path.join(dir, "raw");
const outStates = path.join(LIBRARY, "states");
fs.mkdirSync(outStates, { recursive: true });

/** What each state shows, for INDEX.md. */
const ABOUT = {
  chat: "The pricing chat open: rail, the chat list (Search, View options, Inbox / Drafts / Archived, a Projects section, rows with project names), the chat's head, an answer with a table, the reply box.",
  "chat-view-options": "The chat list's View options open: Three lines, Two lines, One line, and Group by day.",
  "chat-search": "The chat list filtered by \"pricing\" typed into Search.",
  "chat-drafts": "The chat list on its Drafts tab, empty.",
  apps: "Apps open from the rail.",
  "chat-plus-menu": "The chat with the reply box's + menu open (Browser, This Mac, Attach files, Add a folder, Apps, Skills).",
  draft: "New pressed in Chat: a new chat fills the chat pane (New chat, + Project, No model chosen).",
  "draft-over-files": "New pressed in Files: the draft docked over the Instrument folder.",
  "bell-update": "The bell open on two notices: an update (What's new, Dismiss) and a What's new from the feed.",
  feedback: "Send feedback open over the chat: topic chips, the note, Add images, what's sent with it.",
  "files-table": "Files on the Instrument folder in Table view, pricing-comparison.html selected.",
  "files-list": "Files in List view, the same selection.",
  "files-grid": "Files in Grid view, the same selection.",
  "files-context-menu": "Files in Table view with a file's context menu open.",
  "files-info": "Files with the Info card open on pricing-comparison.html (from the context menu's Info ⌘I).",
  "files-beside": "pricing-comparison.html open beside its folder.",
  "image-fit": "An image (harbor-desk-pricing.png) open in Files at Fit, its toolbar above.",
  "image-zoom-menu": "The image open with the Zoom menu down.",
  "quick-look": "Quick Look over Files on an image, Space pressed.",
  "browser-page": "The in-app browser on example.com. The page itself is a picture: it runs outside the app's DOM.",
  "browser-find": "The browser with Find in page open on \"domain\", 1 of 2. The page is a picture.",
  "new-tab": "The New tab page.",
  settings: "Settings open on General.",
};

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
fs.writeFileSync(path.join(LIBRARY, "library.json"), JSON.stringify({ capturedAt: new Date().toISOString(), commit, states: done.map((d) => d.key) }, null, 2));

const names = [...new Set(done.map((d) => d.key.replace(/\.dark$/, "")))];
const index = [
  "# Snapshot library",
  "",
  `Studio as captured ${new Date().toISOString().slice(0, 10)}${commit ? ` at ${commit}` : ""}, at 1280x800 in presentation mode, from a clean room seeded with the pricing scenario (four real chats, the Instrument folder, Screenshots). Each state is \`states/<name>.json\` (the snapshot), \`.png\` (look at it first) and \`.outline.txt\` (every control by the name snap() finds it by). A dark capture is \`<name>.dark\`.`,
  "",
  "| State | Dark too | What it shows |",
  "|---|---|---|",
  ...names.map((n) => `| \`${n}\` | ${done.some((d) => d.key === `${n}.dark`) ? "yes" : ""} | ${ABOUT[n] ?? ""} |`),
  "",
];
fs.writeFileSync(path.join(LIBRARY, "INDEX.md"), index.join("\n"));
console.log(`${LIBRARY}: ${done.length} snapshots (${done.map((d) => `${d.key} ${d.kb} KB`).join(", ")})`);
