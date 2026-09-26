/**
 * The page's design vocabulary: its `--color-*` tokens (read from the page's
 * own `@theme` block, so the default Tailwind palette stays hidden) and the
 * named steps the style panel offers, plus reading the current value of each
 * control from a class list as written in the file.
 */

export const SIZES: readonly (readonly [name: string, px: number])[] = [
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
export const WEIGHTS: readonly (readonly [
  name: string,
  value: number,
  label: string,
])[] = [
  ["normal", 400, "Regular"],
  ["medium", 500, "Medium"],
  ["semibold", 600, "Semibold"],
  ["bold", 700, "Bold"],
];
const SPACE = [0, 0.5, 1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12, 16];
export const RADII: readonly (readonly [name: string, label: string])[] = [
  ["none", "None"],
  ["sm", "S"],
  ["md", "M"],
  ["lg", "L"],
  ["xl", "XL"],
  ["2xl", "2XL"],
  ["full", "Full"],
];
export const SHADOWS: readonly (readonly [name: string, label: string])[] = [
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
const LABELS: Record<string, string> = {
  accent: "Accent",
  background: "Page",
  card: "Card",
  destructive: "Destructive",
  foreground: "Text",
  muted: "Muted",
  "muted-foreground": "Muted text",
  primary: "Primary",
  secondary: "Secondary",
};
const titleCase = (s: string) =>
  s.replaceAll(
    /(^|-)(\w)/g,
    (_, d: string, c: string) => `${d ? " " : ""}${c.toUpperCase()}`,
  );
export const colorLabel = (name: string) =>
  name.startsWith("[")
    ? name.slice(1, -1).toUpperCase()
    : (LABELS[name] ?? titleCase(name));

/** The page's color tokens, grouped the way the palette shows them. */
export interface Theme {
  fillSemantic: string[];
  /** Every `--color-*` name the page declares, without the prefix. */
  names: Set<string>;
  ramps: { name: string; steps: string[] }[];
  /** Names that are not a step of a ramp: "primary", "muted-foreground". */
  semantic: string[];
  textSemantic: string[];
}

/** --color-* names declared in the page's own `@theme` blocks, grouped. */
export function readTheme(src: string): Theme {
  const names = new Set<string>();
  for (const m of src.matchAll(
    /<style[^>]*type=["']text\/tailwindcss["'][^>]*>([\s\S]*?)<\/style>/gi,
  )) {
    for (const t of (m[1] ?? "").matchAll(
      /@theme\b[^{]*\{([\s\S]*?)\n[^\S\n]*\}/g,
    )) {
      for (const v of (t[1] ?? "").matchAll(/--color-([a-z0-9-]+)\s*:/gi)) {
        if (v[1] !== undefined) {
          names.add(v[1]);
        }
      }
    }
  }
  const ramps = new Map<string, string[]>();
  const semantic: string[] = [];
  for (const n of names) {
    const m = /^(.*)-(\d+)$/.exec(n);
    if (m?.[1] !== undefined && m[2] !== undefined) {
      const steps = ramps.get(m[1]) ?? [];
      ramps.set(m[1], steps);
      steps.push(m[2]);
    } else {
      semantic.push(n);
    }
  }
  const order = ["brand", "gray", "success", "warning", "error"];
  const rampList = [...ramps.keys()].sort(
    (a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99),
  );
  return {
    fillSemantic: FILL_SEMANTIC.filter((n) => names.has(n)),
    names,
    ramps: rampList.map((r) => ({
      name: r,
      steps: RAMP_STEPS.filter((s) => ramps.get(r)?.includes(s)).map(
        (s) => `${r}-${s}`,
      ),
    })),
    semantic,
    textSemantic: TEXT_SEMANTIC.filter((n) => names.has(n)),
  };
}

/** Each token's color as the page renders it now (light or dark), via a probe in the page. */
export function resolveColors(doc: Document, names: string[]) {
  const probe = doc.createElement("span");
  probe.setAttribute("data-editor-guest", "");
  probe.style.cssText =
    "position:absolute;visibility:hidden;pointer-events:none";
  doc.body.append(probe);
  const out = new Map<string, string>();
  for (const n of names) {
    probe.style.color = n.startsWith("[")
      ? n.slice(1, -1)
      : `var(--color-${n})`;
    out.set(n, getComputedStyle(probe).color);
  }
  probe.remove();
  return out;
}

// ------------------------------------------------------------ class parsing

const VARIANT = /^[a-z0-9-[\]&:@*]+:/i;
/** Tokens that apply at every size and state (no `sm:`, `hover:` ...). */
const baseTokens = (tokens: string[]) => tokens.filter((t) => !VARIANT.test(t));

const SIZE_RE = /^text-(xs|sm|base|lg|[2-9]?xl)$/;
const ARB_SIZE_RE = /^text-\[(\d+(?:\.\d+)?)(px|rem)\]$/;
const isColorName = (theme: Theme, n: string) =>
  theme.names.has(n) ||
  /^(?:white|black|transparent|current|inherit)$/.test(n) ||
  /^[a-z]+-\d{2,3}$/.test(n) ||
  /^\[(?:#|rgb|hsl|oklch|color)/.test(n);
const colorPart = (rest: string) => rest.split("/")[0] ?? "";

export type Side = "b" | "l" | "r" | "t";

export function readColor(theme: Theme, tokens: string[], prefix: string) {
  let v: null | string = null;
  for (const t of baseTokens(tokens)) {
    if (!t.startsWith(`${prefix}-`)) {
      continue;
    }
    const rest = colorPart(t.slice(prefix.length + 1));
    if (prefix === "text" && (SIZE_RE.test(t) || ARB_SIZE_RE.test(t))) {
      continue;
    }
    if (isColorName(theme, rest)) {
      v = rest;
    }
  }
  return v;
}

export function readSize(tokens: string[]) {
  let px: null | number = null;
  let name: null | string = null;
  for (const t of baseTokens(tokens)) {
    const m = SIZE_RE.exec(t);
    if (m?.[1] !== undefined) {
      const found = m[1];
      name = found;
      px = SIZES.find((s) => s[0] === found)?.[1] ?? null;
    }
    const a = ARB_SIZE_RE.exec(t);
    if (a) {
      name = null;
      px = a[2] === "rem" ? Number(a[1]) * 16 : Number(a[1]);
    }
  }
  return { name, px };
}

export function readWeight(tokens: string[]) {
  let v: null | string = null;
  for (const t of baseTokens(tokens)) {
    const m =
      /^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/.exec(
        t,
      );
    if (m?.[1] !== undefined) {
      v = m[1];
    }
  }
  return v;
}
const SIDES: Side[] = ["t", "r", "b", "l"];
const isSide = (s: string): s is Side =>
  s === "t" || s === "r" || s === "b" || s === "l";

export function nextSize(px: number, dir: number) {
  if (dir > 0) {
    return SIZES.find((s) => s[1] > px + 0.01) ?? null;
  }
  return [...SIZES].reverse().find((s) => s[1] < px - 0.01) ?? null;
}

/** The next step on the spacing scale from `px`, up (+1) or down (-1). */
export function nextSpace(px: number, dir: number) {
  const steps = SPACE.map((n) => n * 4);
  if (dir > 0) {
    const i = steps.findIndex((s) => s > px + 0.01);
    return i === -1 ? null : (SPACE[i] ?? null);
  }
  for (let i = steps.length - 1; i >= 0; i--) {
    const s = steps[i];
    if (s !== undefined && s < px - 0.01) {
      return SPACE[i] ?? null;
    }
  }
  return null;
}

export function readRadius(tokens: string[]) {
  let v: null | string = null;
  for (const t of baseTokens(tokens)) {
    const m = /^rounded(?:-(none|xs|sm|md|lg|xl|2xl|3xl|4xl|full))?$/.exec(t);
    if (m) {
      v = m[1] ?? "DEFAULT";
    }
  }
  return v;
}

export function readShadow(tokens: string[]) {
  let v: null | string = null;
  for (const t of baseTokens(tokens)) {
    const m = /^shadow(?:-(none|2xs|xs|sm|md|lg|xl|2xl))?$/.exec(t);
    if (m) {
      v = m[1] ?? "DEFAULT";
    }
  }
  return v;
}

/** Per-side spacing steps written in the tokens for `p` or `m`: { t: '4', r: null, ... }. */
export function readSpacing(tokens: string[], kind: "m" | "p") {
  const out: Record<Side, null | string> = {
    b: null,
    l: null,
    r: null,
    t: null,
  };
  const rank: Record<Side, number> = { b: -1, l: -1, r: -1, t: -1 };
  const re = new RegExp(
    `^(-?)${kind}([trblxy]?)-(\\d+(?:\\.\\d+)?|px|auto|\\[[^\\]]+\\])$`,
  );
  for (const t of baseTokens(tokens)) {
    const m = re.exec(t);
    if (!m) {
      continue;
    }
    const [, neg = "", axis = "", val = ""] = m;
    const affects: Side[] =
      axis === ""
        ? SIDES
        : axis === "x"
          ? ["r", "l"]
          : axis === "y"
            ? ["t", "b"]
            : isSide(axis)
              ? [axis]
              : [];
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

/** A spacing step's pixels ("4" -> 16, "px" -> 1, "[13px]" -> 13); null for auto. */
export function stepPx(step: null | string) {
  if (step === null || step === "auto") {
    return null;
  }
  const neg = step.startsWith("-") ? -1 : 1;
  const s = step.replace(/^-/, "");
  if (s === "px") {
    return neg;
  }
  const a = /^\[(\d+(?:\.\d+)?)(px|rem)\]$/.exec(s);
  if (a) {
    return neg * (a[2] === "rem" ? Number(a[1]) * 16 : Number(a[1]));
  }
  return neg * Number(s) * 4;
}
