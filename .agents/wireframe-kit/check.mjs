// node .agents/wireframe-kit/check.mjs <page.html> [<out.png>] [--frame n]
//
// Looks at a built page the way a reader will, once: opens it in a downloaded headless
// Chromium (chrome.mjs), turns the marks on, and writes one PNG of the whole grid, laid
// out so every frame is as large as one picture a reader takes in at a glance allows.
// Then it prints what that picture is too small to settle: script and console errors,
// resources that did not load, frames that drew blank, content that reaches past a
// frame's box or past its own, and every mark with the element it rings and where.
// --frame n writes that one frame alone at true size instead, for a closer look. The PNG
// goes to the temp folder as <page>.check.png or <page>.f<n>.png unless <out.png> says
// where, since nothing made on the way to a page sits beside the pages.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { launch } from "./chrome.mjs";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { frame: { type: "string" } },
});
const [pageArg, outArg] = positionals;
if (!pageArg) throw new Error("usage: node check.mjs <page.html> [<out.png>] [--frame n]");
const pagePath = path.resolve(pageArg);
const frameN = values.frame ? Number(values.frame) : 0;
const outPath = outArg ? path.resolve(outArg) : path.join(os.tmpdir(), path.basename(pagePath).replace(/\.html$/, frameN ? `.f${frameN}.png` : ".check.png"));

// The page's own grid measures: its side gutter, the gap between tiles, a tile's padding
// and border, and a caption's usual three lines under the frame.
const GUTTER = 32;
const GAP = 8;
const PAD = 25;
const CAPTION = 84;
// What an image reader keeps before it shrinks a picture: its longest edge, and its area.
const READ_EDGE = 1568;
const READ_AREA = 1.2e6;

/**
 * How many frames per row, and how wide a window, leave each frame largest once the
 * reader has shrunk the sheet to what it keeps. Walks the page's own layout rule: a
 * tile's width from the columns, every frame scaled to fit it, the slot as tall as the
 * median frame.
 * @param {{ w: number; h: number }[]} sizes
 */
function pickLayout(sizes) {
  const widest = Math.max(...sizes.map((s) => s.w));
  let best = { columns: 1, width: widest + PAD + GUTTER, scale: 0 };
  for (let columns = 1; columns <= Math.min(4, sizes.length); columns++) {
    const width = Math.min(READ_EDGE, columns * (widest + PAD) + GAP * (columns - 1) + GUTTER);
    const inner = (width - GUTTER - GAP * (columns - 1)) / columns - PAD;
    const fit = sizes.map((s) => Math.min(inner / s.w, 1));
    const heights = sizes.map((s, i) => s.h * fit[i]).sort((a, b) => a - b);
    const slot = heights[Math.floor(heights.length / 2)];
    const rows = Math.ceil(sizes.length / columns);
    const height = rows * (slot + CAPTION) + GAP * (rows - 1);
    const kept = Math.min(1, READ_EDGE / Math.max(width, height), Math.sqrt(READ_AREA / (width * height)));
    const scale = (sizes.reduce((sum, s, i) => sum + Math.min(fit[i], columns === 1 ? 1 : slot / s.h), 0) / sizes.length) * kept;
    if (scale > best.scale) best = { columns, width, scale };
  }
  return best;
}

