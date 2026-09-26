// The page's design vocabulary: its --color-* tokens (read from the page's
// own @theme block, so the default Tailwind palette stays hidden) and the
// named steps the style panel offers, plus reading the current value of each
// control from a class list as written in the file.

export const SIZES = [
  ["xs", 12],
  ["sm", 14],
  ["base", 16],
  ["lg", 18],
  ["xl", 20],
  ["2xl", 24],
  ["3xl", 30],
  ["4xl", 36],
  ["5xl", 48],
];
export const WEIGHTS = [
  ["normal", 400, "Regular"],
  ["medium", 500, "Medium"],
  ["semibold", 600, "Semibold"],
  ["bold", 700, "Bold"],
];
export const SPACE = [0, 0.5, 1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12, 16];
export const RADII = [
  ["none", "None"],
  ["sm", "S"],
  ["md", "M"],
  ["lg", "L"],
  ["xl", "XL"],
  ["2xl", "2XL"],
  ["full", "Full"],
];
export const SHADOWS = [
  ["none", "None"],
  ["sm", "S"],
  ["md", "M"],
  ["lg", "L"],
  ["xl", "XL"],
];

const RAMP_STEPS = ["50", "100", "300", "500", "700", "900"];
const TEXT_SEMANTIC = [
  "foreground",
  "muted-foreground",
  "primary",
  "destructive",
];
const FILL_SEMANTIC = [
  "background",
  "card",
  "muted",
  "accent",
  "secondary",
  "primary",
];
const LABELS = {
  foreground: "Text",
  "muted-foreground": "Muted text",
  primary: "Primary",
  destructive: "Destructive",
  background: "Page",
  card: "Card",
  muted: "Muted",
  accent: "Accent",
  secondary: "Secondary",
};
export const titleCase = (s) =>
  s.replace(/(^|-)(\w)/g, (_, d, c) => `${d ? " " : ""}${c.toUpperCase()}`);
export const colorLabel = (name) =>
  name.startsWith("[")
    ? name.slice(1, -1).toUpperCase()
    : (LABELS[name] ?? titleCase(name));

