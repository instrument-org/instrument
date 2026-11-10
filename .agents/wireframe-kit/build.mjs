// node build.mjs <part.js> <out.html>
// Builds a wireframe of the Studio window from the wireframe skill's shell.html and
// main.html, this kit (the files in kit/, in KIT_FILES order) and a part that defines META
// and states. A part that defines META and SCREEN instead builds a prototype: one live
// screen from the skill's prototype.html. WIREFRAME_SKILL_DIR points at the wireframe skill
// when it is not installed at ~/.claude/skills/wireframe.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import vm from "node:vm";

import {
  SKILL,
  evaluatePart,
  here,
  isPrototype,
  kitSource,
  rawPage,
  template,
} from "./kit.mjs";
import { classTokens, loadShared, pruneSheet } from "./snap/lib.mjs";

const [partPath, outPath] = process.argv.slice(2);
if (!partPath || !outPath)
  throw new Error("usage: node build.mjs <part.js> <out.html>");
const starter = fs.readFileSync(path.join(SKILL, "shell.html"), "utf8");
const part = fs.readFileSync(partPath, "utf8");
const PROTOTYPE = isPrototype(part);
let main = template(PROTOTYPE);
const kit = kitSource();

/** @type {(s: string, from: string, to: string, insert: string) => string} */
const cut = (s, from, to, insert) => {
  const a = s.indexOf(from);
  const b = s.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error(`markers not found: ${from} .. ${to}`);
  return s.slice(0, a) + insert + "\n\n        " + s.slice(b);
};

// Evaluate kit + marks + part in node, so a broken frame fails here rather than on screen.
const { META, states, snaps } = evaluatePart(part, partPath);

// A class naming one of Studio's colors that the skill's skin does not define draws
// nothing: Tailwind skips it and the element falls back to inherited ink. That is
// what a class copied from the app (`text-brand-foreground`) runs into.
const colorNames = (/** @type {string} */ css) =>
  new Set(Array.from(css.matchAll(/--color-([a-z0-9-]+):/g), (m) => m[1]));
// Tailwind's own keywords, which need no token.
const skinColors = new Set([
  ...colorNames(starter),
  "current",
  "inherit",
  "transparent",
]);
const studioColors = colorNames(
  fs.readFileSync(
    path.join(here, "../../apps/studio/src/client/styles/globals.css"),
    "utf8",
  ),
);
const COLOR_CLASS =
  /^-?(?:text|bg|border(?:-[trblxyse])?|ring(?:-offset)?|inset-ring|fill|stroke|outline|from|via|to|shadow|inset-shadow|accent|divide|placeholder|caret|decoration)-([a-z0-9-]+?)(?:\/[\w.[\]]+)?!?$/;
for (const [i, s] of states.entries()) {
  const missing = new Set();
  // Inside a snapshot the app's own sheet draws its colors, so only the rest is checked.
  const own = s.body.replace(/<!--snap:start-->[\s\S]*?<!--snap:end-->/g, "");
  for (const [, classes] of own.matchAll(/class="([^"]*)"/g)) {
    for (const token of classes.split(/\s+/)) {
      const name = token.replace(/^.*:/, "").replace(/^!/, "");
      const color = COLOR_CLASS.exec(name)?.[1];
      if (color && studioColors.has(color) && !skinColors.has(color))
        missing.add(name);
    }
  }
  if (missing.size > 0)
    throw new Error(
      `frame ${i + 1} uses colors the skin does not define, so they draw nothing: ${[...missing].join(", ")}. Add them to the skill's shell.html @theme, or use a kit class.`,
    );
}

main = cut(main, "// ---- the kit", "// ---- annotations", kit);
main = cut(main, PROTOTYPE ? "// ---- the screen" : "// ---- the frames", "// ---- render", part);
main = main.replace(
  /const SLOT_H = \d+;/,
  `const SLOT_H = ${META.slotH || 300};`,
);
main = main.replace(
  /const TILE_MIN = \d+;/,
  `const TILE_MIN = ${META.tileMin || 560};`,
);
main = main.replace(">TITLE</h1>", `>${META.title}</h1>`);
main = main.replace(/>ONE LINE:[^<]*<\/p>/, `>${META.line}</p>`);
main = main.replace(
  /(<p id="source"[^>]*>)[\s\S]*?(<\/p>)/,
  `$1${META.source}$2`,
);
// Drop the template's authoring comments inside <main>.
main = main.replace(/<!--(?!\s*Keep type)[\s\S]*?-->\s*/g, "");

