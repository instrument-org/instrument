// What build.mjs and measure/ share: where the wireframe skill is, the kit's files in the
// order they are pasted, and evaluating a part against them in Node.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";

import { domWindow, loadState } from "./snap/lib.mjs";

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
  "snap.js",
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
 * Globals a part may reach for that the browser and Node both define. A part runs here
 * at build time and on the page in the browser, so its context gets what both have,
 * from Node's own, and nothing Node-only (process, require, Buffer).
 */
const PAGE_GLOBALS = [
  "URL",
  "URLSearchParams",
  "TextEncoder",
  "TextDecoder",
  "structuredClone",
  "crypto",
  "performance",
  "queueMicrotask",
  "atob",
  "btoa",
  "console",
];
/** @type {ReturnType<typeof domWindow> | undefined} */
let snapWindow;
// snap() reads its library and edits in a DOM only here, in Node; the page gets the result.
const snapHost = {
  doc: () => (snapWindow ??= domWindow()).document,
  load: loadState,
};
const pageContext = () =>
  vm.createContext({
    ...Object.fromEntries(
      PAGE_GLOBALS.map((name) => [name, Reflect.get(globalThis, name)]),
    ),
    __snapHost: snapHost,
  });

/** A declaration at the start of a line: `const x`, `let x`, `var x`, `function x`, `class x`. */
const DECLARATION =
  /^(?:(?:const|let|var|class)\s+|(?:async\s+)?function(?:\s*\*\s*|\s+))([A-Za-z_$][\w$]*)/;

/**
 * The names a source declares at its top level, each with the line it sits on. Top
 * level is the column `indent` puts it at: the margin in a kit file or a part, the
 * script's own indent in a template.
 * @returns {Map<string, number>}
 */
const declarations = (/** @type {string} */ src, indent = "") => {
  /** @type {Map<string, number>} */
  const out = new Map();
  src.split("\n").forEach((line, i) => {
    const m =
      line.startsWith(indent) && DECLARATION.exec(line.slice(indent.length));
    if (m && !out.has(m[1])) out.set(m[1], i + 1);
  });
  return out;
};

/**
 * The names the template declares in the scope a part shares: its script outside the
 * stretches the build replaces (the kit and the part), and outside the render code
 * when the template keeps that in a block of its own. Lines are the template's.
 */
const templateDeclarations = (
  /** @type {string} */ main,
  /** @type {boolean} */ prototype,
) => {
  const lines = main.split("\n");
  const at = (/** @type {string} */ marker, from = 0) =>
    lines.findIndex((l, i) => i >= from && l.includes(marker));
  const script = at('<script type="module">');
  const render = at("// ---- render");
  const scoped =
    lines
      .slice(render + 1)
      .find((l) => !/^\s*(?:\/\/|$)/.test(l))
      ?.trim() === "{";
  const outside = [
    [0, script],
    [at("// ---- the kit"), at("// ---- annotations")],
    [at(prototype ? "// ---- the screen" : "// ---- the frames"), render],
    [scoped ? render : at("</script>", script), lines.length],
  ];
  const shared = lines
    .map((l, i) => (outside.some(([a, b]) => i >= a && i < b) ? "" : l))
    .join("\n");
  return declarations(shared, /^\s*/.exec(lines[at("// ---- the kit")])?.[0]);
};

/**
 * Runs the kit, the template's marks and a part in Node and hands back its META and
 * frames, so a broken frame fails here rather than on screen. A prototype comes back
 * as one frame of its screen. `name` is what an error calls the part.
 * @returns {{ META: Meta; states: Frame[] }}
 */