/** Runs in the page: every frame's size, what spills, and where its marks landed. */
const REPORT = `(() => {
  const describe = (el) => {
    const cls = [...el.classList].filter((c) => !/[\\[\\]:/]/.test(c)).slice(0, 3).join(".");
    const text = (el.textContent || "").replace(/\\s+/g, " ").trim();
    // A bare wrapper, as the mark helpers leave, is named by what it wraps.
    if (!cls && !text && el.firstElementChild) return "<" + el.tagName.toLowerCase() + "> around " + describe(el.firstElementChild);
    return "<" + el.tagName.toLowerCase() + (cls ? "." + cls : "") + ">" + (text ? ' "' + text.slice(0, 36) + (text.length > 36 ? "…" : "") + '"' : "");
  };
  // Under this many true-size pixels an overhang is line-height slop, not a spill.
  const SLOP = 3;
  const box = (r, rr, s) => ({ x: Math.round((r.left - rr.left) / s), y: Math.round((r.top - rr.top) / s), w: Math.round(r.width / s), h: Math.round(r.height / s) });
  return [...document.querySelectorAll("#rack .frame")].map((frame) => {
    const root = frame.firstElementChild;
    const w = Number(frame.dataset.w), h = Number(frame.dataset.h);
    const s = parseFloat(frame.style.getPropertyValue("--s")) || 1;
    const rr = root.getBoundingClientRect();
    const caption = frame.closest(".tile")?.querySelector("figcaption")?.textContent.replace(/\\s+/g, " ").trim() ?? "";
    const title = /^\\d+\\.\\s*(.*?)\\.(?:\\s|$)/.exec(caption)?.[1] ?? "";
    const all = [...root.querySelectorAll("*")].filter((el) => !el.closest(".marks") && !el.matches("i.mark"));
    const painted = all.some((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    // Past the frame: the outermost elements whose box reaches beyond the frame's, not
    // counting anything an ancestor clips, which the frame's overflow never shows.
    const clipped = (el) => {
      for (let p = el.parentElement; p && p !== root; p = p.parentElement) {
        const o = getComputedStyle(p);
        if (o.overflowX !== "visible" || o.overflowY !== "visible") return true;
      }
      return false;
    };
    const past = [];
    for (const el of all) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const dx = Math.round((r.right - rr.left) / s - w), dy = Math.round((r.bottom - rr.top) / s - h);
      if ((dx > SLOP || dy > SLOP) && !clipped(el) && !past.some((p) => p.el.contains(el))) past.push({ el, dx: Math.max(0, dx), dy: Math.max(0, dy) });
    }
    // Past its own box: text or in-flow children reaching beyond the element that holds
    // them, where nothing clips it, so they draw over whatever is beside or below.
    const reach = (el) => {
      const b = el.getBoundingClientRect();
      let dx = 0, dy = 0;
      for (const n of el.childNodes) {
        let r;
        if (n.nodeType === 3) {
          if (!n.data.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(n);
          r = range.getBoundingClientRect();
        } else if (n.nodeType === 1) {
          const o = getComputedStyle(n);
          if (o.position === "absolute" || o.position === "fixed" || o.display === "none") continue;
          r = n.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) continue;
        } else continue;
        dx = Math.max(dx, (r.right - b.right) / s);
        dy = Math.max(dy, (r.bottom - b.bottom) / s);
      }
      return { dx: Math.round(dx), dy: Math.round(dy) };
    };
    const tight = [];
    for (const el of all) {
      if (el.clientWidth === 0) continue;
      const o = getComputedStyle(el);
      if (o.overflowX !== "visible" && o.overflowY !== "visible") continue;
      const { dx, dy } = reach(el);
      if (((o.overflowX === "visible" && dx > SLOP) || (o.overflowY === "visible" && dy > SLOP)) && !tight.some((t) => t.el.contains(el))) tight.push({ el, dx, dy });
    }
    // Marks: a ring and a pointer on one element draw as one mark, as the page draws them.
    const groups = new Map();
    for (const m of root.querySelectorAll("i.mark")) {
      const el = m.parentElement;
      const g = groups.get(el) || { el, label: m.dataset.label, pointer: false };
      if ("pointer" in m.dataset) g.pointer = true;
      else g.label = m.dataset.label;
      groups.set(el, g);
    }
    const marks = [...groups.values()].map((g) => {
      const r = g.el.getBoundingClientRect();
      const b = r.width && r.height ? box(r, rr, s) : null;
      return { label: g.label, el: describe(g.el), box: b, off: Boolean(b && (b.x + b.w <= 0 || b.y + b.h <= 0 || b.x >= w || b.y >= h)) };
    });
    const strip = (list) => list.map((x) => ({ ...x, el: describe(x.el) }));
    return { w, h, s, title, caption, painted, past: strip(past), tight: strip(tight), marks, rings: root.querySelectorAll(".marks .mark-ring").length };
  });
})()`;

