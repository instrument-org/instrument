/**
 * Build one local page that plays a set of wireframes, for walking someone
 * through them or recording a video of them.
 *
 *   node .agents/skills/product-wireframe/scripts/build-index.ts
 *   node .agents/skills/product-wireframe/scripts/build-index.ts a.html b.html
 *   node .agents/skills/product-wireframe/scripts/build-index.ts --out /tmp/x.html
 *
 * With no paths it takes every docs/plans/active/wireframes-*.html, in name
 * order. Paths given on the command line are used exactly, in the order given,
 * and may name a file anywhere. A manifest overrides both; see below.
 *
 * Every document is inlined into the output and swapped into one iframe with
 * `srcdoc`, which is not an optimization. Chrome refuses to load a sibling
 * file:// document into an iframe, so `src="./wireframes-x.html"` renders blank
 * with no error and it looks like the whole idea is unworkable. `srcdoc`
 * involves no origin, so it always renders, and the artifact's own scripts run:
 * frames scale to the pane and enlarge-on-click works.
 *
 * The cost of that is the output holds copies. Rerun this after changing any
 * artifact in the set, or the index quietly shows the old one.
 */
import { existsSync, globSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../../..");
const FLOWS = "docs/plans/active";
const OUT = `${FLOWS}/wireframes-index.html`;

/**
 * Optional, and the only way to get grouping or a hand-written title.
 * One entry per line, `file.html | Title`, with the title optional. A
 * `# Heading` line starts a group. Blank lines are skipped. Its order is the
 * order of the index.
 */
const MANIFEST = `${FLOWS}/wireframes-index.txt`;

interface Entry {
  file: string;
  group?: string;
  title: string;
}

// ---- reading an artifact ---------------------------------------------------

const stripTags = (html: string) =>
  html
    .replaceAll(/<[^>]*>/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim();

const decode = (text: string) =>
  text
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&ndash;", "-")
    .replaceAll("&larr;", "←")
    .replaceAll("&rarr;", "→");

/** Both templates carry the real name in the first h1; the <title> is a placeholder. */
const readTitle = (html: string, file: string) => {
  const found = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html);
  const text = decode(stripTags(found?.[1] ?? ""));
  return text && text !== "TITLE" ? text : path.basename(file, ".html");
};

/**
 * Wireframes only. Counts the state objects rather than trusting a comment.
 * A frame's own data can carry a nested `title:` of its own, so only the
 * shallowest indentation in the array is a state.
 */
const readFrames = (html: string) => {
  const start = html.indexOf("const states = [");
  if (start === -1) return "";
  const body = html.slice(start, html.indexOf("// ---- render", start));
  const indents = [...body.matchAll(/^([ \t]+)title:/gm)].map(
    (m) => (m[1] ?? "").length,
  );
  if (indents.length === 0) return "";
  const top = Math.min(...indents);
  const n = indents.filter((indent) => indent === top).length;
  return `${n} frames`;
};

// ---- choosing the set ------------------------------------------------------

/** Manifest entries may name a bare file, which is looked for beside the plans. */
const locate = (name: string) => {
  for (const candidate of [name, `${FLOWS}/${name}`]) {
    if (existsSync(path.join(REPO_ROOT, candidate))) return candidate;
  }
  return undefined;
};

const fromManifest = (): Entry[] => {
  const lines = readFileSync(path.join(REPO_ROOT, MANIFEST), "utf8").split(
    "\n",
  );
  const entries: Entry[] = [];
  let group: string | undefined;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) {
      group = line.slice(1).trim();
      continue;
    }
    const [name = "", title] = line.split("|").map((part) => part.trim());
    const file = locate(name);
    // A curated list outlives the files in it, so a name that no longer
    // resolves costs its own row rather than the whole index. The heading
    // above it is left standing for whatever follows.
    if (!file) {
      console.warn(`build-index: skipping missing artifact: ${name}`);
      continue;
    }
    const html = readFileSync(path.join(REPO_ROOT, file), "utf8");
    entries.push({ file, group, title: title || readTitle(html, file) });
    group = undefined; // a heading applies to the run that follows it
  }
  return entries;
};

const describe = (file: string): Entry => {
  const html = readFileSync(path.join(REPO_ROOT, file), "utf8");
  return { file, title: readTitle(html, file) };
};

const chooseSet = (paths: string[]): Entry[] => {
  // A path given on the command line was asked for by name, so a miss there is
  // a mistake worth stopping on rather than a stale line in a long list.
  if (paths.length > 0)
    return paths.map((given) => {
      const file = locate(given);
      if (!file) throw new Error(`build-index: no such artifact: ${given}`);
      return describe(file);
    });
  if (existsSync(path.join(REPO_ROOT, MANIFEST))) return fromManifest();
  return globSync(`${FLOWS}/wireframes-*.html`, { cwd: REPO_ROOT })
    .filter((file) => file !== OUT)
    .sort()
    .map(describe);
};

// ---- the page --------------------------------------------------------------