let html = starter
  .replace("<title>TITLE</title>", `<title>${META.title}</title>`)
  .replace('content="TEMPLATE@1"', 'content="wireframe@1"');
// Name this repository in `instrument:repo` the way the skill's new.mjs does. A skill
// installed before repo.mjs existed builds the page without it.
const repoMeta = path.join(SKILL, "repo.mjs");
if (fs.existsSync(repoMeta)) {
  const { repoName, tagRepo } = await import(pathToFileURL(repoMeta).href);
  html = tagRepo(html, repoName(here));
}
html = html.replace(
  /<main class="[^"]*">[\s\S]*?<\/main>/,
  () =>
    PROTOTYPE
      ? `<main class="flex h-dvh flex-col">\n${main}\n    </main>`
      : `<main class="flex min-h-dvh flex-col px-4 pb-8 sm:px-6">\n${main}\n    </main>`,
);
// The part shares one module scope with the template's render code, so a top-level
// name it reuses (`stage`, `layout`, `rack`) is a SyntaxError that blanks the page.
// The run above never sees the render code; compiling the page's script does.
for (const [, src] of html.matchAll(
  /<script type="module">([\s\S]*?)<\/script>/g,
)) {
  try {
    new vm.Script(src);
  } catch (error) {
    throw new Error(
      `page script does not compile: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
// Snapshot frames: the app's sheet scoped to them and pruned to what this page uses, and
// each frame as the build drew it, its pictures kept once in an asset list.
let snapNote = "";
if (snaps.length > 0) {
  const shared = loadShared();
  const assets = [];
  /** @type {Map<string, number>} */
  const assetIndex = new Map();
  const tokenize = (/** @type {string} */ h) =>
    h.replace(/data:[^"')\s]{1000,}/g, (uri) => {
      if (!assetIndex.has(uri)) {
        assetIndex.set(uri, assets.length);
        assets.push(uri);
      }
      return `snap-asset:${assetIndex.get(uri)}`;
    });
  const classes = new Set();
  for (const s of snaps) for (const c of classTokens(s.html + s.base)) classes.add(c);
  const sheet = pruneSheet(shared.sheet, classes);
  const base = Object.fromEntries(snaps.map((s) => [s.state, tokenize(s.base)]));
  const data = JSON.stringify({
    assets,
    base,
    built: snaps.map((s) => tokenize(s.html)),
    sprites: shared.sprites,
  }).replace(/</g, "\\u003c");
  const frameCss =
    ".snap{text-align:initial}.snap .snap-html,.snap .snap-body{width:100%;height:100%;position:relative}.snap *,.snap *::before,.snap *::after{transition:none!important}body[data-snap-before] .marks{display:none}";
  html = html
    .replace("</head>", () => `<style id="snap-sheet">\n${shared.fonts}\n${sheet}\n${frameCss}\n</style>\n</head>`)
    .replace("</body>", () => `<script type="application/json" id="snap-data">${data}</script>\n</body>`);
  snapNote = `; ${snaps.length} from snapshots (sheet ${Math.round(sheet.length / 1024)} KB, pictures ${Math.round(assets.join("").length / 1024)} KB)`;
}
fs.writeFileSync(outPath, html);
// RAW=<n> also writes frame n alone at true size, for a kit check, and RAW=all every
// frame, one under another. That page is looked at once and kept by no one, so it goes
// to the temp folder under the page's name rather than beside the page, and the build
// says where.
let raw;
if (process.env.RAW) {
  const frames =
    process.env.RAW === "all" ? states : [states[Number(process.env.RAW) - 1]];
  raw = path.join(
    os.tmpdir(),
    path.basename(outPath).replace(/\.html$/, ".raw.html"),
  );
  fs.writeFileSync(raw, rawPage(frames));
}
console.log(
  `${outPath}: ${PROTOTYPE ? "a prototype" : `${states.length} frames`}, ${Math.round(html.length / 1024)} KB${snapNote}${raw ? `; frames at true size: ${raw}` : ""}`,
);
