// node build.mjs <part.frames.html | part.js> <out.html>
// Builds a wireframe of the Studio window from the wireframe skill's shell.html and
// main.html, this kit (the files in kit/, in KIT_FILES order) and a part. A part of frames
// (an HTML file: meta(), helpers, one frame() per frame) is built by the skill's frames.mjs
// with the kit and its pieces, and each frame that fails becomes an error tile while the
// rest draw. A JS part defines META and states, or META and SCREEN for a prototype: one
// live screen from the skill's prototype.html. WIREFRAME_SKILL_DIR points at the wireframe
// skill when it is not installed at ~/.claude/skills/wireframe.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import vm from "node:vm";

import {
  SKILL,
  evaluatePart,
  framesKits,
  here,
  isFramesPart,
  isPrototype,
  kitSource,
  rawPage,
  snapRecorder,
  template,
} from "./kit.mjs";
import { loadState, pageClasses, trimState } from "./snap/lib.mjs";

const [partPath, outPath] = process.argv.slice(2);
if (!partPath || !outPath)
  throw new Error("usage: node build.mjs <part.frames.html | part.js> <out.html>");
const starter = fs.readFileSync(path.join(SKILL, "shell.html"), "utf8");
const part = fs.readFileSync(partPath, "utf8");
const FRAMES = isFramesPart(partPath);
const PROTOTYPE = !FRAMES && isPrototype(part);
let main = template(PROTOTYPE);
const kit = kitSource();

/** @type {(s: string, from: string, to: string, insert: string) => string} */
const cut = (s, from, to, insert) => {
  const a = s.indexOf(from);
  const b = s.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error(`markers not found: ${from} .. ${to}`);
  return s.slice(0, a) + insert + "\n\n        " + s.slice(b);
};

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
/** The color classes a frame's body names that the skin lacks. */
const missingColors = (/** @type {string} */ body) => {
  const missing = new Set();
  for (const [, classes] of body.matchAll(/class="([^"]*)"/g)) {
    for (const token of classes.split(/\s+/)) {
      const name = token.replace(/^.*:/, "").replace(/^!/, "");
      const color = COLOR_CLASS.exec(name)?.[1];
      if (color && studioColors.has(color) && !skinColors.has(color))
        missing.add(name);
    }
  }
  return [...missing];
};

/** The library states `names` with their stylesheets trimmed to what the page can use, as add-snapshot.mjs stores them. */
const snapshotStore = async (/** @type {string[]} */ names) => {
  const { addSnapshots, readSnapshot } = await import(
    pathToFileURL(path.join(SKILL, "add-snapshot.mjs")).href
  );
  // The library keeps the app's whole stylesheets, so a part can write markup in any of
  // its classes; the page keeps only the rules its states and its own source can use,
  // cut the same way for every state so they still share one copy.
  const loaded = names.map((name) => [name, loadState(name)]);
  const classes = pageClasses(
    loaded.map(([, s]) => s.html),
    [part, kit],
  );
  return addSnapshots(
    { sheets: {}, pages: {} },
    Object.fromEntries(
      loaded.map(([name, s]) => [
        name,
        readSnapshot(JSON.stringify({ ...s, html: trimState(s.html, classes) })),
      ]),
    ),
  );
};

/** RAW=<n> or RAW=all: frames alone at true size in the temp folder, looked at once and kept by no one. */
const writeRaw = (/** @type {any[]} */ frames) => {
  if (!process.env.RAW) return "";
  const picked =
    process.env.RAW === "all" ? frames : [frames[Number(process.env.RAW) - 1]];
  const raw = path.join(
    os.tmpdir(),
    path.basename(outPath).replace(/\.html$/, ".raw.html"),
  );
  fs.writeFileSync(raw, rawPage(picked));
  return raw;
};

