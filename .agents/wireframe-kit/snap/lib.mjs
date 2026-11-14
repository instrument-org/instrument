// What the snapshot tools share: where the library is, the app's stylesheet scoped to a
// frame, a snapshot cleaned for a page, and a DOM to edit one in. A snapshot is Studio's
// own DOM in one state, captured by capture.mjs from a booted app; snap() in kit/snap.js
// draws a frame from one, edited by name.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);

/** The library: `SNAP_LIBRARY`, or `~/wireframes/snaps`. */
export const LIBRARY = process.env.SNAP_LIBRARY ?? path.join(os.homedir(), "wireframes/snaps");

/**
 * postcss and jsdom, from this checkout's install or, in a worktree with none, the main
 * checkout's. Both are already in the repo's store (Tailwind and the tests bring them).
 */
const depsRequire = (() => {
  /** @type {NodeJS.Require | undefined} */
  let req;
  return () => {
    if (req) return req;
    const roots = [path.resolve(here, "../../..")];
    try {
      const common = execFileSync("git", ["rev-parse", "--git-common-dir"], { cwd: here, encoding: "utf8" }).trim();
      roots.push(path.dirname(path.resolve(here, common)));
    } catch {}
    for (const root of roots) {
      const store = path.join(root, "node_modules/.pnpm/node_modules");
      if (fs.existsSync(path.join(store, "jsdom")) && fs.existsSync(path.join(store, "postcss"))) {
        req = createRequire(path.join(store, "_"));
        return req;
      }
    }
    throw new Error("snap: no jsdom and postcss in this checkout's node_modules or the main checkout's; run pnpm install");
  };
})();

/** A jsdom window, for editing snapshots outside a browser. */
export function domWindow() {
  const { JSDOM } = depsRequire()("jsdom");
  return new JSDOM("<!doctype html><html><body></body></html>").window;
}

/** `100vh`, `50dvw` and the like as frame units, which snap() sets on each frame. */
export const frameUnits = (/** @type {string} */ value) =>
  value.replace(/(-?\d*\.?\d+)(?:d|s|l)?v(h|w)\b/g, (_, n, axis) => `calc(${n} * var(--snap-v${axis}))`);

/**
 * The app's stylesheet scoped to `.snap`, the frame a snapshot is drawn in: `:root` and
 * `html` become the snapshot's `.snap-html`, `body` its `.snap-body`, and every other
 * selector is prefixed, so the app's rules reach only its own frames and nothing of the
 * page around them. Breakpoints become container queries on the frame, so a frame drawn
 * at 1280 wide lays out at 1280 on a phone too; viewport units become the frame's.
 * @font-face, @property and @keyframes stay global, since a shadow-free page has only
 * one place for them. Test ids are renamed, as in the HTML: content blockers hide
 * anything whose `data-testid` starts with "app", which is Studio's whole page.
 */
