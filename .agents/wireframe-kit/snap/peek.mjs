// node .agents/wireframe-kit/snap/peek.mjs <state> [<target>] [--depth n]
// Shows one element of a library state as compact HTML, found by the wireframe skill's
// own snap() in a headless Chromium (chrome.mjs), so a part can clone it, restyle it or
// write new markup in its classes without reading the whole snapshot. <target> is the
// element's words ("What's new") or a JSON target ('{"role":"button","text":"Send"}');
// with none, the page's body. Pictures and icons print as stubs; children past --depth
// (3) as a count.
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { launch } from "../chrome.mjs";
import { SKILL } from "../kit.mjs";
import { loadState } from "./lib.mjs";

const { positionals, values } = parseArgs({ allowPositionals: true, options: { depth: { type: "string" } } });
const [state, targetArg] = positionals;
if (!state) throw new Error("usage: node peek.mjs <state> [<words or JSON target>] [--depth n]");
const depth = Number(values.depth ?? 3);
const target = targetArg ? (targetArg.trim().startsWith("{") ? JSON.parse(targetArg) : targetArg) : null;
const pages = { [state]: loadState(state) };
const runtime = fs.readFileSync(path.join(SKILL, "snapshot-frames.js"), "utf8");

/** Runs in the page: the element snap()'s $ finds, printed. */
const SHOW = `(() => {
  const SKIP = new Set(["style", "data-snapshot-scroll", "data-tid", "tabindex", "aria-hidden", "data-state", "dir"]);
  const show = (node, level, pad) => {
    if (node.nodeType === 3) {
      const t = node.nodeValue.replace(/\\s+/g, " ").trim();
      return t ? pad + (t.length > 120 ? t.slice(0, 120) + "…" : t) + "\\n" : "";
    }
    if (node.nodeType !== 1) return "";
    const tag = node.tagName.toLowerCase();
    const attrs = [...node.attributes]
      .filter((a) => !SKIP.has(a.name) && !a.name.startsWith("data-radix"))
      .map((a) => " " + a.name + '="' + (a.value.startsWith("data:") ? "data:…" : a.value.length > 400 ? a.value.slice(0, 400) + "…" : a.value) + '"')
      .join("");
    if (tag === "svg") return pad + "<svg" + attrs.replace(/ (xmlns|viewBox|fill|width|height)="[^"]*"/g, "") + ">…</svg>\\n";
    const kids = [...node.childNodes].filter((c) => c.nodeType === 1 || (c.nodeType === 3 && c.nodeValue.trim()));
    if (kids.length === 0) return pad + "<" + tag + attrs + "></" + tag + ">\\n";
    if (level >= ${depth}) return pad + "<" + tag + attrs + ">…" + kids.length + " inside…</" + tag + ">\\n";
    return pad + "<" + tag + attrs + ">\\n" + kids.map((k) => show(k, level + 1, pad + "  ")).join("") + pad + "</" + tag + ">\\n";
  };
  let el;
  snap(${JSON.stringify(state)}, ($) => { el = ${target ? `$(${JSON.stringify(target)}).el` : "$.root.el"}; });
  return show(el, 0, "");
})()`;

const { page, close } = await launch();
try {
  const data = JSON.stringify({ sheets: {}, pages }).replace(/</g, "\\u003c");
  await page.evaluate(`(() => {
    const s = document.createElement("script");
    s.type = "application/json";
    s.id = "wireframe-snapshots";
    s.textContent = ${JSON.stringify(data)};
    document.head.append(s);
  })()`);
  await page.evaluate(runtime);
  process.stdout.write(await page.evaluate(SHOW));
} finally {
  close();
}
