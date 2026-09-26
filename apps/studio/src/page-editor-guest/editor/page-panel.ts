/**
 * The Page panel: page-wide look through the tokens in the page's own
 * `@theme` block (accent ramp, corner radius, body font, spacing density).
 * Every change is a new value for a few `--token: value;` declarations, in the
 * @theme block and in the compiled copy of it (`<style data-tailwind="compiled">`)
 * so the file renders the same with scripts off. The live page follows by
 * getting the block's new text, which the Tailwind browser build recompiles.
 */
import { closestIn, findAs } from "./dom";
import {
  type Analysis,
  type PageSourceEntry,
  type Range,
  type Splice,
} from "./source";

export interface PagePanelContext {
  colorOf: (name: string) => string;
  onPreview: (sets: TokenSet[]) => void;
  onSet: (sets: TokenSet[], label: string) => void;
  page: null | PageTokens;
}

/** Where the page keeps its tokens, and their current values. */
export interface PageTokens {
  /** The @theme block first, then its compiled copy when the page has one. */
  blocks: [TokenBlock, ...TokenBlock[]];
  /** The brand ramp's token names, as declared. */
  brand: string[];
  families: { axes: string; name: string }[];
  tokens: Map<string, string>;
}

/** A token's name (without `--`) and its new value. */
export type TokenSet = [name: string, value: string];

/** A block of token declarations: its entry and the body between its braces. */
interface TokenBlock extends Range {
  entry: PageSourceEntry;
}

// ------------------------------------------------------------------ reading

const attr = (entry: PageSourceEntry, name: string) =>
  entry.node.attrs.find((a) => a.name === name)?.value;
const innerOf = (entry: PageSourceEntry): Range => ({
  end: entry.loc.endTag?.startOffset ?? entry.loc.endOffset,
  start: entry.loc.startTag.endOffset,
});

interface Oklch {
  C: number;
  H: number;
  L: number;
}

/** The @theme block's style text with `sets` applied (for a live preview). */
export function previewText(A: Analysis, page: PageTokens, sets: TokenSet[]) {
  const [theme] = page.blocks;
  const inner = innerOf(theme.entry);
  let text = A.src.slice(inner.start, inner.end);
  const sp = tokenSplices(A, [theme], sets).sort((a, b) => b.start - a.start);
  for (const s of sp) {
    text =
      text.slice(0, s.start - inner.start) +
      s.text +
      text.slice(s.end - inner.start);
  }
  return text;
}