const escapeHtml = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const CSS = `
*{box-sizing:border-box}
html,body{margin:0;height:100%}
body{font-family:"Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  background:#171412;color:#fafaf9;display:grid;grid-template-columns:300px 1fr;
  height:100vh;overflow:hidden;-webkit-font-smoothing:antialiased}
body.solo{grid-template-columns:0 1fr}
body.solo #rail{opacity:0;pointer-events:none}
#rail{border-right:1px solid #292524;overflow-y:auto;padding:18px 0 40px;transition:opacity .14s ease}
#rail header{padding:6px 20px 18px}
#rail h1{font-size:15px;font-weight:600;margin:0;letter-spacing:-.01em}
#rail p{font-size:12px;line-height:17px;color:#79716b;margin:6px 0 0}
.group{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#57534e;
  padding:20px 20px 8px;font-weight:600}
.item{display:flex;align-items:flex-start;border-left:2px solid transparent}
.item:hover{background:#1c1917}
.item.on{background:#221f1d;border-left-color:#0e7869}
.pick{flex:1;min-width:0;display:flex;align-items:baseline;gap:7px;font:inherit;color:inherit;
  background:none;border:0;text-align:left;cursor:pointer;padding:9px 4px 10px 20px}
.pick .n{font-size:10px;color:#57534e;font-variant-numeric:tabular-nums;min-width:14px}
.pick .name{font-size:13px;font-weight:500;line-height:18px}
.item.on .name{color:#fff}
.pick .f{font-size:10px;color:#57534e;margin-left:auto;white-space:nowrap}
/* Opening the real file is the one thing the pane cannot do, since a frame
   enlarges into the pane rather than the window. It belongs on the row it
   opens, not in a bar over the artifact. */
.open{flex:none;display:grid;place-items:center;width:24px;height:24px;margin:6px 12px 0 0;
  border-radius:5px;color:#79716b;text-decoration:none;font-size:12px;opacity:.35}
.item:hover .open{opacity:1}
.open:hover{background:#44403c;color:#fff}
#stage{position:relative;background:#fafaf9;overflow:hidden}
#frame{width:100%;height:100%;border:0;display:block;background:#fafaf9}
`;

const JS = `
const docs = JSON.parse(document.getElementById("docs").textContent);
const items = [...document.querySelectorAll(".item")];
const frame = document.getElementById("frame");
let at = -1;

function show(i) {
  if (i < 0 || i >= items.length) return;
  at = i;
  items.forEach((el, n) => el.classList.toggle("on", n === i));
  frame.srcdoc = docs[items[i].dataset.key];
  document.title = items[i].dataset.name + " \\u00b7 " + document.querySelector("#rail h1").textContent;
  items[i].scrollIntoView({ block: "nearest" });
  history.replaceState(null, "", "#" + items[i].dataset.key);
}

items.forEach((el, i) => el.querySelector(".pick").addEventListener("click", () => show(i)));

addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key;
  if (k === "ArrowDown" || k === "ArrowRight" || k === "j") { show(at + 1); e.preventDefault(); }
  else if (k === "ArrowUp" || k === "ArrowLeft" || k === "k") { show(at - 1); e.preventDefault(); }
  else if (k === "f") { document.body.classList.toggle("solo"); e.preventDefault(); }
  else if (k >= "1" && k <= "9") { show(Number(k) - 1); e.preventDefault(); }
  else if (k === "0") { show(9); e.preventDefault(); }
});

const wanted = items.findIndex((el) => "#" + el.dataset.key === location.hash);
show(wanted >= 0 ? wanted : 0);
`;

const build = (entries: Entry[], out: string) => {
  const docs: Record<string, string> = {};
  const rail: string[] = [];
  const outDir = path.dirname(path.resolve(REPO_ROOT, out));

  for (const [i, entry] of entries.entries()) {
    const html = readFileSync(path.join(REPO_ROOT, entry.file), "utf8");
    const key = path.basename(entry.file, ".html");
    docs[key] = html;

    // Relative, so the file survives being moved or handed to someone else.
    const href = path.relative(outDir, path.resolve(REPO_ROOT, entry.file));
    if (entry.group)
      rail.push(`<div class="group">${escapeHtml(entry.group)}</div>`);
    rail.push(
      `<div class="item" data-key="${key}" data-name="${escapeHtml(entry.title)}">` +
        `<button class="pick"><span class="n">${i + 1}</span>` +
        `<span class="name">${escapeHtml(entry.title)}</span>` +
        `<span class="f">${readFrames(html)}</span></button>` +
        `<a class="open" href="${escapeHtml(href)}" target="_blank"` +
        ` title="Open the file itself, for full-size frames">&#8599;</a></div>`,
    );
  }

  // The documents contain </script>, which would close this tag early. \\/ is a
  // valid JSON escape for /, so JSON.parse restores them exactly.
  const blob = JSON.stringify(docs).replaceAll("</", "<\\/");
  const heading = path
    .basename(out, ".html")
    .replace(/^wireframes-/, "")
    .replaceAll("-", " ");

  const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(heading)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%23171412'/%3E%3Ccircle cx='16' cy='16' r='7' fill='none' stroke='%230e7869' stroke-width='2.5'/%3E%3C/svg%3E">
<style>${CSS}</style>
</head>
<body>
<nav id="rail">
  <header>
    <h1>${escapeHtml(heading.replace(/^./, (c) => c.toUpperCase()))}</h1>
    <p>${entries.length} artifacts, in the order to walk them.</p>
  </header>
  ${rail.join("")}
</nav>
<main id="stage">
  <iframe id="frame" title="artifact"></iframe>
</main>
<script id="docs" type="application/json">${blob}</script>
<script>${JS}</script>
</body>
</html>
`;

  const target = path.resolve(REPO_ROOT, out);
  writeFileSync(target, page);
  const kb = Math.round(Buffer.byteLength(page) / 1024);
  console.log(
    `${path.relative(REPO_ROOT, target)}: ${entries.length} artifacts, ${kb} KB`,
  );
};

const args = process.argv.slice(2);
const outFlag = args.indexOf("--out");
const out = (outFlag === -1 ? OUT : args[outFlag + 1]) ?? OUT;
const paths =
  outFlag >= 0 ? [...args.slice(0, outFlag), ...args.slice(outFlag + 2)] : args;

const entries = chooseSet(paths);
if (entries.length === 0) throw new Error("build-index: nothing to index");
build(entries, out);
