// node build.mjs <part.js> <out.html>
// Builds a create-page wireframe of the 2.0 window from the skill's starter, the
// wireframe template's main.html, this kit (brands.js + window-2.js) and a part that
// defines META and states. CREATE_PAGE_DIR points at the create-page skill when it is
// not installed at ~/.claude/skills/create-page.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";

const [partPath, outPath] = process.argv.slice(2);
const here = path.dirname(new URL(import.meta.url).pathname);
const SKILL =
  process.env.CREATE_PAGE_DIR ??
  path.join(os.homedir(), ".claude/skills/create-page");
const starter = fs.readFileSync(path.join(SKILL, "starter.html"), "utf8");
let main = fs.readFileSync(
  path.join(SKILL, "templates/wireframe/main.html"),
  "utf8",
);
const kit =
  fs.readFileSync(path.join(here, "brands.js"), "utf8") +
  "\n" +
  fs.readFileSync(path.join(here, "window-2.js"), "utf8");
const part = fs.readFileSync(partPath, "utf8");

const cut = (s, from, to, insert) => {
  const a = s.indexOf(from);
  const b = s.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error(`markers not found: ${from} .. ${to}`);
  return s.slice(0, a) + insert + "\n\n        " + s.slice(b);
};

// Evaluate kit + marks + part in node, so a broken frame fails here rather than on screen.
const marks = main.slice(
  main.indexOf("// ---- annotations"),
  main.indexOf("// ---- the frames"),
);
const ctx = {};
vm.createContext(ctx);
vm.runInContext(
  `${kit}\n${marks}\n${part}\n;globalThis.__out = { META, states };`,
  ctx,
);
const { META, states } = ctx.__out;
for (const [i, s] of states.entries()) {
  if (typeof s.body !== "string") throw new Error(`frame ${i + 1} has no body`);
  if (/undefined|\[object Object\]|NaN/.test(s.body))
    throw new Error(`frame ${i + 1} renders undefined/object/NaN`);
  if (!s.title || !s.note)
    throw new Error(`frame ${i + 1} lacks a title or note`);
}

main = cut(main, "// ---- the kit", "// ---- annotations", kit);
main = cut(main, "// ---- the frames", "// ---- render", part);
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
html = html.replace(
  /<main class="[^"]*">[\s\S]*?<\/main>/,
  () =>
    `<main class="flex min-h-dvh flex-col px-4 pb-8 sm:px-6">\n${main}\n    </main>`,
);
fs.writeFileSync(outPath, html);
// RAW=<n> also writes <out>.raw.html: frame n alone at true size, for a kit check.
if (process.env.RAW) {
  const s = states[Number(process.env.RAW) - 1];
  const raw = starter.replace(
    /<main class="[^"]*">[\s\S]*?<\/main>/,
    () =>
      `<main style="padding:0"><div style="position:relative;width:${s.w || 1280}px;height:${s.h || 800}px;overflow:hidden">${s.body}</div></main>`,
  );
  fs.writeFileSync(outPath.replace(/\.html$/, ".raw.html"), raw);
}
console.log(
  `${outPath}: ${states.length} frames, ${Math.round(html.length / 1024)} KB`,
);
