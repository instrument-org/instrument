import { z } from "zod";

/**
 * Runs in the page: its rendered text as compact Markdown for a fast model,
 * within `budget` characters, for ideas about what's open. Grown from
 * `READ_PAGE_TEXT`, but deterministic and private by construction:
 *
 * - Only what is rendered: a subtree that fails `checkVisibility`, is
 *   `aria-hidden` or `inert` is skipped, and so are cookie banners and ads.
 * - Never what the person typed: form controls, text fields and editable
 *   regions are left out whole (a password, a one-time code or a card number
 *   lives in one), and named only as "[text field]".
 * - Headings as `#`, list items as `-`, table rows as `| a | b |` with the
 *   first rows of each table, an image by its alt text, a canvas or video by
 *   name. Navigation, headers, footers and sidebars keep their first block.
 * - Blocks on screen first, then the rest in page order, cut at a block.
 *
 * Answers `canvas` for a page that is mostly a canvas with little text (a
 * canvas app), which a reader names rather than reads.
 */
export const distillPageScript = (budget: number) => `((budget) => {
  const fold = (words) => String(words ?? "").replace(/\\s+/g, " ").trim();
  const BLOCKISH = "address,article,aside,blockquote,dd,details,dialog,div,dl,dt,fieldset,figcaption,figure,footer,form,h1,h2,h3,h4,h5,h6,header,hr,li,main,nav,ol,p,pre,section,table,tr,ul";
  const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "HEAD", "INPUT", "TEXTAREA", "SELECT", "OPTION", "BUTTON", "OBJECT", "EMBED", "AUDIO", "svg"]);
  const NOISE = /cookie|consent|gdpr|advert|sponsor|\\bads?\\b|banner-ad|newsletter-popup/i;
  const LANDMARK = new Set(["NAV", "HEADER", "FOOTER", "ASIDE"]);
  const ROWS = 20;
  const vh = window.innerHeight;
  const blocks = [];
  const landmarkSeen = new Set();
  const tableRows = new Map();
  let canvasArea = 0;
  const push = (el, text) => {
    if (!text) return;
    const rect = el.getBoundingClientRect();
    blocks.push({ onScreen: rect.bottom > 0 && rect.top < vh && rect.width > 0, text });
  };
  const hidden = (el) =>
    el.getAttribute("aria-hidden") === "true" ||
    el.inert ||
    (typeof el.checkVisibility === "function" && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }));
  const typed = (el) =>
    el.isContentEditable || el.getAttribute("role") === "textbox" || el.getAttribute("role") === "searchbox";
  const noise = (el) => NOISE.test(String(el.id || "") + " " + String(typeof el.className === "string" ? el.className : "")) || /advertisement/i.test(el.getAttribute("aria-label") || "");
  const landmarkOf = (el) => {
    for (let at = el; at; at = at.parentElement) {
      if (LANDMARK.has(at.tagName) || ["navigation", "banner", "contentinfo", "complementary"].includes(at.getAttribute?.("role"))) return at;
    }
    return null;
  };
  const walk = (el) => {
    if (blocks.length > 3000) return;
    const tag = el.tagName;
    if (SKIP.has(tag) || SKIP.has(tag.toLowerCase())) return;
    if (hidden(el)) return;
    if (typed(el)) { push(el, "[text field]"); return; }
    if (noise(el)) return;
    if (tag === "IFRAME") {
      try { push(el, "[frame: " + new URL(el.src).host + "]"); } catch {}
      return;
    }
    if (tag === "CANVAS") {
      const rect = el.getBoundingClientRect();
      canvasArea += Math.max(0, rect.width) * Math.max(0, rect.height);
      push(el, "[canvas]");
      return;
    }
    if (tag === "VIDEO") { push(el, "[video" + (el.title ? ": " + fold(el.title) : "") + "]"); return; }
    if (tag === "IMG") {
      const alt = fold(el.getAttribute("alt"));
      if (alt && el.width >= 80 && el.height >= 40) push(el, "[image: " + alt + "]");
      return;
    }
    const landmark = landmarkOf(el);
    if (landmark && landmarkSeen.has(landmark) && landmark !== el) return;
    if (tag === "TR") {
      const table = el.closest("table");
      const count = (tableRows.get(table) ?? 0) + 1;
      tableRows.set(table, count);
      if (count <= ROWS) {
        const cells = [...el.children].filter((cell) => !hidden(cell)).map((cell) => fold(cell.innerText));
        if (cells.some(Boolean)) push(el, "| " + cells.join(" | ") + " |");
      } else if (count === ROWS + 1) {
        const total = table ? table.querySelectorAll("tr").length : count;
        push(el, "(" + (total - ROWS) + " more rows)");
      }
      return;
    }
    const leaf = !el.querySelector(BLOCKISH) && !el.querySelector("input, textarea, select, [contenteditable=''], [contenteditable='true'], [role=textbox]");
    if (leaf) {
      const text = fold(el.innerText);
      if (!text) return;
      const level = /^H([1-6])$/.exec(tag);
      push(el, level ? "#".repeat(Number(level[1])) + " " + text : tag === "LI" ? "- " + text : text);
      if (landmark) landmarkSeen.add(landmark);
      return;
    }
    // Words straight inside a container that also holds blocks.
    const own = fold([...el.childNodes].filter((node) => node.nodeType === 3).map((node) => node.textContent).join(" "));
    if (own.length > 1) push(el, own);
    for (const child of el.children) walk(child);
    if (landmark === el) landmarkSeen.add(el);
  };
  if (document.body) walk(document.body);
  const textChars = blocks.reduce((sum, block) => sum + block.text.length, 0);
  const canvas = canvasArea > window.innerWidth * vh * 0.5 && textChars < 400;
  const ordered = [...blocks.filter((block) => block.onScreen), ...blocks.filter((block) => !block.onScreen)];
  const kept = new Set();
  let used = 0;
  for (const block of ordered) {
    if (used + block.text.length + 1 > budget) break;
    kept.add(block);
    used += block.text.length + 1;
  }
  const selection = fold(String(window.getSelection?.() ?? "")).slice(0, 2000);
  const text = blocks.filter((block) => kept.has(block)).map((block) => block.text).join("\\n");
  return { canvas, cut: kept.size < blocks.length, selection, text };
})(${JSON.stringify(budget)})`;

const DistilledSchema = z.object({
  canvas: z.boolean(),
  cut: z.boolean(),
  selection: z.string(),
  text: z.string(),
});

/** A page's distilled text, or why it can't be read, from what the script answered. */
export function distilledPageOf(
  raw: unknown,
): { text: string } | { unreadable: string } {
  const parsed = DistilledSchema.safeParse(raw);
  if (!parsed.success) {
    return { unreadable: "the page didn't answer" };
  }
  const { canvas, cut, selection, text } = parsed.data;
  if (canvas) {
    return {
      unreadable: selection
        ? `a canvas app, with "${selection}" selected`
        : "a canvas app",
    };
  }
  if (!text) {
    return { unreadable: "the page shows no text" };
  }
  return {
    text:
      (selection ? `Selected: "${selection}"\n\n` : "") +
      text +
      (cut ? "\n…" : ""),
  };
}
