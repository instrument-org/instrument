// node .agents/wireframe-kit/snap/peek.mjs <state> [<target>] [--depth n]
// Shows one element of a snapshot as compact HTML, found the way snap()'s $(target)
// finds it, so a part can clone it, restyle it or write new markup in its classes
// without reading the whole snapshot. <target> is the element's words ("What's new") or
// a JSON target ('{"role":"button","text":"Send"}'); with none, the snapshot's top
// levels. Pictures and icons print as stubs; children past --depth (3) as a count.
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import vm from "node:vm";

import { domWindow, loadState } from "./lib.mjs";

const here = path.dirname(new URL(import.meta.url).pathname);
const { positionals, values } = parseArgs({ allowPositionals: true, options: { depth: { type: "string" } } });
const [state, targetArg] = positionals;
if (!state) throw new Error("usage: node peek.mjs <state> [<words or JSON target>] [--depth n]");
const depth = Number(values.depth ?? 3);
const doc = domWindow().document;
const root = doc.createElement("div");
root.innerHTML = loadState(state).html;

/** @type {any} */
const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(here, "../kit/snap.js"), "utf8") + "\n;globalThis.__find = __snapFind;", ctx);
const target = targetArg ? (targetArg.trim().startsWith("{") ? JSON.parse(targetArg) : targetArg) : null;
const el = target ? ctx.__find(root, target, state) : root.firstElementChild;

const SKIP = new Set(["style", "data-still-scroll", "data-tid", "tabindex", "aria-hidden", "data-state", "dir"]);
const show = (/** @type {any} */ node, /** @type {number} */ level, /** @type {string} */ pad) => {
  if (node.nodeType === 3) {
    const t = node.nodeValue.replace(/\s+/g, " ").trim();
    return t ? `${pad}${t.length > 120 ? `${t.slice(0, 120)}…` : t}\n` : "";
  }
  if (node.nodeType !== 1) return "";
  const tag = node.tagName.toLowerCase();
  const attrs = [...node.attributes]
    .filter((a) => !SKIP.has(a.name) && !a.name.startsWith("data-radix"))
    .map((a) => ` ${a.name}="${a.value.startsWith("data:") ? "data:…" : a.value.length > 400 ? `${a.value.slice(0, 400)}…` : a.value}"`)
    .join("");
  if (tag === "svg") return `${pad}<svg${attrs.replace(/ (xmlns|viewBox|fill|width|height)="[^"]*"/g, "")}>…</svg>\n`;
  const kids = [...node.childNodes].filter((c) => c.nodeType === 1 || (c.nodeType === 3 && c.nodeValue.trim()));
  if (kids.length === 0) return `${pad}<${tag}${attrs}></${tag}>\n`;
  if (level >= depth) return `${pad}<${tag}${attrs}>…${kids.length} inside…</${tag}>\n`;
  return `${pad}<${tag}${attrs}>\n${kids.map((k) => show(k, level + 1, `${pad}  `)).join("")}${pad}</${tag}>\n`;
};
process.stdout.write(show(el, 0, ""));
