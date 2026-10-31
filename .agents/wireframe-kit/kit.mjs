// What build.mjs and measure/ share: where the wireframe skill is, the kit's files in the
// order they are pasted, and evaluating a part against them in Node.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";

export const here = path.dirname(new URL(import.meta.url).pathname);

export const SKILL =
  process.env.WIREFRAME_SKILL_DIR ??
  path.join(os.homedir(), ".claude/skills/wireframe");

/**
 * The kit, in the order it is pasted into a page's script. A file's top-level
 * values may use only the files before it; its functions may call any of them,
 * since nothing is drawn until the part runs after the whole kit.
 */
export const KIT_FILES = [
  "brands.js",
  "marks.js",
  "controls.js",
  "scenario.js",
  "window.js",
  "inbox.js",
  "chat.js",
  "omnibar.js",
  "files.js",
  "browser.js",
  "places.js",
  "floating.js",
  "compose.js",
  "picker.js",
  "overlays.js",
  "settings.js",
  "setup.js",
  "mac.js",
];

export const kitSource = () =>
  KIT_FILES.map((f) => fs.readFileSync(path.join(here, "kit", f), "utf8")).join(
    "\n",
  );

/** Whether a part builds a prototype (it defines SCREEN) rather than frames. */
export const isPrototype = (/** @type {string} */ part) =>
  /^const SCREEN\s*=/m.test(part);

/** The skill's page template a part is pasted into. */
export const template = (/** @type {boolean} */ prototype) =>
  fs.readFileSync(
    path.join(SKILL, prototype ? "prototype.html" : "main.html"),
    "utf8",
  );

/**
 * @typedef {{ title: string; line: string; source: string; slotH?: number; tileMin?: number }} Meta
 * @typedef {{ title: string; note: string; body: string; w?: number; h?: number; measure?: string }} Frame
 */

/**
 * Runs the kit, the template's marks and a part in Node and hands back its META and
 * frames, so a broken frame fails here rather than on screen. A prototype comes back
 * as one frame of its screen.
 * @returns {{ META: Meta; states: Frame[] }}
 */
export function evaluatePart(/** @type {string} */ part) {
  const prototype = isPrototype(part);
  const main = template(prototype);
  const marks = main.slice(
    main.indexOf("// ---- annotations"),
    main.indexOf(prototype ? "// ---- the screen" : "// ---- the frames"),
  );
  // A part and the kit share one scope, so a helper a part defines under a name the kit
  // has since taken is a SyntaxError; say which, and what to do, rather than that.
  const names = (/** @type {string} */ src) =>
    new Set(
      Array.from(
        src.matchAll(/^(?:const|let|function)\s+([A-Za-z_$][\w$]*)/gm),
        (m) => m[1],
      ),
    );
  const kitNames = names(kitSource());
  const taken = [...names(part)].filter((n) => kitNames.has(n));
  if (taken.length > 0)
    throw new Error(
      `the part defines ${taken.join(", ")}, which the kit now draws: use the kit's (see KIT.md) and delete the part's, or rename the part's`,
    );
  /** @type {{ __out?: { META: Meta; states: Frame[] } }} */
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(
    prototype
      ? `${kitSource()}\n${marks}\n${part}\n;globalThis.__out = { META, states: [{ title: "Screen", note: "The prototype's screen", body: SCREEN.draw() + (SCREEN.controls ? SCREEN.controls() : ""), w: SCREEN.w, h: SCREEN.h }] };`
      : `${kitSource()}\n${marks}\n${part}\n;globalThis.__out = { META, states };`,
    ctx,
  );
  if (!ctx.__out)
    throw new Error(
      `the part defined no META or ${prototype ? "SCREEN" : "states"}`,
    );
  for (const [i, s] of ctx.__out.states.entries()) {
    if (typeof s.body !== "string")
      throw new Error(`frame ${i + 1} has no body`);
    if (/undefined|\[object Object\]|NaN/.test(s.body))
      throw new Error(`frame ${i + 1} renders undefined/object/NaN`);
    if (!s.title || !s.note)
      throw new Error(`frame ${i + 1} lacks a title or note`);
  }
  return ctx.__out;
}

/**
 * A page of frames alone at true size, one under another, each in a section with an
 * id of `f<n>`: for a kit check, and for measure/ to take pictures of.
 */
export function rawPage(/** @type {Frame[]} */ frames) {
  const starter = fs.readFileSync(path.join(SKILL, "shell.html"), "utf8");
  const body = frames
    .map(
      (s, i) =>
        `<section id="f${i + 1}" style="position:relative;width:${s.w || 1280}px;height:${s.h || 800}px;overflow:hidden;margin-bottom:24px">${s.body}</section>`,
    )
    .join("\n");
  return starter.replace(
    /<main class="[^"]*">[\s\S]*?<\/main>/,
    () => `<main style="padding:0">${body}</main>`,
  );
}
