// The Page panel: page-wide look through the tokens in the page's own
// `@theme` block (accent ramp, corner radius, body font, spacing density).
// Every change is a new value for a few `--token: value;` declarations, in the
// @theme block and in the compiled copy of it (<style data-tailwind="compiled">)
// so the file renders the same with scripts off. The live page follows by
// getting the block's new text, which the Tailwind browser build recompiles.

// ------------------------------------------------------------------ reading

const attr = (entry, name) =>
  entry.node.attrs.find((a) => a.name === name)?.value;
const innerOf = (entry) => ({
  start: entry.loc.startTag.endOffset,
  end: entry.loc.endTag.startOffset,
});

/** Where the page keeps its tokens, and their current values. Null when it has no @theme block. */
export function readPage(A) {
  const tw = A.entries.find(
    (e) =>
      e.tag === "style" &&
      attr(e, "type") === "text/tailwindcss" &&
      e.loc.endTag,
  );
  if (!tw) return null;
  const twIn = innerOf(tw);
  const text = A.src.slice(twIn.start, twIn.end);
  const open = /@theme\b[^{]*\{/.exec(text);
  if (!open) return null;
  const blocks = [
    {
      entry: tw,
      ...blockRange(A.src, twIn.start + open.index + open[0].length),
    },
  ];
  const floor = A.entries.find(
    (e) =>
      e.tag === "style" &&
      attr(e, "data-tailwind") === "compiled" &&
      e.loc.endTag,
  );
  if (floor) {
    const fIn = innerOf(floor);
    const m = /:root,\s*:host\s*\{/.exec(A.src.slice(fIn.start, fIn.end));
    if (m)
      blocks.push({
        entry: floor,
        ...blockRange(A.src, fIn.start + m.index + m[0].length),
      });
  }
  const tokens = new Map();
  for (const m of A.src
    .slice(blocks[0].start, blocks[0].end)
    .matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/gi))
    tokens.set(m[1], m[2].trim());
  const brand = [...tokens.keys()].filter((k) => /^color-brand-\d+$/.test(k));
  // Families the page already loads from Google Fonts.
  const families = [];
  const fontLinks = [];
  for (const e of A.entries) {
    const href = e.tag === "link" ? attr(e, "href") : null;
    if (!href?.includes("fonts.googleapis.com/css")) continue;
    fontLinks.push(href);
    for (const f of new URL(href).searchParams.getAll("family")) {
      const [name, axes = ""] = f.split(":");
      families.push({ name: name.replace(/\+/g, " "), axes });
    }
  }
  return { blocks, tokens, brand, families, fontLinks };
}

/** [start, end) of a CSS block's body, from just after its `{` to its matching `}`. */
function blockRange(src, start) {
  let depth = 1;
  let i = start;
  for (; i < src.length && depth; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") depth--;
  }
  return { start, end: i - 1 };
}

/**
 * Splices that give each token in `sets` ([[name, value]]) its new value in
 * every block. A token the @theme block lacks is added after --radius-xl (or
 * at the top of the block), indented like its neighbors.
 */
export function tokenSplices(A, page, sets) {
  const out = [];
  for (const b of page.blocks) {
    const body = A.src.slice(b.start, b.end);
    for (const [name, value] of sets) {
      const re = new RegExp(`(--${name}\\s*:\\s*)([^;]+);`);
      const m = re.exec(body);
      if (m) {
        const at = b.start + m.index + m[1].length;
        if (m[2].trim() !== value)
          out.push({ start: at, end: at + m[2].length, text: value });
        continue;
      }
      const anchor =
        /--radius-xl\s*:[^;]+;/.exec(body) ?? /--radius\s*:[^;]+;/.exec(body);
      const indent = /\n([ \t]*)--/.exec(body)?.[1] ?? "  ";
      const at = anchor ? b.start + anchor.index + anchor[0].length : b.start;
      out.push({ start: at, end: at, text: `\n${indent}--${name}: ${value};` });
    }
  }
  return out;
}

/** The @theme block's style text with `sets` applied (for a live preview). */
export function previewText(A, page, sets) {
  const tw = page.blocks[0].entry;
  const inner = innerOf(tw);
  let text = A.src.slice(inner.start, inner.end);
  const sp = tokenSplices(A, { ...page, blocks: [page.blocks[0]] }, sets).sort(
    (a, b) => b.start - a.start,
  );
  for (const s of sp)
    text =
      text.slice(0, s.start - inner.start) +
      s.text +
      text.slice(s.end - inner.start);
  return text;
}

// ------------------------------------------------------------------ color

const toLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLin = (c) =>
  c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;

function hexToOklch(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) =>
    toLin(v / 255),
  );
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return {
    L,
    C: Math.hypot(a, bb),
    H: ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360,
  };
}