if (FRAMES) {
  // A part of frames: every script runs in Node the way the page runs it, each on its own,
  // and the page is written either way, with an error tile where a frame failed.
  const frames = await import(pathToFileURL(path.join(SKILL, "frames.mjs")).href);
  const runtime = frames.runtimeSource(framesKits());
  const snaps = snapRecorder();
  const result = frames.evaluate(part, {
    runtime,
    file: path.basename(partPath),
    lend: { __snapHost: snaps.host },
  });
  const fails = [...result.fails];
  for (const [i, s] of result.states.entries()) {
    const missing = s.error ? [] : missingColors(s.body);
    if (missing.length > 0)
      fails.push(
        `frame ${i + 1} "${s.title}" uses colors the skin does not define, so they draw nothing: ${missing.join(", ")}. Use a kit class, or add them to the skill's shell.html @theme.`,
      );
  }
  let head = "";
  if (snaps.used.size > 0) {
    // Before the runtime, since a frame's snap() runs while the page is read.
    const store = await snapshotStore([...snaps.used]);
    const json = JSON.stringify(store).replace(/</g, "\\u003c");
    head = `<script type="application/json" id="wireframe-snapshots">${json}</script>\n<script id="wireframe-snapshot-frames">${fs.readFileSync(path.join(SKILL, "snapshot-frames.js"), "utf8")}</script>\n`;
  }
  const html = frames.assemble({
    part,
    runtime,
    meta: result.meta,
    tileMin: 560,
    head,
    repoDir: here,
  });
  fs.writeFileSync(outPath, html);
  const raw = writeRaw(result.states);
  // The frames by label, so a frame the reader names is a block to go to.
  for (const line of frames.frameList?.(result.index) ?? []) console.log(line);
  for (const f of fails) console.log(`FAIL ${partPath}: ${f}`);
  for (const n of result.notes) console.log(`${partPath}: ${n}`);
  const drawn = result.states.filter((/** @type {any} */ s) => !s.error).length;
  console.log(
    `${outPath}: ${drawn} of ${result.states.length} frames drawn${fails.length ? `, ${fails.length} problems` : ""}, ${Math.round(html.length / 1024)} KB${snaps.used.size ? `; ${snaps.used.size} snapshots` : ""}${raw ? `; frames at true size: ${raw}` : ""}`,
  );
  process.exit(fails.length ? 1 : 0);
}

// Evaluate kit + marks + part in node, so a broken frame fails here rather than on screen.
const { META, states, snaps } = evaluatePart(part, partPath);

for (const [i, s] of states.entries()) {
  const missing = missingColors(s.body);
  if (missing.length > 0)
    throw new Error(
      `frame ${i + 1} uses colors the skin does not define, so they draw nothing: ${missing.join(", ")}. Add them to the skill's shell.html @theme, or use a kit class.`,
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
// Snapshot frames: the library states the part's snap() calls named, put into the page
// with the wireframe skill's add-snapshot.mjs, which stores each stylesheet once and adds
// the skill's frames script, snapshot-frames.js, that draws them.
let snapNote = "";
if (snaps.length > 0) {
  const { writeInto } = await import(
    pathToFileURL(path.join(SKILL, "add-snapshot.mjs")).href
  );
  const store = await snapshotStore(snaps);
  html = writeInto(
    html,
    store,
    fs.readFileSync(path.join(SKILL, "snapshot-frames.js"), "utf8"),
  );
  snapNote = `; ${snaps.length} snapshots, ${Object.keys(store.sheets).length} shared stylesheets`;
}
fs.writeFileSync(outPath, html);
// RAW=<n> also writes frame n alone at true size, for a kit check, and RAW=all every
// frame, one under another, to the temp folder; the build says where.
const raw = writeRaw(states);
console.log(
  `${outPath}: ${PROTOTYPE ? "a prototype" : `${states.length} frames`}, ${Math.round(html.length / 1024)} KB${snapNote}${raw ? `; frames at true size: ${raw}` : ""}`,
);
