// The vocabulary, read from the `@word` comments beside each word's code in
// words.mjs, so what SKILL.md lists and what the code does cannot drift
// apart (vocabulary.test.mjs checks SKILL.md against it).

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Every name a words run has in scope. words.test.mjs checks it against createWords. */
export const WORD_NAMES = [
  "app",
  "button",
  "burst",
  "cdp",
  "chat",
  "click",
  "commandMenu",
  "composer",
  "control",
  "dialog",
  "drag",
  "dropFiles",
  "errors",
  "expect",
  "field",
  "files",
  "find",
  "goto",
  "group",
  "groups",
  "heading",
  "item",
  "js",
  "link",
  "look",
  "menu",
  "model",
  "omnibar",
  "page",
  "paste",
  "press",
  "row",
  "rpc",
  "see",
  "seed",
  "settings",
  "settle",
  "shot",
  "side",
  "sidebar",
  "size",
  "state",
  "tab",
  "tabs",
  "theme",
  "toast",
  "toggle",
  "type",
  "until",
  "window",
  "windows",
];

const SOURCE = path.join(path.dirname(fileURLToPath(import.meta.url)), "words.mjs");

/** The `@word` lines of words.mjs, in the order they appear, as Markdown list items. */
export function vocabulary(source = readFileSync(SOURCE, "utf8")) {
  const lines = [];
  for (const match of source.matchAll(/@word\s+([\s\S]*?)(?:\*\/|\n\s*\*\s*\n)/g)) {
    const text = match[1]
      .split("\n")
      .map((line) => line.replace(/^\s*\*\s?/, "").trim())
      .join(" ")
      .trim();
    const split = /^(.+?):\s+(.*)$/.exec(text);
    lines.push(split ? `- \`${split[1]}\`: ${split[2]}` : `- \`${text}\``);
  }
  return lines.join("\n");
}