function oklchToRgb({ L, C, H }) {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map(fromLin);
}

const inGamut = (rgb) => rgb.every((v) => v >= -0.0005 && v <= 1.0005);

/** The color as hex, chroma reduced until it fits sRGB. */
function oklchToHex(c) {
  let lo = 0;
  let hi = c.C;
  let rgb = oklchToRgb(c);
  if (!inGamut(rgb)) {
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToRgb({ ...c, C: mid }))) lo = mid;
      else hi = mid;
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
const hexes = (value) => value.match(/#[0-9a-f]{6}\b/gi) ?? [];

/**
 * The brand ramp rebuilt around `hex`: every step keeps its lightness (so the
 * page's contrast holds in both themes) and takes the picked color's hue, with
 * chroma scaled by how saturated the pick is next to the ramp's 500.
 */
export function rampFor(page, hex) {
  const pick = hexToOklch(hex);
  const base = hexToOklch(
    hexes(page.tokens.get("color-brand-500") ?? "#0e7869")[0] ?? "#0e7869",
  );
  // A near-gray ramp has no chroma profile left to scale, so one is drawn
  // instead: fullest at the 500's lightness, fading toward paper and ink.
  const flat = base.C < 0.03;
  const k = flat ? 1 : Math.min(2.2, pick.C / base.C);
  return page.brand.map((name) => {
    const value = page.tokens.get(name);
    const next = value.replace(/#[0-9a-f]{6}\b/gi, (h) => {
      const c = hexToOklch(h);
      const C = flat
        ? pick.C * Math.max(0.12, 1 - Math.abs(c.L - base.L) * 1.5)
        : c.C * k;
      return oklchToHex({ L: c.L, C, H: pick.H });
    });
    return [name, next];
  });
}

/** The ramp's 500 as it is now. */
export const accentOf = (page) =>
  hexes(page.tokens.get("color-brand-500") ?? "")[0] ?? null;

/** A preset accent: the ramp's own 500 lightness and chroma at another hue. */
function presetHex(page, H, C) {
  const base = hexToOklch(accentOf(page) ?? "#0e7869");
  return oklchToHex({ L: base.L, C: C ?? (base.C >= 0.05 ? base.C : 0.11), H });
}