export function evaluatePart(/** @type {string} */ part, name = "part.js") {
  const prototype = isPrototype(part);
  const main = template(prototype);
  const templateFile = path.join(SKILL, prototype ? "prototype.html" : "main.html");
  const marksAt = main.indexOf("// ---- annotations");
  const marks = main.slice(
    marksAt,
    main.indexOf(prototype ? "// ---- the screen" : "// ---- the frames"),
  );
  // The kit, the template and the part share one scope, so a name the part declares
  // that either already has is a SyntaxError on the page; say which, and where.
  const kit = KIT_FILES.map((f) => ({
    file: `kit/${f}`,
    text: fs.readFileSync(path.join(here, "kit", f), "utf8"),
  }));
  /** @type {Map<string, string>} */
  const declared = new Map();
  for (const { file, text } of kit)
    for (const [n, line] of declarations(text))
      if (!declared.has(n)) declared.set(n, `${file}:${line}`);
  for (const [n, line] of templateDeclarations(main, prototype))
    if (!declared.has(n)) declared.set(n, `${templateFile}:${line}`);
  const taken = [...declarations(part)].filter(([n]) => declared.has(n));
  if (taken.length > 0)
    throw new Error(
      `the part declares names its page already has; the kit, the skill's template and the part share one scope, so each is a SyntaxError there:\n${taken.map(([n, line]) => `  ${name}:${line} ${n} is already declared at ${declared.get(n)}`).join("\n")}\nUse the kit's piece (see KIT.md) and delete the part's, or rename the part's.`,
    );
  // One script, as on the page. Each piece keeps the file and line it came from, so an
  // error names the part's or a kit file's own line rather than the script's.
  const pieces = [
    ...kit.map((k) => ({ ...k, line: 1 })),
    {
      file: templateFile,
      text: marks,
      line: main.slice(0, marksAt).split("\n").length,
    },
    {
      file: name,
      text: prototype
        ? `${part}\n;globalThis.__out = { META, states: [{ title: "Screen", note: "The prototype's screen", body: SCREEN.draw() + (SCREEN.controls ? SCREEN.controls() : ""), w: SCREEN.w, h: SCREEN.h }] };`
        : `${part}\n;globalThis.__out = { META, states };`,
      line: 1,
    },
  ];
  const starts = [1];
  for (const p of pieces)
    starts.push(starts[starts.length - 1] + p.text.split("\n").length);
  const locate = (/** @type {number} */ l) => {
    const i = Math.min(
      starts.findLastIndex((s) => s <= l),
      pieces.length - 1,
    );
    return `${pieces[i].file}:${pieces[i].line + l - starts[i]}`;
  };
  /** @type {{ __out?: { META: Meta; states: Frame[] } }} */
  const ctx = pageContext();
  try {
    vm.runInContext(pieces.map((p) => p.text).join("\n"), ctx, {
      filename: "kit+marks+part",
    });
  } catch (error) {
    // The error stays what it was, its places renamed to the files they are in.
    if (
      typeof error === "object" &&
      error !== null &&
      "stack" in error &&
      typeof error.stack === "string"
    )
      error.stack = error.stack.replace(/kit\+marks\+part:(\d+)/g, (_, l) =>
        locate(Number(l)),
      );
    throw error;
  }
  if (!ctx.__out)
    throw new Error(
      `the part defined no META or ${prototype ? "SCREEN" : "states"}`,
    );
  // A missing argument or a size that was never set leaves `undefined` or `NaN` in the
  // page's text, often with a unit on it (`${h}px`). Only the bare word counts: inside
  // a longer one it is copy or base64, which once failed a build over a screenshot.
  const leak =
    /\b(?:undefined|NaN)(?:px|em|rem|vh|vw|dvh|ch|deg|ms|s|fr)?\b|\[object Object\]/;
  for (const [i, s] of ctx.__out.states.entries()) {
    const frame = `frame ${i + 1}${s.title ? ` "${s.title}"` : ""}`;
    if (typeof s.body !== "string") throw new Error(`${frame} has no body`);
    if (!s.title || !s.note) throw new Error(`${frame} lacks a title or note`);
    for (const [field, text] of [
      ["title", s.title],
      ["note", s.note],
      ["body", s.body],
    ]) {
      // A snapshot's pictures are base64, where "NaN" can stand between a + and a /.
      const hit = leak.exec(text.replace(/data:[^"')\s]+/g, ""));
      if (hit)
        throw new Error(
          `${frame} renders the text "${hit[0]}" in its ${field}: …${text
            .slice(Math.max(0, hit.index - 80), hit.index + hit[0].length + 80)
            .replace(/\s+/g, " ")}…`,
        );
    }
    for (const [side, size] of [
      ["w", s.w],
      ["h", s.h],
    ]) {
      if (
        size !== undefined &&
        !(typeof size === "number" && size > 0 && Number.isFinite(size))
      )
        throw new Error(
          `${frame} has ${side}: ${String(size)}; w and h are pixel counts above zero, or left out for the template's default`,
        );
    }
  }
  return Object.assign(ctx.__out, {
    snaps: /** @type {{ state: string, html: string, base: string }[]} */ (
      Reflect.get(ctx, "__snapBuilt") ?? []
    ),
  });
}

/** A value the kit defines (`kitValue("FOLDER_ROWS")`), run in Node and handed back as JSON. */
export function kitValue(/** @type {string} */ expression) {
  /** @type {{ __value?: string }} */
  const ctx = pageContext();
  vm.runInContext(
    `${kitSource()}\n;globalThis.__value = JSON.stringify(${expression});`,
    ctx,
  );
  return JSON.parse(ctx.__value ?? "null");
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