/** Where the page keeps its tokens, and their current values. Null when it has no @theme block. */
export function readPage(A: Analysis): null | PageTokens {
  const tw = A.entries.find(
    (e) =>
      e.tag === "style" &&
      attr(e, "type") === "text/tailwindcss" &&
      e.loc.endTag,
  );
  if (!tw) {
    return null;
  }
  const twIn = innerOf(tw);
  const text = A.src.slice(twIn.start, twIn.end);
  const open = /@theme\b[^{]*\{/.exec(text);
  if (!open) {
    return null;
  }
  const theme: TokenBlock = {
    entry: tw,
    ...blockRange(A.src, twIn.start + open.index + open[0].length),
  };
  const blocks: PageTokens["blocks"] = [theme];
  const floor = A.entries.find(
    (e) =>
      e.tag === "style" &&
      attr(e, "data-tailwind") === "compiled" &&
      e.loc.endTag,
  );
  if (floor) {
    const fIn = innerOf(floor);
    const m = /:root,\s*:host\s*\{/.exec(A.src.slice(fIn.start, fIn.end));
    if (m) {
      blocks.push({
        entry: floor,
        ...blockRange(A.src, fIn.start + m.index + m[0].length),
      });
    }
  }
  const tokens = new Map<string, string>();
  for (const m of A.src
    .slice(theme.start, theme.end)
    .matchAll(/--([a-z0-9-]+)\s*:([^;]+);/gi)) {
    if (m[1] !== undefined && m[2] !== undefined) {
      tokens.set(m[1], m[2].trim());
    }
  }
  const brand = [...tokens.keys()].filter((k) => /^color-brand-\d+$/.test(k));
  // Families the page already loads from Google Fonts.
  const families: PageTokens["families"] = [];
  for (const e of A.entries) {
    const href = e.tag === "link" ? attr(e, "href") : null;
    if (!href?.includes("fonts.googleapis.com/css")) {
      continue;
    }
    for (const f of new URL(href).searchParams.getAll("family")) {
      const [name = "", axes = ""] = f.split(":");
      families.push({ axes, name: name.replaceAll("+", " ") });
    }
  }
  return { blocks, brand, families, tokens };
}

/**
 * Splices that give each token in `sets` its new value in every block. A
 * token the @theme block lacks is added after --radius-xl (or at the top of
 * the block), indented like its neighbors.
 */
export function tokenSplices(
  A: Analysis,
  blocks: TokenBlock[],
  sets: TokenSet[],
) {
  const out: Splice[] = [];
  for (const b of blocks) {
    const body = A.src.slice(b.start, b.end);
    for (const [name, value] of sets) {
      const re = new RegExp(`(--${name}\\s*:\\s*)([^;]+);`);
      const m = re.exec(body);
      if (m) {
        const at = b.start + m.index + (m[1] ?? "").length;
        const current = m[2] ?? "";
        if (current.trim() !== value) {
          out.push({ end: at + current.length, start: at, text: value });
        }
        continue;
      }
      const anchor =
        /--radius-xl\s*:[^;]+;/.exec(body) ?? /--radius\s*:[^;]+;/.exec(body);
      const indent = /\n([ \t]*)--/.exec(body)?.[1] ?? "  ";
      const at = anchor ? b.start + anchor.index + anchor[0].length : b.start;
      out.push({ end: at, start: at, text: `\n${indent}--${name}: ${value};` });
    }
  }
  return out;
}

// ------------------------------------------------------------------ color

/** [start, end) of a CSS block's body, from just after its `{` to its matching `}`. */
function blockRange(src: string, start: number): Range {
  let depth = 1;
  let i = start;
  for (; i < src.length && depth; i++) {
    if (src[i] === "{") {
      depth++;
    } else if (src[i] === "}") {
      depth--;
    }
  }
  return { end: i - 1, start };
}

const toLin = (c: number) =>
  c <= 0.040_45 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const fromLin = (c: number) =>
  c <= 0.003_130_8 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;

function hexToOklch(hex: string): Oklch {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = toLin(((n >> 16) & 255) / 255);
  const g = toLin(((n >> 8) & 255) / 255);
  const b = toLin((n & 255) / 255);
  const l = Math.cbrt(
    0.412_221_470_8 * r + 0.536_332_536_3 * g + 0.051_445_992_9 * b,
  );
  const m = Math.cbrt(
    0.211_903_498_2 * r + 0.680_699_545_1 * g + 0.107_396_956_6 * b,
  );
  const s = Math.cbrt(
    0.088_302_461_9 * r + 0.281_718_837_6 * g + 0.629_978_700_5 * b,
  );
  const L = 0.210_454_255_3 * l + 0.793_617_785 * m - 0.004_072_046_8 * s;
  const a = 1.977_998_495_1 * l - 2.428_592_205 * m + 0.450_593_709_9 * s;
  const bb = 0.025_904_037_1 * l + 0.782_771_766_2 * m - 0.808_675_766 * s;
  return {
    C: Math.hypot(a, bb),
    H: ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360,
    L,
  };
}

function oklchToRgb({ C, H, L }: Oklch) {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.396_337_777_4 * a + 0.215_803_757_3 * b) ** 3;
  const m = (L - 0.105_561_345_8 * a - 0.063_854_172_8 * b) ** 3;
  const s = (L - 0.089_484_177_5 * a - 1.291_485_548 * b) ** 3;
  return [
    4.076_741_662_1 * l - 3.307_711_591_3 * m + 0.230_969_929_2 * s,
    -1.268_438_004_6 * l + 2.609_757_401_1 * m - 0.341_319_396_5 * s,
    -0.004_196_086_3 * l - 0.703_418_614_7 * m + 1.707_614_701 * s,
  ].map(fromLin);
}

const inGamut = (rgb: number[]) =>
  rgb.every((v) => v >= -0.0005 && v <= 1.0005);

/** The color as hex, chroma reduced until it fits sRGB. */
function oklchToHex(c: Oklch) {
  let lo = 0;
  let hi = c.C;
  let rgb = oklchToRgb(c);
  if (!inGamut(rgb)) {
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToRgb({ ...c, C: mid }))) {
        lo = mid;
      } else {
        hi = mid;
      }
    }
    rgb = oklchToRgb({ ...c, C: lo });
  }
  return `#${rgb
    .map((v) =>
      Math.round(Math.min(1, Math.max(0, v)) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

/** Hex values in a token value: one, or two inside light-dark(). */
const hexes = (value: string) => value.match(/#[0-9a-f]{6}\b/gi) ?? [];

/**
 * The brand ramp rebuilt around `hex`: every step keeps its lightness (so the
 * page's contrast holds in both themes) and takes the picked color's hue, with
 * chroma scaled by how saturated the pick is next to the ramp's 500.
 */
function rampFor(page: PageTokens, hex: string): TokenSet[] {
  const pick = hexToOklch(hex);
  const base = hexToOklch(
    hexes(page.tokens.get("color-brand-500") ?? "#0e7869")[0] ?? "#0e7869",
  );
  // A near-gray ramp has no chroma profile left to scale, so one is drawn
  // instead: fullest at the 500's lightness, fading toward paper and ink.
  const flat = base.C < 0.03;
  const k = flat ? 1 : Math.min(2.2, pick.C / base.C);
  return page.brand.map((name) => {
    const value = page.tokens.get(name) ?? "";
    const next = value.replaceAll(/#[0-9a-f]{6}\b/gi, (h) => {
      const c = hexToOklch(h);
      const C = flat
        ? pick.C * Math.max(0.12, 1 - Math.abs(c.L - base.L) * 1.5)
        : c.C * k;
      return oklchToHex({ C, H: pick.H, L: c.L });
    });
    return [name, next];
  });
}

/** The ramp's 500 as it is now. */
const accentOf = (page: PageTokens) =>
  hexes(page.tokens.get("color-brand-500") ?? "")[0] ?? null;

/** Whether two colors read as the same accent: close in hue and chroma. */
function near(a: string, b: null | string) {
  return (
    b !== null &&
    Math.abs(hexToOklch(a).H - hexToOklch(b).H) < 8 &&
    Math.abs(hexToOklch(a).C - hexToOklch(b).C) < 0.02
  );
}

/** A preset accent: the ramp's own 500 lightness and chroma at another hue. */
function presetHex(page: PageTokens, H: number, C: number | undefined) {
  const base = hexToOklch(accentOf(page) ?? "#0e7869");
  return oklchToHex({ C: C ?? (base.C >= 0.05 ? base.C : 0.11), H, L: base.L });
}

const PRESETS: [name: string, hue: number, chroma?: number][] = [
  ["Teal", 180],
  ["Green", 150],
  ["Blue", 250],
  ["Indigo", 275],
  ["Violet", 305],
  ["Rose", 5],
  ["Orange", 45],
  ["Graphite", 250, 0.012],
];

// ------------------------------------------------------------------ panel

const CORNERS: [value: string, label: string][] = [
  ["0rem", "Square"],
  ["0.25rem", "Subtle"],
  ["0.5rem", "Soft"],
  ["0.75rem", "Round"],
  ["1rem", "Rounder"],
];
const DENSITY: [value: string, label: string][] = [
  ["0.225rem", "Compact"],
  ["0.25rem", "Default"],
  ["0.275rem", "Roomy"],
];

/** Render the panel into `root`. */
export function renderPagePanel(root: HTMLElement, ctx: PagePanelContext) {
  const { page } = ctx;
  root.innerHTML = "";
  if (!page) {
    root.innerHTML =
      '<p class="ins-empty">This page has no theme block to change. Select something on the page to style it.</p>';
    return;
  }
  const accent = accentOf(page);
  const radius = page.tokens.get("radius") ?? "0.5rem";
  const density = page.tokens.get("spacing") ?? "0.25rem";
  const font = page.tokens.get("font-sans") ?? "";
  const presets = PRESETS.map(([name, H, C]) => ({
    hex: presetHex(page, H, C),
    name,
  }));
  const onPreset = presets.find((p) => near(p.hex, accent));
  const ramp = page.brand.filter((n) => /-(?:50|100|300|500|700|900)$/.test(n));
  const fonts = fontChoices(page);
  // The samples draw in the page's own faces, which the page has loaded already.
  root.insertAdjacentHTML(
    "beforeend",
    `
    <section class="sp-sec">
      <h4>Accent</h4>
      <div class="pg-accents">${presets.map((p) => `<button type="button" class="psw ${onPreset === p ? "on" : ""}" data-hex="${p.hex}" title="${p.name}" style="--c:${p.hex}"></button>`).join("")}<button type="button" class="psw custom ${accent && !onPreset ? "on" : ""}" data-custom title="Custom color" style="--c:${accent ?? "#888"}"></button></div>
      <div class="pg-ramp" title="The brand ramp the page uses for links, buttons and highlights">${ramp.map((n) => `<span style="background:var(--p-${n})"></span>`).join("")}</div>
      <div class="pg-custom" hidden>
        <input type="color" class="hex-picker" aria-label="Color">
        <form class="p-hex"><span class="hash">#</span><input spellcheck="false" maxlength="7" aria-label="Hex color"><button type="submit" class="primary small">Apply</button></form>
      </div>
    </section>
    <section class="sp-sec">
      <h4>Corners</h4>
      <div class="tiles pg-corners">${CORNERS.map(([v, l]) => `<button type="button" data-v="${v}" class="${v === radius ? "on" : ""}" title="${l} (${v})"><span class="pg-corner" style="border-top-left-radius:${Number.parseFloat(v) * 14}px"></span><em>${l}</em></button>`).join("")}</div>
    </section>
    <section class="sp-sec">
      <h4>Type</h4>
      <div class="pg-fonts">${fonts.map((f) => `<button type="button" data-v='${f.value.replaceAll("'", "&#39;")}' class="${f.value === font ? "on" : ""}"><span class="ag" style='font-family:${f.sample.replaceAll("'", "&#39;")}'>Ag</span><span>${f.label}</span></button>`).join("")}</div>
    </section>
    <section class="sp-sec">
      <h4>Density</h4>
      <div class="seg pg-density">${DENSITY.map(([v, l]) => `<button type="button" data-v="${v}" class="${v === density ? "on" : ""}">${l}</button>`).join("")}</div>
    </section>`,
  );
  // Ramp swatches show the page's own resolved colors (light or dark).
  const rampEl = findAs(root, ".pg-ramp", HTMLElement);
  for (const n of ramp) {
    rampEl.style.setProperty(`--p-${n}`, ctx.colorOf(n));
  }

  const setAccent = (hex: string, label: string) => {
    ctx.onSet(rampFor(page, hex), label);
  };
  findAs(root, ".pg-accents", HTMLElement).addEventListener("click", (e) => {
    const b = closestIn(e, ".psw");
    if (!b) {
      return;
    }
    if (b.dataset.custom !== undefined) {
      const box = findAs(root, ".pg-custom", HTMLElement);
      box.hidden = !box.hidden;
      return;
    }
    if (!b.classList.contains("on")) {
      setAccent(b.dataset.hex ?? "", `Accent → ${b.title}`);
    }
  });
  const picker = findAs(root, ".hex-picker", HTMLInputElement);
  const hexIn = findAs(root, ".pg-custom .p-hex input", HTMLInputElement);
  picker.value = accent ?? "#0e7869";
  hexIn.value = (accent ?? "#0e7869").slice(1);
  picker.addEventListener("input", () => {
    hexIn.value = picker.value.slice(1);
    ctx.onPreview(rampFor(page, picker.value));
  });
  hexIn.addEventListener("input", () => {
    if (!/^[0-9a-f]{6}$/i.test(hexIn.value)) {
      return;
    }
    picker.value = `#${hexIn.value}`;
    ctx.onPreview(rampFor(page, `#${hexIn.value}`));
  });
  findAs(root, ".pg-custom form", HTMLFormElement).addEventListener(
    "submit",
    (e) => {
      e.preventDefault();
      const hex = `#${hexIn.value.replace(/^#/, "").toLowerCase()}`;
      if (/^#[0-9a-f]{6}$/.test(hex)) {
        setAccent(hex, `Accent → ${hex}`);
      }
    },
  );
  findAs(root, ".pg-corners", HTMLElement).addEventListener("click", (e) => {
    const b = closestIn(e, "[data-v]");
    if (b && !b.classList.contains("on")) {
      ctx.onSet(
        [["radius", b.dataset.v ?? ""]],
        `Corners → ${b.querySelector("em")?.textContent ?? ""}`,
      );
    }
  });
  findAs(root, ".pg-fonts", HTMLElement).addEventListener("click", (e) => {
    const b = closestIn(e, "[data-v]");
    if (b && !b.classList.contains("on")) {
      ctx.onSet(
        [["font-sans", b.dataset.v ?? ""]],
        `Font → ${b.textContent.replace(/^Ag/, "")}`,
      );
    }
  });
  findAs(root, ".pg-density", HTMLElement).addEventListener("click", (e) => {
    const b = closestIn(e, "[data-v]");
    if (b && !b.classList.contains("on")) {
      ctx.onSet([["spacing", b.dataset.v ?? ""]], `Density → ${b.textContent}`);
    }
  });
}

/** Font choices: families the page loads (mono faces excluded), plus the system face. */
function fontChoices(page: PageTokens) {
  const current = page.tokens.get("font-sans") ?? "";
  const serif = page.tokens.get("font-serif") ?? "";
  const out = page.families
    .filter((f) => !/mono|code/i.test(f.name))
    .map((f) => {
      const own = [current, serif].find((v) => v.startsWith(`"${f.name}"`));
      return {
        label: f.name,
        sample: `"${f.name}"`,
        value: own ?? `"${f.name}", ui-sans-serif, system-ui, sans-serif`,
      };
    });
  out.push({
    label: "System",
    sample: "system-ui",
    value: "ui-sans-serif, system-ui, sans-serif",
  });
  return out;
}