const PRESETS = [
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

const CORNERS = [
  ["0rem", "Square"],
  ["0.25rem", "Subtle"],
  ["0.5rem", "Soft"],
  ["0.75rem", "Round"],
  ["1rem", "Rounder"],
];
const DENSITY = [
  ["0.225rem", "Compact"],
  ["0.25rem", "Default"],
  ["0.275rem", "Roomy"],
];

/** Font choices: families the page loads (mono faces excluded), plus the system face. */
function fontChoices(page) {
  const current = page.tokens.get("font-sans") ?? "";
  const serif = page.tokens.get("font-serif") ?? "";
  const out = page.families
    .filter((f) => !/mono|code/i.test(f.name))
    .map((f) => {
      const own = [current, serif].find((v) => v.startsWith(`"${f.name}"`));
      return {
        label: f.name,
        value: own ?? `"${f.name}", ui-sans-serif, system-ui, sans-serif`,
        sample: `"${f.name}"`,
      };
    });
  out.push({
    label: "System",
    value: "ui-sans-serif, system-ui, sans-serif",
    sample: "system-ui",
  });
  return out;
}

/**
 * Render into `root`. ctx: { page, onSet(sets, label), onPreview(sets | null) }.
 */
export function renderPagePanel(root, ctx) {
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
    name,
    hex: presetHex(page, H, C),
  }));
  const near = (a, b) =>
    a &&
    b &&
    Math.abs(hexToOklch(a).H - hexToOklch(b).H) < 8 &&
    Math.abs(hexToOklch(a).C - hexToOklch(b).C) < 0.02;
  const onPreset = presets.find((p) => near(p.hex, accent));
  const ramp = page.brand.filter((n) => /-(50|100|300|500|700|900)$/.test(n));
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
      <div class="pg-fonts">${fonts.map((f) => `<button type="button" data-v='${f.value.replace(/'/g, "&#39;")}' class="${f.value === font ? "on" : ""}"><span class="ag" style='font-family:${f.sample.replace(/'/g, "&#39;")}'>Ag</span><span>${f.label}</span></button>`).join("")}</div>
    </section>
    <section class="sp-sec">
      <h4>Density</h4>
      <div class="seg pg-density">${DENSITY.map(([v, l]) => `<button type="button" data-v="${v}" class="${v === density ? "on" : ""}">${l}</button>`).join("")}</div>
    </section>`,
  );
  // Ramp swatches show the page's own resolved colors (light or dark).
  const rampEl = root.querySelector(".pg-ramp");
  for (const n of ramp) rampEl.style.setProperty(`--p-${n}`, ctx.colorOf(n));

  const setAccent = (hex, label) => ctx.onSet(rampFor(page, hex), label);
  root.querySelector(".pg-accents").onclick = (e) => {
    const b = e.target.closest(".psw");
    if (!b) return;
    if (b.dataset.custom != null) {
      const box = root.querySelector(".pg-custom");
      box.hidden = !box.hidden;
      return;
    }
    if (!b.classList.contains("on"))
      setAccent(b.dataset.hex, `Accent → ${b.title}`);
  };
  const picker = root.querySelector(".hex-picker");
  const hexIn = root.querySelector(".pg-custom input");
  picker.value = accent ?? "#0e7869";
  hexIn.value = (accent ?? "#0e7869").slice(1);
  picker.addEventListener("input", () => {
    hexIn.value = picker.value.slice(1);
    ctx.onPreview(rampFor(page, picker.value));
  });
  hexIn.addEventListener("input", () => {
    if (!/^[0-9a-f]{6}$/i.test(hexIn.value)) return;
    picker.value = `#${hexIn.value}`;
    ctx.onPreview(rampFor(page, `#${hexIn.value}`));
  });
  root.querySelector(".pg-custom form").onsubmit = (e) => {
    e.preventDefault();
    const hex = `#${hexIn.value.replace(/^#/, "").toLowerCase()}`;
    if (/^#[0-9a-f]{6}$/.test(hex)) setAccent(hex, `Accent → ${hex}`);
  };
  root.querySelector(".pg-corners").onclick = (e) => {
    const b = e.target.closest("[data-v]");
    if (b && !b.classList.contains("on"))
      ctx.onSet(
        [["radius", b.dataset.v]],
        `Corners → ${b.querySelector("em").textContent}`,
      );
  };
  root.querySelector(".pg-fonts").onclick = (e) => {
    const b = e.target.closest("[data-v]");
    if (b && !b.classList.contains("on"))
      ctx.onSet(
        [["font-sans", b.dataset.v]],
        `Font → ${b.textContent.replace(/^Ag/, "")}`,
      );
  };
  root.querySelector(".pg-density").onclick = (e) => {
    const b = e.target.closest("[data-v]");
    if (b && !b.classList.contains("on"))
      ctx.onSet([["spacing", b.dataset.v]], `Density → ${b.textContent}`);
  };
}
