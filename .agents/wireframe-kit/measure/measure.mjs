// node .agents/wireframe-kit/measure/measure.mjs <out-dir> [--only key,key] [--no-app] [--workspace documents]
//
// Lays the kit beside the app it draws. Takes a picture of every baseline frame at true
// size (kit/), puts the running Studio into the state each frame names by `measure` and
// takes a picture of that too (app/, through capture.mjs and studio-drive), and writes
// compare.html: each pair over the other with a slider between them, so drift shows up
// as a ghost. Boot the app first:
//   node .agents/skills/studio-chrome-devtools/scripts/studio-drive.mjs boot --purpose "kit measure" --workspace documents
// --no-app reuses the app's pictures from an earlier run and retakes only the kit's.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { parseArgs } from "node:util";

import { evaluatePart, here, kitValue, rawPage } from "../kit.mjs";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    only: { type: "string" },
    "no-app": { type: "boolean" },
    workspace: { type: "string", default: "documents" },
  },
});
const [outArg] = positionals;
if (!outArg)
  throw new Error("usage: node measure.mjs <out-dir> [--only key,key] [--no-app]");
const out = path.resolve(outArg);
const repo = path.resolve(here, "../..");
const only = values.only?.split(",");
for (const d of ["kit", "app"]) fs.mkdirSync(path.join(out, d), { recursive: true });

const { states } = evaluatePart(fs.readFileSync(path.join(here, "baseline.js"), "utf8"));
const slug = (/** @type {string} */ s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const frames = states
  .map((s, i) => ({ ...s, n: i + 1, file: `${String(i + 1).padStart(2, "0")}-${slug(s.title)}.png` }))
  .filter((f) => !only || (f.measure && only.includes(f.measure)));

// The kit's pictures, with the Playwright Studio's browser tests already install.
const { chromium } = createRequire(path.join(repo, "apps/studio/package.json"))("playwright");
const raw = path.join(out, "kit", "raw.html");
fs.writeFileSync(raw, rawPage(frames));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1, colorScheme: "light" });
await page.goto(`file://${raw}`);
await page.waitForLoadState("networkidle");
await page.waitForTimeout(1500);
for (const [i, f] of frames.entries())
  await page.locator(`#f${i + 1}`).screenshot({ path: path.join(out, "kit", f.file) });
await browser.close();
console.log(`kit: ${frames.length} frames`);

// The app's pictures: the folder Files is shown on, then the capture sequence.
if (!values["no-app"]) {
  const folder = path.join(out, "folder", "Instrument");
  fs.mkdirSync(folder, { recursive: true });
  /** @type {[string, string, string, string, string][]} */
  const rows = kitValue("FOLDER_ROWS");
  for (const [kind, name, , , title] of rows) {
    const at = path.join(folder, name);
    if (kind === "folder") fs.mkdirSync(at, { recursive: true });
    else if (!fs.existsSync(at))
      fs.writeFileSync(
        at,
        kind === "html"
          ? `<!doctype html><title>${title}</title><body style="font-family:sans-serif;margin:40px"><h1>${title}</h1><p>Per agent per month, billed annually.</p></body>`
          : kind === "md"
            ? `# ${title}\n\nNotes for the pricing review.\n`
            : "vendor,plan,price\nZendesk,Suite Team,55\nFreshdesk,Pro,49\nIntercom,Essential,29\n",
      );
  }
  const keys = [...new Set(frames.flatMap((f) => (f.measure ? [f.measure] : [])))];
  const drive = path.join(repo, ".agents/skills/studio-chrome-devtools/scripts/studio-drive.mjs");
  // Another session's edit can hot-reload the app mid-run, which stops it; one more
  // try usually lands between edits.
  const capture = () => {
    try {
      return execFileSync(
        "node",
        [drive, "run", path.join(here, "measure/capture.mjs"), "--workspace", values.workspace, "--args", JSON.stringify({ dir: path.join(out, "app"), folder, only: keys })],
        { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
      );
    } catch (error) {
      // A run that stops partway still says how far it got.
      return /** @type {{ stdout?: string }} */ (error).stdout ?? "{}";
    }
  };
  let result = capture();
  if (/reloaded/.test(result) && /"ok": false/.test(result)) {
    console.warn("app: the app reloaded during the run, so it runs once more");
    result = capture();
  }
  const run = JSON.parse(result || "{}");
  if (run.ok === false) console.warn(`app: the run stopped at ${run.stoppedAt}: ${run.error}`);
  const taken = run.value ?? [];
  for (const line of taken) if (line.includes("FAILED")) console.warn(`app: ${line}`);
  console.log(`app: ${taken.filter((l) => !l.includes("FAILED")).length} states`);
}

// The page that lays them over each other.
const pairs = frames
  .map((f) => {
    const app = f.measure && fs.existsSync(path.join(out, "app", `${f.measure}.png`)) ? `app/${f.measure}.png` : "";
    return `<section><h2>${f.n}. ${f.title}${f.measure ? ` <code>${f.measure}</code>` : ""}</h2>${
      app
        ? `<div class="pair" style="width:${f.w || 1280}px;height:${f.h || 800}px"><img src="${app}"><img class="kit" src="kit/${f.file}"></div><label>App <input type="range" min="0" max="100" value="50"> Kit</label>`
        : `<img src="kit/${f.file}">${f.measure ? `<p>No picture of the app for <code>${f.measure}</code>.</p>` : ""}`
    }</section>`;
  })
  .join("\n");
fs.writeFileSync(
  path.join(out, "compare.html"),
  `<!doctype html><meta charset="utf-8"><title>Kit against the app</title>
<style>body{font:14px system-ui;margin:24px;background:#eee}section{margin-bottom:40px}h2{font-size:15px}code{font-size:12px;color:#666}.pair{position:relative;outline:1px solid #ccc}.pair img{position:absolute;inset:0}label{display:flex;gap:8px;align-items:center;margin-top:8px}input{width:320px}</style>
<p>Each frame is the running app with the kit's drawing over it. Drag a slider to fade from one to the other; a ghost is drift.</p>
${pairs}
<script>for (const r of document.querySelectorAll("input[type=range]")) { const kit = r.closest("section").querySelector(".kit"); const set = () => (kit.style.opacity = r.value / 100); r.addEventListener("input", set); set(); }</script>`,
);
console.log(path.join(out, "compare.html"));