const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));
/** @type {string[]} */
const errors = [];
/** @type {string[]} */
const loads = [];
const { page, close } = await launch();
try {
  page.on("Runtime.exceptionThrown", (p) => errors.push(`error: ${p.exceptionDetails.exception?.description?.split("\n")[0] ?? p.exceptionDetails.text}`));
  page.on("Runtime.consoleAPICalled", (p) => {
    if (p.type === "error" || p.type === "assert") errors.push(`console.${p.type}: ${p.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 300)}`);
  });
  await page.send("Log.enable");
  page.on("Log.entryAdded", ({ entry }) => {
    if (entry.level !== "error") return;
    const line = entry.source === "network" ? `could not load ${entry.url ?? ""}: ${entry.text}` : `${entry.source}: ${entry.text}`;
    if (!loads.includes(line)) loads.push(line);
  });

  await page.viewport(1400, 900);
  await page.navigate(pathToFileURL(pagePath).href);
  await page.evaluate(`document.fonts.ready.then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))`, 8000);
  // Tailwind compiles the page's classes after load and the page draws its marks again
  // 300ms after that, so wait until what is on the page holds still.
  const snapshot = () => page.evaluate(`[document.querySelectorAll("#rack .marks").length, document.body.scrollHeight, document.styleSheets.length].join()`);
  for (let last = "", since = Date.now(), start = since; Date.now() - start < 6000; ) {
    await sleep(200);
    const now = await snapshot();
    if (now !== last) [last, since] = [now, Date.now()];
    else if (Date.now() - since >= 600) break;
  }

  /** @type {{ w: number; h: number }[]} */
  const sizes = await page.evaluate(`[...document.querySelectorAll("#rack .frame")].map((f) => ({ w: Number(f.dataset.w), h: Number(f.dataset.h) }))`);
  if (sizes.length === 0) {
    for (const line of [...errors, ...loads]) console.log(line);
    console.log(`${path.basename(pagePath)}: no frames drew. The page's script threw, or this is not a page build.mjs made.`);
    process.exit(1);
  }
  if (frameN && !sizes[frameN - 1]) throw new Error(`--frame ${frameN}: the page has ${sizes.length} frames`);
  // One frame alone gets a window its true width fills, with a pixel over for rounding.
  const layout = frameN ? { columns: 1, width: (sizes[frameN - 1]?.w ?? 0) + PAD + GUTTER + 2 } : pickLayout(sizes);
  await page.viewport(Math.max(layout.width, 1024), 900);
  await page.evaluate(`(() => {
    document.body.dataset.marks = "on";
    const perRow = document.querySelector("#per-row");
    if (perRow) { perRow.value = ${layout.columns}; perRow.dispatchEvent(new Event("input", { bubbles: true })); }
    scrollTo(0, 0);
  })()`);
  // The viewport as tall as the page, so the picture is one capture of what is laid out.
  const height = await page.evaluate(`document.documentElement.scrollHeight`);
  await page.viewport(Math.max(layout.width, 1024), Math.min(Math.ceil(height) + 16, 16000));
  await page.evaluate(`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`);

  /** @type {ReturnType<typeof JSON.parse>[]} */
  const frames = await page.evaluate(REPORT);
  const target = frameN ? `document.querySelectorAll("#rack .frame")[${frameN - 1}]` : `document.querySelector("#rack")`;
  const clip = await page.evaluate(`(() => { const r = ${target}.getBoundingClientRect(); return { x: Math.floor(r.left + scrollX), y: Math.floor(r.top + scrollY), width: Math.ceil(r.width), height: Math.ceil(r.height) }; })()`);
  fs.writeFileSync(outPath, await page.screenshot(clip));

  const blank = frames.map((f, i) => (f.painted ? 0 : i + 1)).filter(Boolean);
  const lines = [...errors, ...loads];
  for (const [i, f] of frames.entries()) {
    const at = `frame ${i + 1} "${f.title}":`;
    const px = (/** @type {{ dx: number; dy: number }} */ d) => [d.dx ? `${d.dx}px past the right` : "", d.dy ? `${d.dy}px past the bottom` : ""].filter(Boolean).join(" and ");
    for (const p of f.past.slice(0, 3)) lines.push(`${at} ${p.el} reaches ${px(p)} of the ${f.w}x${f.h} frame, where the frame clips it`);
    if (f.past.length > 3) lines.push(`${at} ${f.past.length - 3} more reach past the frame`);
    for (const t of f.tight.slice(0, 3)) lines.push(`${at} the content of ${t.el} reaches ${px(t)} of its own box, over whatever is there`);
    if (f.tight.length > 3) lines.push(`${at} ${f.tight.length - 3} more reach past their own box`);
    const clicks = f.marks.filter((/** @type {{ label: string }} */ m) => m.label === "click").length;
    if (clicks > 1) lines.push(`${at} ${clicks} click marks, where the kit asks for one per frame`);
    const marks = f.marks.map((/** @type {{ label: string; el: string; box: { x: number; y: number; w: number; h: number } | null; off: boolean }} */ m) =>
      !m.box
        ? `${m.label} mark on ${m.el}, which has no size, so no ring was drawn: an inline or absolutely placed child gives its wrapper none, so put ann() inside the element itself`
        : m.off
          ? `${m.label} mark on ${m.el}, which sits outside the frame, so its ring is clipped`
          : `${m.label} mark on ${m.el} at (${m.box.x},${m.box.y}) ${m.box.w}x${m.box.h}`,
    );
    if (marks.length) lines.push(`${at} ${marks.join("; ")}`);
    const drawn = f.marks.filter((/** @type {{ box: unknown; off: boolean }} */ m) => m.box && !m.off).length;
    if (f.rings !== drawn) lines.push(`${at} the page drew ${f.rings} rings for ${drawn} marks`);
  }
  for (const line of lines) console.log(line);
  const scale = frameN ? 1 : Math.round((frames.reduce((sum, f) => sum + f.s, 0) / frames.length) * 100) / 100;
  console.log(
    `${path.basename(pagePath)}: ${frames.length} frames${blank.length ? `, blank: ${blank.join(", ")}` : ", all drawn"}, ${errors.length} errors, ${loads.length} failed loads. ` +
      `${outPath} (${clip.width}x${clip.height}${frameN ? `, frame ${frameN} at true size` : `, ${layout.columns} per row at ${scale} of true size`})`,
  );
  process.exitCode = errors.length || blank.length ? 1 : 0;
} finally {
  close();
}