export function scopeSheet(/** @type {string} */ css) {
  const postcss = depsRequire()("postcss");
  const root = postcss.parse(css.replaceAll("data-testid", "data-tid"));
  root.walkAtRules((rule) => {
    if (rule.name !== "media") return;
    if (!/width/.test(rule.params) || /prefers-|hover|pointer|print|orientation|resolution/.test(rule.params)) return;
    rule.name = "container";
    rule.params = `snap ${rule.params.replace(/^\s*(?:only\s+)?screen\s+and\s+/, "")}`;
  });
  root.walkRules((rule) => {
    const parent = rule.parent;
    if (parent && parent.type === "atrule" && /keyframes$/.test(/** @type {any} */ (parent).name)) return;
    // A nested rule is relative to the one around it, which already carries the scope.
    for (let p = parent; p; p = /** @type {any} */ (p).parent) if (p.type === "rule") return;
    rule.selectors = rule.selectors.map((/** @type {string} */ sel) => {
      const swapped = sel
        .replace(/(^|[\s>~+(,])(?::root|html|:host)(?![\w-])/g, "$1.snap-html")
        .replace(/(^|[\s>~+(,])body(?![\w-])/g, "$1.snap-body");
      return `.snap ${swapped.trim()}`;
    });
  });
  root.walkDecls((decl) => {
    if (/v[hw]\b/.test(decl.value)) decl.value = frameUnits(decl.value);
  });
  return root.toString();
}

/** The classes a selector needs present: those outside :not(), :is(), :where() and :has(). */
const requiredClasses = (/** @type {string} */ selector) => {
  let s = selector;
  for (let i = 0; i < 4; i++) s = s.replace(/:(?:not|is|where|has)\((?:[^()]|\([^()]*\))*\)/g, "");
  const out = [];
  for (const m of s.matchAll(/\.((?:\\.|[\w-])+)/g)) {
    const name = m[1].replace(/\\(.)/g, "$1");
    if (name !== "snap" && name !== "snap-html" && name !== "snap-body") out.push(name);
  }
  return out;
};

/**
 * The scoped sheet with only the rules a page can use: a rule stays when one of its
 * selectors needs no class the page's frames lack. A dev build's sheet holds every
 * utility the app uses anywhere, about 420 KB; one page uses a few hundred of them.
 */
export function pruneSheet(/** @type {string} */ scoped, /** @type {Set<string>} */ classes) {
  const postcss = depsRequire()("postcss");
  const root = postcss.parse(scoped);
  root.walkRules((rule) => {
    const parent = rule.parent;
    if (parent && parent.type === "atrule" && /keyframes$/.test(/** @type {any} */ (parent).name)) return;
    if (process.env.SNAP_NO_PRUNE) return;
    const keep = rule.selectors.some((/** @type {string} */ sel) => requiredClasses(sel).every((c) => classes.has(c)));
    if (!keep) rule.remove();
  });
  // Blocks left with nothing in them.
  for (let i = 0; i < 4; i++) {
    root.walkAtRules((rule) => {
      if (rule.nodes && rule.nodes.length === 0 && rule.name !== "layer") rule.remove();
      else if (rule.name === "layer" && rule.nodes && rule.nodes.length === 0) rule.remove();
    });
  }
  return root.toString();
}

/** Every class token in some HTML. */
export const classTokens = (/** @type {string} */ html) => {
  const out = new Set();
  for (const m of html.matchAll(/class="([^"]*)"/g)) for (const t of m[1].split(/\s+/)) if (t) out.add(t);
  return out;
};

/** A state's files in the library: `<name>.html` the snapshot, `.png` its picture, `.outline.txt` its names. */
export const stateFile = (/** @type {string} */ name, /** @type {string} */ ext) => path.join(LIBRARY, "states", `${name}${ext}`);

/** @returns {{ w: number, h: number, theme: string, cls: string, html: string }} */
export function loadState(/** @type {string} */ name) {
  const file = stateFile(name, ".html");
  if (!fs.existsSync(file)) {
    const have = fs.existsSync(path.join(LIBRARY, "states"))
      ? fs.readdirSync(path.join(LIBRARY, "states")).filter((f) => f.endsWith(".html")).map((f) => f.slice(0, -5))
      : [];
    throw new Error(`snap("${name}"): the library at ${LIBRARY} has no such state. It has: ${have.join(", ") || "nothing yet (run snap/capture.mjs)"}`);
  }
  const text = fs.readFileSync(file, "utf8");
  const meta = JSON.parse(/<!--snap (\{.*?\})-->/.exec(text)?.[1] ?? "{}");
  return { ...meta, html: text.replace(/<!--snap \{.*?\}-->\n?/, "") };
}

/** The library's shared pieces: the scoped sheet, the fonts, the icon sprites. */
export function loadShared() {
  const read = (/** @type {string} */ f) => (fs.existsSync(path.join(LIBRARY, f)) ? fs.readFileSync(path.join(LIBRARY, f), "utf8") : "");
  return { sheet: read("sheet.css"), fonts: read("fonts.css"), sprites: read("sprites.html") };
}
