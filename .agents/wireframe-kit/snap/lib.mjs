// What the snapshot tools share: where the library is and how a state is read from it.
// A state is Studio's own page in one state, kept whole by the wireframe skill's
// snapshot.js as capture.mjs drove a booted app there; snap() in kit/snap.js draws a
// frame from one through the skill's snapshot frames.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** The library: `SNAP_LIBRARY`, or `~/wireframes/snaps`. */
export const LIBRARY = process.env.SNAP_LIBRARY ?? path.join(os.homedir(), "wireframes/snaps");

/** A state's files in the library: `<name>.json` the snapshot, `.png` its picture, `.outline.txt` its names. */
export const stateFile = (/** @type {string} */ name, /** @type {string} */ ext) => path.join(LIBRARY, "states", `${name}${ext}`);

/** The library's states, by name. */
export const stateNames = () =>
  fs.existsSync(path.join(LIBRARY, "states"))
    ? fs
        .readdirSync(path.join(LIBRARY, "states"))
        .filter((f) => f.endsWith(".json"))
        .map((f) => f.slice(0, -5))
    : [];

/**
 * A state as the skill's snapshot.js returned it: `{ w, h, url, title, bg, notes, html }`.
 * @returns {{ w: number, h: number, url: string, title: string, bg: string, notes: string[], html: string }}
 */
export function loadState(/** @type {string} */ name) {
  const file = stateFile(name, ".json");
  if (!fs.existsSync(file))
    throw new Error(
      `snap("${name}"): the library at ${LIBRARY} has no such state. It has: ${stateNames().join(", ") || "nothing yet (run snap/capture.mjs, then snap/library.mjs)"}`,
    );
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/**
 * The CSS split into its top-level items, each `{ head, body }` for a block (`body`
 * null for a statement such as `@import`), reading Chromium's serialized CSS: quoted
 * strings and comments may hold braces.
 */
const cssItems = (/** @type {string} */ css) => {
  const items = [];
  let i = 0;
  const n = css.length;
  while (i < n) {
    while (i < n && /\s/.test(css[i])) i++;
    if (i >= n) break;
    const start = i;
    let depth = 0;
    let open = -1;
    for (; i < n; i++) {
      const c = css[i];
      if (c === '"' || c === "'") {
        for (i++; i < n && css[i] !== c; i++) if (css[i] === "\\") i++;
      } else if (c === "/" && css[i + 1] === "*") {
        const end = css.indexOf("*/", i + 2);
        i = end < 0 ? n : end + 1;
      } else if (c === "\\") i++;
      else if (c === "{") {
        if (depth++ === 0) open = i;
      } else if (c === "}") {
        if (--depth === 0) {
          i++;
          break;
        }
      } else if (c === ";" && depth === 0) {
        i++;
        break;
      }
    }
    const text = css.slice(start, i);
    items.push(open < 0 ? { head: text.trim(), body: null } : { head: css.slice(start, open).trim(), body: css.slice(open + 1, i - 1) });
  }
  return items;
};

/** The classes a selector needs present: those outside :not(), :is(), :where() and :has(). */
const requiredClasses = (/** @type {string} */ selector) => {
  let s = selector;
  for (let k = 0; k < 4; k++) s = s.replace(/:(?:not|is|where|has)\((?:[^()]|\([^()]*\))*\)/g, "");
  return [...s.matchAll(/\.((?:\\.|[\w-])+)/g)].map((m) => m[1].replace(/\\(.)/g, "$1"));
};

/** Splits a selector list on its top-level commas. */
const selectors = (/** @type {string} */ list) => {
  const out = [];
  let depth = 0;
  let from = 0;
  for (let k = 0; k < list.length; k++) {
    const c = list[k];
    if (c === "\\") k++;
    else if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (c === "," && depth === 0) {
      out.push(list.slice(from, k));
      from = k + 1;
    }
  }
  return [...out, list.slice(from)];
};

/**
 * A stylesheet cut to the rules a page can use: a style rule stays when one of its
 * selectors needs no class outside `classes`, and a grouping rule (@layer, @media,
 * @supports, @container) keeps what stays inside it. Everything else stays: @font-face,
 * @keyframes, @property, element and attribute rules. A dev build's sheet holds every
 * utility the app uses anywhere; one page uses a few hundred.
 */
export function trimSheet(/** @type {string} */ css, /** @type {Set<string>} */ classes) {
  const out = [];
  for (const { head, body } of cssItems(css)) {
    if (body === null) out.push(head);
    else if (head.startsWith("@")) {
      if (/^@(?:layer|media|supports|container|scope|document)\b/.test(head)) {
        const inner = trimSheet(body, classes);
        if (inner.trim() || /^@layer\b/.test(head)) out.push(`${head} {\n${inner}\n}`);
      } else out.push(`${head} {${body}}`);
    } else if (selectors(head).some((sel) => requiredClasses(sel).every((c) => classes.has(c)))) out.push(`${head} {${body}}`);
  }
  return out.join("\n");
}

/**
 * Every word a page might use as a class: the class attributes of the states it draws
 * and every class-shaped token in the part and the kit, since a part's edits run in the
 * page and may write markup in classes no captured state has.
 */
export function pageClasses(/** @type {string[]} */ htmls, /** @type {string[]} */ sources) {
  const out = new Set();
  for (const html of htmls) for (const m of html.matchAll(/\bclass="([^"]*)"/g)) for (const t of m[1].split(/\s+/)) if (t) out.add(t);
  for (const src of sources) for (const m of src.matchAll(/[\w:/.[\]%!@&>*=()#,'-]+/g)) for (const t of m[0].split(/["'`]/)) if (t) out.add(t);
  return out;
}

/** A state's page with each of its stylesheets cut to `classes`. */
export const trimState = (/** @type {string} */ html, /** @type {Set<string>} */ classes) =>
  html.replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/g, (_, open, css, close) => open + trimSheet(css, classes) + close);