/** --color-* names declared in the page's own `@theme` blocks, grouped. */
export function readTheme(src) {
  const names = new Set();
  for (const m of src.matchAll(
    /<style[^>]*type=["']text\/tailwindcss["'][^>]*>([\s\S]*?)<\/style>/gi,
  )) {
    for (const t of m[1].matchAll(/@theme\b[^{]*\{([\s\S]*?)\n\s*\}/g)) {
      for (const v of t[1].matchAll(/--color-([a-z0-9-]+)\s*:/gi))
        names.add(v[1]);
    }
  }
  const ramps = new Map();
  const semantic = [];
  for (const n of names) {
    const m = /^(.*)-(\d+)$/.exec(n);
    if (m) {
      if (!ramps.has(m[1])) ramps.set(m[1], []);
      ramps.get(m[1]).push(m[2]);
    } else semantic.push(n);
  }
  const order = ["brand", "gray", "success", "warning", "error"];
  const rampList = [...ramps.keys()].sort(
    (a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99),
  );
  return {
    names,
    semantic,
    ramps: rampList.map((r) => ({
      name: r,
      steps: RAMP_STEPS.filter((s) => ramps.get(r).includes(s)).map(
        (s) => `${r}-${s}`,
      ),
    })),
    textSemantic: TEXT_SEMANTIC.filter((n) => names.has(n)),
    fillSemantic: FILL_SEMANTIC.filter((n) => names.has(n)),
  };
}

/** Each token's color as the page renders it now (light or dark), via a probe in the page. */
export function resolveColors(doc, names) {
  const probe = doc.createElement("span");
  probe.setAttribute("data-editor-guest", "");
  probe.style.cssText =
    "position:absolute;visibility:hidden;pointer-events:none";
  doc.body.append(probe);
  const win = doc.defaultView;
  const out = new Map();
  for (const n of names) {
    probe.style.color = n.startsWith("[")
      ? n.slice(1, -1)
      : `var(--color-${n})`;
    out.set(n, win.getComputedStyle(probe).color);
  }
  probe.remove();
  return out;
}

// ------------------------------------------------------------ class parsing

const VARIANT = /^[a-z0-9-[\]&:@*]+:/i;
/** Tokens that apply at every size and state (no `sm:`, `hover:` ...). */
export const baseTokens = (tokens) => tokens.filter((t) => !VARIANT.test(t));

const SIZE_RE = /^text-(xs|sm|base|lg|[2-9]?xl)$/;
const ARB_SIZE_RE = /^text-\[(\d+(?:\.\d+)?)(px|rem)\]$/;
const isColorName = (theme, n) =>
  theme.names.has(n) ||
  /^(white|black|transparent|current|inherit)$/.test(n) ||
  /^[a-z]+-\d{2,3}$/.test(n) ||
  /^\[(#|rgb|hsl|oklch|color)/.test(n);
const colorPart = (rest) => rest.split("/")[0];

export function readSize(tokens) {
  let px = null;
  let name = null;
  for (const t of baseTokens(tokens)) {
    const m = SIZE_RE.exec(t);
    if (m) {
      name = m[1];
      px = SIZES.find((s) => s[0] === m[1])?.[1] ?? null;
    }
    const a = ARB_SIZE_RE.exec(t);
    if (a) {
      name = null;
      px = a[2] === "rem" ? Number(a[1]) * 16 : Number(a[1]);
    }
  }
  return { px, name };
}

export function readColor(theme, tokens, prefix) {
  let v = null;
  for (const t of baseTokens(tokens)) {
    if (!t.startsWith(`${prefix}-`)) continue;
    const rest = colorPart(t.slice(prefix.length + 1));
    if (prefix === "text" && (SIZE_RE.test(t) || ARB_SIZE_RE.test(t))) continue;
    if (isColorName(theme, rest)) v = rest;
  }
  return v;
}

export function readWeight(tokens) {
  let v = null;
  for (const t of baseTokens(tokens)) {
    const m =
      /^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/.exec(
        t,
      );
    if (m) v = m[1];
  }
  return v;
}

const SIDES = ["t", "r", "b", "l"];
/** Per-side spacing steps written in the tokens for `p` or `m`: { t: '4', r: null, ... }. */
export function readSpacing(tokens, kind) {
  const out = { t: null, r: null, b: null, l: null };
  const rank = { t: -1, r: -1, b: -1, l: -1 };
  const re = new RegExp(
    `^(-?)${kind}([trblxy]?)-(\\d+(?:\\.\\d+)?|px|auto|\\[[^\\]]+\\])$`,
  );
  for (const t of baseTokens(tokens)) {
    const m = re.exec(t);
    if (!m) continue;
    const [, neg, axis, val] = m;
    const affects =
      axis === ""
        ? SIDES
        : axis === "x"
          ? ["r", "l"]
          : axis === "y"
            ? ["t", "b"]
            : [axis];
    const r = axis === "" ? 0 : "xy".includes(axis) ? 1 : 2;
    for (const s of affects) {
      if (r >= rank[s]) {
        rank[s] = r;
        out[s] = `${neg}${val}`;
      }
    }
  }
  return out;
}

export function readRadius(tokens) {
  let v = null;
  for (const t of baseTokens(tokens)) {
    const m = /^rounded(?:-(none|xs|sm|md|lg|xl|2xl|3xl|4xl|full))?$/.exec(t);
    if (m) v = m[1] ?? "DEFAULT";
  }
  return v;
}

export function readShadow(tokens) {
  let v = null;
  for (const t of baseTokens(tokens)) {
    const m = /^shadow(?:-(none|2xs|xs|sm|md|lg|xl|2xl))?$/.exec(t);
    if (m) v = m[1] ?? "DEFAULT";
  }
  return v;
}

/** A spacing step's pixels ("4" -> 16, "px" -> 1, "[13px]" -> 13); null for auto. */
export function stepPx(step) {
  if (step == null || step === "auto") return null;
  const neg = step.startsWith("-") ? -1 : 1;
  const s = step.replace(/^-/, "");
  if (s === "px") return neg;
  const a = /^\[(\d+(?:\.\d+)?)(px|rem)\]$/.exec(s);
  if (a) return neg * (a[2] === "rem" ? Number(a[1]) * 16 : Number(a[1]));
  return neg * Number(s) * 4;
}

/** The next step on the spacing scale from `px`, up (+1) or down (-1). */
export function nextSpace(px, dir) {
  const steps = SPACE.map((n) => n * 4);
  if (dir > 0) {
    const i = steps.findIndex((s) => s > px + 0.01);
    return i < 0 ? null : SPACE[i];
  }
  for (let i = steps.length - 1; i >= 0; i--)
    if (steps[i] < px - 0.01) return SPACE[i];
  return null;
}

export function nextSize(px, dir) {
  if (dir > 0) return SIZES.find((s) => s[1] > px + 0.01) ?? null;
  return [...SIZES].reverse().find((s) => s[1] < px - 0.01) ?? null;
}
