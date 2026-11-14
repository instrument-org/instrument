// node .agents/wireframe-kit/snap/library.mjs [<capture dir>]
// Turns capture.mjs's raw stills (`<dir>/raw/`, the library itself by default) into the
// library snap() draws from: each state's DOM cleaned for a page (`states/<name>.html`),
// its picture and outline beside it, and once for all of them the app's stylesheet
// scoped to `.snap` (`sheet.css`), its fonts (`fonts.css`) and its icon sprites
// (`sprites.html`). Writes INDEX.md, the list an agent reads first.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { LIBRARY, domWindow, frameUnits, scopeSheet } from "./lib.mjs";

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
const scrub = (/** @type {string} */ text) => SCRUB.reduce((t, [re, to]) => t.replace(/** @type {RegExp} */ (re), /** @type {string} */ (to)), text);

const win = domWindow();
const doc = win.document;
const sheets = new Map();
const sprites = new Map();
const fonts = new Set();
const done = [];
for (const file of fs.readdirSync(raw).filter((f) => f.endsWith(".html")).sort()) {
  const key = file.slice(0, -5);
  const text = scrub(fs.readFileSync(path.join(raw, file), "utf8"));
  const parsed = new win.DOMParser().parseFromString(text, "text/html");
  const [w, h] = (/content="(\d+)x(\d+)@/.exec(text) ?? [0, "1280", "800"]).slice(1).map(Number);
  for (const style of parsed.querySelectorAll("head style")) {
    const css = style.textContent ?? "";
    if (css.includes("data-walkthrough-hidden") && css.length < 600) continue; // the still's own freeze
    for (const m of css.matchAll(/@font-face\s*\{[^}]*\}/g)) fonts.add(m[0]);
    const rest = css.replace(/@font-face\s*\{[^}]*\}/g, "");
    if (rest.trim()) sheets.set(rest, true);
  }
  const body = parsed.body;
  // Sprites first: drawn nowhere themselves, they read as not shown, and every <use> needs them.
  for (const svg of body.querySelectorAll("svg[data-icon-sprite]")) {
    const id = svg.querySelector("symbol")?.id ?? String(sprites.size);
    if (!sprites.has(id)) sprites.set(id, svg.outerHTML.replace(/ data-snap-drop=""/g, ""));
    svg.remove();
  }
  for (const el of body.querySelectorAll("script, noscript, style, [data-snap-drop], [data-walkthrough-hidden], [data-measure-hidden]")) el.remove();
  // A copy laid out out of sight to measure the real one (the address bar's whole path,
  // say) takes no room and draws nothing, but its words would reach a page's text.
  for (const el of body.querySelectorAll('[aria-hidden="true"].invisible.absolute')) el.remove();
  const guestPictures = fs.existsSync(path.join(raw, `${key}.guests.json`)) ? JSON.parse(fs.readFileSync(path.join(raw, `${key}.guests.json`), "utf8")) : {};
  for (const el of body.querySelectorAll("[data-snap-guest]")) {
    const picture = guestPictures[el.getAttribute("data-snap-guest") ?? ""];
    if (!picture) {
      el.remove();
      continue;
    }
    const img = parsed.createElement("img");
    img.setAttribute("src", picture);
    img.setAttribute("alt", `The page at ${el.getAttribute("data-still-guest") ?? "this address"}, as it looked`);
    img.setAttribute("data-snap-picture", "");
    img.setAttribute("class", el.getAttribute("class") ?? "");
    img.setAttribute("style", `${el.getAttribute("style") ?? ""};display:block;width:100%;height:100%;object-fit:cover;object-position:top left`);
    el.replaceWith(img);
  }
  for (const el of body.querySelectorAll("[data-testid]")) {
    el.setAttribute("data-tid", el.getAttribute("data-testid") ?? "");
    el.removeAttribute("data-testid");
  }
  for (const el of body.querySelectorAll("[style]")) {
    const style = el.getAttribute("style") ?? "";
    if (/v[hw]\b/.test(style)) el.setAttribute("style", frameUnits(style));
  }
  const cls = parsed.documentElement.getAttribute("class") ?? "";
  const htmlStyle = parsed.documentElement.getAttribute("style") ?? "";
  const meta = { w, h, theme: key.endsWith(".dark") ? "dark" : "light", cls };
  const html =
    `<!--snap ${JSON.stringify(meta)}-->\n` +
    `<div class="snap-html ${cls}"${htmlStyle ? ` style="${htmlStyle.replace(/"/g, "&quot;")}"` : ""}><div class="snap-body ${body.getAttribute("class") ?? ""}">${body.innerHTML}</div></div>\n`;
  fs.writeFileSync(path.join(outStates, `${key}.html`), html);
  if (fs.existsSync(path.join(raw, `${key}.png`))) fs.copyFileSync(path.join(raw, `${key}.png`), path.join(outStates, `${key}.png`));
  const outline = path.join(raw, `${key}.outline.txt`);
  if (fs.existsSync(outline)) {
    // studio-drive's snapshot comes back as { depth, nodes, tree }; the tree is the outline.
    let tree = fs.readFileSync(outline, "utf8");
    try {
      tree = JSON.parse(tree).tree ?? tree;
    } catch {}
    fs.writeFileSync(path.join(outStates, `${key}.outline.txt`), scrub(tree));
  }
  done.push({ key, kb: Math.round(html.length / 1024) });
}

const sheet = scopeSheet([...sheets.keys()].join("\n"));
fs.writeFileSync(path.join(LIBRARY, "sheet.css"), sheet);
fs.writeFileSync(path.join(LIBRARY, "fonts.css"), [...fonts].join("\n"));
fs.writeFileSync(path.join(LIBRARY, "sprites.html"), [...sprites.values()].join("\n"));
let commit = "";
try {
  commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: path.dirname(new URL(import.meta.url).pathname), encoding: "utf8" }).trim();
} catch {}
fs.writeFileSync(path.join(LIBRARY, "library.json"), JSON.stringify({ capturedAt: new Date().toISOString(), commit, states: done.map((d) => d.key) }, null, 2));

const names = [...new Set(done.map((d) => d.key.replace(/\.dark$/, "")))];
const index = [
  "# Snapshot library",
  "",
  `Studio as captured ${new Date().toISOString().slice(0, 10)}${commit ? ` at ${commit}` : ""}, at 1280x800 in presentation mode, from a clean room seeded with the pricing scenario (four real chats, the Instrument folder, Screenshots). Each state is \`states/<name>.html\` (the snapshot), \`.png\` (look at it first) and \`.outline.txt\` (every control by the name snap() finds it by). A dark capture is \`<name>.dark\`.`,
  "",
  "| State | Dark too | What it shows |",
  "|---|---|---|",
  ...names.map((n) => `| \`${n}\` | ${done.some((d) => d.key === `${n}.dark`) ? "yes" : ""} | ${ABOUT[n] ?? ""} |`),
  "",
];
fs.writeFileSync(path.join(LIBRARY, "INDEX.md"), index.join("\n"));
console.log(`${LIBRARY}: ${done.length} snapshots (${done.map((d) => `${d.key} ${d.kb} KB`).join(", ")}); sheet ${Math.round(sheet.length / 1024)} KB, fonts ${Math.round([...fonts].join("").length / 1024)} KB, ${sprites.size} sprites`);
