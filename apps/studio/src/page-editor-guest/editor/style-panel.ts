/**
 * The Style panel: Text, Fill, Spacing and Shape controls bound to the page's
 * own theme tokens. It only describes changes as `StyleOp`s; the editor
 * applies them (class list in the page, then a splice of the file). Each
 * control reads its value from the class list as written in the file, falls
 * back to what the page computes, and shows itself as "set by the page" when
 * a probe found that a utility class cannot change that property on this
 * element. Also owns the color palette the swatches open.
 */
import { computePosition, flip, offset, shift } from "@floating-ui/dom";

import { closestIn, findAs } from "./dom";
import { icon, mark } from "./icons";
import {
  colorLabel,
  nextSize,
  nextSpace,
  RADII,
  readColor,
  readRadius,
  readShadow,
  readSize,
  readSpacing,
  readWeight,
  SHADOWS,
  type Side,
  stepPx,
  type Theme,
  WEIGHTS,
} from "./tokens";

/** Why a utility class cannot change a property here. */
export type BlockedBy = "page-css" | "responsive";

/**
 * One change the panel asks for: a class to add (replacing whatever it
 * overrides), or one to clear what it overrides and drop itself.
 */
export interface StyleOp {
  add?: string;
  /** What to ask the agent for when the editor cannot make the change. */
  change: string;
  clear?: string;
  key: string;
  label: string;
  /** The computed properties the change should move. */
  props: string[];
}

export interface StylePanelContext {
  /** Properties a class cannot change here, or null while the probe runs. */
  blocked: Map<string, BlockedBy> | null;
  colors: Map<string, string>;
  el: Element;
  kind: "box" | "image" | "text";
  /** What the element is called, lowercase: "heading". */
  name: string;
  onAsk: (ask: {
    change: string;
    prop: string;
    reason: BlockedBy | undefined;
  }) => void;
  onOp: (op: StyleOp) => void;
  /** Show a value without writing it, or stop showing one (null). */
  onPreview: (prop: null | string, value?: string) => void;
  /** Where the palette is drawn. */
  paletteHost: HTMLElement;
  theme: Theme;
  /** The class tokens as written in the file. */
  tokens: string[];
}

const SIDE_NAME: Record<Side, string> = {
  b: "bottom",
  l: "left",
  r: "right",
  t: "top",
};
const PROP: Record<string, string> = {
  bg: "background-color",
  color: "color",
  radius: "border-top-left-radius",
  shadow: "box-shadow",
  size: "font-size",
  weight: "font-weight",
};
const spaceProp = (kind: string, s: Side) =>
  `${kind === "p" ? "padding" : "margin"}-${SIDE_NAME[s]}`;
const isSide = (s: string | undefined): s is Side =>
  s === "t" || s === "r" || s === "b" || s === "l";
const fmt = (n: null | number) =>
  n === null
    ? "–"
    : Number.isInteger(n)
      ? String(n)
      : n.toFixed(1).replace(/\.0$/, "");
const px = (v: string) => Number.parseFloat(v) || 0;
const TRANSPARENT = /^(?:transparent|rgba\(0, 0, 0, 0\))$/;

const ICONS = {
  ask: mark(12),
  chevron: icon("caretDown", 10),
  lock: icon("lock", 12),
  minus: icon("minus", 12),
  plus: icon("plus", 12),
};

const SIDES: Side[] = ["t", "r", "b", "l"];

const STYLE_PROPS = {
  fill: ["background-color"],
  shape: ["border-top-left-radius", "box-shadow"],
  spacing: ["p", "m"].flatMap((k) => SIDES.map((s) => spaceProp(k, s))),
  text: ["font-size", "font-weight", "color"],
};

/**
 * Classes that each change one property to a value nothing on the page uses:
 * the property, the class, and the computed value it should give.
 */
export function probeClasses(
  cs: CSSStyleDeclaration,
): [prop: string, cls: string, want: string][] {
  const weightProbe =
    cs.fontWeight === "100" ? ["font-black", "900"] : ["font-thin", "100"];
  const out: [string, string, string][] = [
    ["font-size", "text-[7.25px]", "7.25px"],
    ["font-weight", weightProbe[0] ?? "", weightProbe[1] ?? ""],
    ["color", "text-[#010203]", "rgb(1, 2, 3)"],
    ["background-color", "bg-[#010203]", "rgb(1, 2, 3)"],
    ["border-top-left-radius", "rounded-[3.25px]", "3.25px"],
    ["box-shadow", "shadow-[0_0_0_3px_#010203]", "rgb(1, 2, 3)"],
  ];
  for (const [k, c] of [
    ["padding", "p"],
    ["margin", "m"],
  ] as const) {
    for (const s of SIDES) {
      out.push([`${k}-${SIDE_NAME[s]}`, `${c}${s}-[1.25px]`, "1.25px"]);
    }
  }
  return out;
}

const SIDE_BOX = ["Top", "Right", "Bottom", "Left"] as const;

/** Render the panel for `ctx.el` into `root`. */
export function renderStylePanel(root: HTMLElement, ctx: StylePanelContext) {
  const { blocked, colors, el, kind, theme, tokens } = ctx;
  const cs = getComputedStyle(el);
  const show = applicable(el, kind, tokens);
  const isBlocked = (prop: string) => blocked?.get(prop);
  root.innerHTML = "";
  const add = (html: string) => {
    const t = document.createElement("template");
    t.innerHTML = html.trim();
    const n = t.content.firstElementChild;
    if (!n) {
      throw new Error("The style panel drew nothing");
    }
    root.append(n);
    return n;
  };
  const section = (title: string, props: string[]) => {
    const s = add(`<section class="sp-sec"><h4>${title}</h4></section>`);
    const reasons = [
      ...new Set(props.map(isBlocked).filter((r) => r !== undefined)),
    ];
    if (reasons.length > 0 && props.every(isBlocked)) {
      s.classList.add("blocked");
      const note = add(
        `<div class="sp-blocked">${ICONS.lock}<span>${reasons[0] === "responsive" ? "Set per screen size here." : "The page’s stylesheet sets these."}</span><button type="button" class="linkish">${ICONS.ask}Ask</button></div>`,
      );
      findAs(note, "button", HTMLButtonElement).addEventListener(
        "click",
        () => {
          ctx.onAsk({
            change: `Change the ${title.toLowerCase()} of this element`,
            prop: props[0] ?? "",
            reason: reasons[0],
          });
        },
      );
      s.append(note);
    }
    return s;
  };
  const blockedTag = (prop: string) => {
    const r = isBlocked(prop);
    if (!r) {
      return "";
    }
    return `<span class="sp-lock" title="${r === "responsive" ? "A screen-size rule sets this at this width" : "The page’s stylesheet sets this, so a class has no effect"}">${ICONS.lock}</span>`;
  };

  // ---------------------------------------------------------------- Text
  if (show.text) {
    const s = section("Text", STYLE_PROPS.text);
    const size = readSize(tokens);
    const curPx = size.px ?? px(cs.fontSize);
    const w = readWeight(tokens);
    const curW = Number(cs.fontWeight);
    const color = readColor(theme, tokens, "text");
    const sizeName = size.name || (size.px === null ? "inherited" : "custom");
    const short: Record<string, string> = {
      Bold: "Bold",
      Medium: "Med",
      Regular: "Reg",
      Semibold: "Semi",
    };
    s.insertAdjacentHTML(
      "beforeend",
      `
      <div class="sp-row ${isBlocked("font-size") ? "is-blocked" : ""}" data-ctl="size">
        <label>Size ${blockedTag("font-size")}</label>
        <div class="stepper wide">
          <button type="button" data-step="-1" title="Smaller">${ICONS.minus}</button>
          <span class="val"><b>${fmt(curPx)}</b><small>${sizeName}</small></span>
          <button type="button" data-step="1" title="Larger">${ICONS.plus}</button>
        </div>
      </div>
      <div class="sp-row ${isBlocked("font-weight") ? "is-blocked" : ""}" data-ctl="weight">
        <label>Weight ${blockedTag("font-weight")}</label>
        <div class="seg">${WEIGHTS.map(([n, v, l]) => `<button type="button" data-v="${n}" class="${(w ? w === n : curW === v) ? "on" : ""}" style="font-weight:${v}" title="${l}">${short[l] ?? l}</button>`).join("")}</div>
      </div>
      <div class="sp-row ${isBlocked("color") ? "is-blocked" : ""}" data-ctl="color">
        <label>Color ${blockedTag("color")}</label>
        <button type="button" class="swatch-btn" data-palette="text">
          <span class="sw" style="background:${color ? (colors.get(color) ?? cs.color) : cs.color}"></span>
          <span class="nm">${color ? colorLabel(color) : "Inherited"}</span>${ICONS.chevron}
        </button>
      </div>`,
    );
    findAs(s, "[data-ctl=size]", HTMLElement).addEventListener("click", (e) => {
      const b = closestIn(e, "[data-step]");
      if (!b) {
        return;
      }
      const n = nextSize(curPx, Number(b.dataset.step));
      if (!n) {
        return;
      }
      ctx.onOp({
        add: `text-${n[0]}`,
        change: `Set the text size to ${n[1]}px (${n[0]})`,
        key: "size",
        label: `Text size ${fmt(curPx)} → ${n[1]}`,
        props: ["font-size"],
      });
    });
    findAs(s, "[data-ctl=weight]", HTMLElement).addEventListener(
      "click",
      (e) => {
        const b = closestIn(e, "[data-v]");
        if (!b || b.classList.contains("on")) {
          return;
        }
        const wv = WEIGHTS.find((x) => x[0] === b.dataset.v);
        if (!wv) {
          return;
        }
        ctx.onOp({
          add: `font-${wv[0]}`,
          change: `Make the text ${wv[2].toLowerCase()}`,
          key: "weight",
          label: `Weight → ${wv[2]}`,
          props: ["font-weight"],
        });
      },
    );
  }

  // ---------------------------------------------------------------- Fill
  if (show.fill) {
    const s = section("Fill", STYLE_PROPS.fill);
    const bg = readColor(theme, tokens, "bg");
    const none = !bg && TRANSPARENT.test(cs.backgroundColor);
    s.insertAdjacentHTML(
      "beforeend",
      `
      <div class="sp-row ${isBlocked("background-color") ? "is-blocked" : ""}" data-ctl="bg">
        <label>Background ${blockedTag("background-color")}</label>
        <button type="button" class="swatch-btn" data-palette="bg">
          <span class="sw ${none ? "none" : ""}" style="${none ? "" : `background:${bg ? (colors.get(bg) ?? cs.backgroundColor) : cs.backgroundColor}`}"></span>
          <span class="nm">${bg ? colorLabel(bg) : none ? "None" : "From the page"}</span>${ICONS.chevron}
        </button>
      </div>`,
    );
  }

  // ---------------------------------------------------------------- Spacing
  if (show.padding || show.margin) {
    const kinds = [show.margin && "m", show.padding && "p"].filter(Boolean);
    const s = section(
      show.margin && show.padding
        ? "Spacing"
        : show.padding
          ? "Padding"
          : "Margin",
      STYLE_PROPS.spacing.filter((p) =>
        kinds.some((k) => p.startsWith(k === "p" ? "padding" : "margin")),
      ),
    );
    const P = readSpacing(tokens, "p");
    const M = readSpacing(tokens, "m");
    const cell = (k: "m" | "p", side: Side) => {
      const prop = spaceProp(k, side);
      const step = (k === "p" ? P : M)[side];
      const val =
        step === "auto"
          ? "auto"
          : fmt(stepPx(step) ?? px(cs.getPropertyValue(prop)));
      const b = isBlocked(prop);
      return `<span class="num ${step === null ? "implicit" : ""} ${b ? "is-blocked" : ""}" data-k="${k}" data-side="${side}" title="${k === "p" ? "Padding" : "Margin"} ${SIDE_NAME[side]}${b ? " · set by the page" : ""}"><button type="button" data-step="-1" aria-label="Less">${ICONS.minus}</button><b>${val}</b><button type="button" data-step="1" aria-label="More">${ICONS.plus}</button></span>`;
    };
    const ring = (k: "m" | "p", inner: string) => `
          <div class="bm-top">${cell(k, "t")}</div>
          <div class="bm-mid">${cell(k, "l")}${inner}${cell(k, "r")}</div>
          <div class="bm-top">${cell(k, "b")}</div>`;
    const core = '<span class="bm-core"></span>';
    const padding = show.padding
      ? `<div class="bm-p">${show.margin ? '<span class="bm-label p">Padding</span>' : ""}${ring("p", core)}</div>`
      : core;
    s.insertAdjacentHTML(
      "beforeend",
      show.margin
        ? `<div class="boxmodel">${show.padding ? '<span class="bm-label m">Margin</span>' : ""}<div class="bm-m">${ring("m", padding)}</div></div>`
        : `<div class="boxmodel">${padding}</div>`,
    );
    findAs(s, ".boxmodel", HTMLElement).addEventListener("click", (e) => {
      const b = closestIn(e, "[data-step]");
      const n = b?.closest<HTMLElement>(".num");
      if (!b || !n) {
        return;
      }
      const k = n.dataset.k === "p" ? "p" : "m";
      const side = n.dataset.side;
      if (!isSide(side)) {
        return;
      }
      const prop = spaceProp(k, side);
      const step = (k === "p" ? P : M)[side];
      const cur =
        step === "auto"
          ? px(cs.getPropertyValue(prop))
          : (stepPx(step) ?? px(cs.getPropertyValue(prop)));
      const dir = Number(b.dataset.step);
      let next: null | string;
      if (cur < 0) {
        const m = nextSpace(-cur, -dir);
        next = m === null ? null : m === 0 ? "0" : `-${m}`;
      } else {
        const m = nextSpace(cur, dir);
        next = m === null ? null : String(m);
      }
      if (next === null) {
        return;
      }
      const nextPx = stepPx(next);
      const what = `${k === "p" ? "Padding" : "Margin"} ${SIDE_NAME[side]}`;
      const cls = next.startsWith("-")
        ? `-${k}${side}-${next.slice(1)}`
        : `${k}${side}-${next}`;
      ctx.onOp({
        add: cls,
        change: `Set the ${what.toLowerCase()} to ${fmt(nextPx)}px`,
        key: `${k}${side}`,
        label: `${what} ${fmt(cur)} → ${fmt(nextPx)}`,
        props: [prop],
      });
    });
  }

  // ---------------------------------------------------------------- Shape
  if (show.shape) {
    const s = section("Shape", STYLE_PROPS.shape);
    const r = readRadius(tokens);
    const sh = readShadow(tokens);
    s.insertAdjacentHTML(
      "beforeend",
      `
      <div class="sp-row ${isBlocked("border-top-left-radius") ? "is-blocked" : ""}" data-ctl="radius">
        <label>Corners ${blockedTag("border-top-left-radius")}</label>
        <div class="tiles">${RADII.map(([n, l]) => `<button type="button" data-v="${n}" class="${r === n ? "on" : ""}" title="${l}"><span class="corner r-${n}"></span></button>`).join("")}</div>
      </div>
      <div class="sp-row ${isBlocked("box-shadow") ? "is-blocked" : ""}" data-ctl="shadow">
        <label>Shadow ${blockedTag("box-shadow")}</label>
        <div class="tiles">${SHADOWS.map(([n, l]) => `<button type="button" data-v="${n}" class="${sh === n || (!sh && n === "none" && cs.boxShadow === "none") ? "on" : ""}" title="${l}"><span class="card s-${n}"></span><em>${l}</em></button>`).join("")}</div>
      </div>`,
    );
    findAs(s, "[data-ctl=radius]", HTMLElement).addEventListener(
      "click",
      (e) => {
        const b = closestIn(e, "[data-v]");
        if (!b || b.classList.contains("on")) {
          return;
        }
        const v = b.dataset.v ?? "";
        const l = RADII.find((x) => x[0] === v)?.[1] ?? v;
        ctx.onOp({
          add: `rounded-${v}`,
          change: `Set the corner radius to ${v}`,
          key: "radius",
          label: `Corners → ${l}`,
          props: ["border-top-left-radius"],
        });
      },
    );
    findAs(s, "[data-ctl=shadow]", HTMLElement).addEventListener(
      "click",
      (e) => {
        const b = closestIn(e, "[data-v]");
        if (!b || b.classList.contains("on")) {
          return;
        }
        const v = b.dataset.v ?? "";
        const l = SHADOWS.find((x) => x[0] === v)?.[1] ?? v;
        ctx.onOp(
          v === "none" && sh
            ? {
                change: "Remove the shadow",
                clear: "shadow-none",
                key: "shadow",
                label: "Shadow removed",
                props: ["box-shadow"],
              }
            : {
                add: `shadow-${v}`,
                change: `Give it a ${l} shadow`,
                key: "shadow",
                label: `Shadow → ${l}`,
                props: ["box-shadow"],
              },
        );
      },
    );
  }

  if (root.children.length === 0) {
    root.innerHTML =
      '<p class="ins-empty">Nothing here takes a style of its own. Press Esc to select what holds it.</p>';
  }

  for (const b of root.querySelectorAll<HTMLElement>("[data-palette]")) {
    b.addEventListener("click", () => {
      openPalette(ctx, b, b.dataset.palette === "text" ? "text" : "bg", cs);
    });
  }
  for (const row of root.querySelectorAll<HTMLElement>(".is-blocked")) {
    row.addEventListener(
      "click",
      (e) => {
        e.stopPropagation();
        e.preventDefault();
        const { ctl, k, side } = row.dataset;
        const spacingSide = isSide(side) ? side : "t";
        const prop = ctl ? (PROP[ctl] ?? "") : spaceProp(k ?? "", spacingSide);
        const step = closestIn(e, "[data-step]")?.dataset.step;
        const what = ctl
          ? (row.querySelector("label")?.textContent ?? "").trim().toLowerCase()
          : `${SIDE_NAME[spacingSide]} ${k === "p" ? "padding" : "margin"}`;
        const verb =
          step === "1" ? "Increase" : step === "-1" ? "Decrease" : "Change";
        ctx.onAsk({
          change: `${verb} the ${what} of this ${ctx.name}`,
          prop,
          reason: isBlocked(prop),
        });
      },
      true,
    );
  }
}

/**
 * Which sections would visibly do something on this element. Text controls
 * need text of its own; a fill needs something that is not an image; corners
 * and shadow need a surface to draw on (a fill, a border, a shadow, or an
 * image to clip), which a fill added here provides; padding shows on a
 * surface or around children, and margin needs a box that takes it (not an
 * inline run or a table cell).
 */
function applicable(
  el: Element,
  kind: StylePanelContext["kind"],
  tokens: string[],
) {
  const cs = getComputedStyle(el);
  const ownText =
    kind === "text" ||
    [...el.childNodes].some((n) => n instanceof Text && /\S/.test(n.data));
  const border = SIDE_BOX.some(
    (s) =>
      px(cs.getPropertyValue(`border-${s.toLowerCase()}-width`)) > 0 &&
      cs.getPropertyValue(`border-${s.toLowerCase()}-style`) !== "none",
  );
  const surface =
    !TRANSPARENT.test(cs.backgroundColor) ||
    cs.backgroundImage !== "none" ||
    border ||
    cs.boxShadow !== "none" ||
    tokens.some((t) => /^(?:bg|border|shadow|ring)(?:-|$)/.test(t));
  const d = cs.display;
  const inline = d === "inline";
  const cell = d === "table-cell";
  const row =
    /^table-(?:row|header-group|footer-group|column)/.test(d) ||
    d === "contents";
  const padded = SIDE_BOX.some(
    (s) => px(cs.getPropertyValue(`padding-${s.toLowerCase()}`)) > 0,
  );
  return {
    fill: kind !== "image" && !row,
    margin: !row && !cell && !inline,
    padding:
      !row &&
      kind !== "image" &&
      (surface || padded || cell || (kind === "box" && !inline)),
    shape: kind === "image" || surface,
    text: kind !== "image" && ownText,
  };
}

// ------------------------------------------------------------------ palette

let paletteCleanup: (() => void) | null = null;
export function closePalette() {
  paletteCleanup?.();
  paletteCleanup = null;
}

function openPalette(
  ctx: StylePanelContext,
  anchor: HTMLElement,
  which: "bg" | "text",
  cs: CSSStyleDeclaration,
) {
  closePalette();
  const { colors, theme, tokens } = ctx;
  const prefix = which === "text" ? "text" : "bg";
  const current = readColor(theme, tokens, prefix);
  const pal = document.createElement("div");
  pal.className = "palette";
  const sw = (name: string) =>
    `<button type="button" class="psw ${current === name ? "on" : ""}" data-name="${name}" title="${colorLabel(name)}" style="--c:${colors.get(name) ?? "transparent"}"></button>`;
  const semantic = which === "text" ? theme.textSemantic : theme.fillSemantic;
  pal.innerHTML = `
    <div class="p-head">${which === "text" ? "Text color" : "Background"}</div>
    <div class="p-group"><div class="p-label">Theme</div><div class="p-row">${which === "bg" ? `<button type="button" class="psw none ${!current && TRANSPARENT.test(cs.backgroundColor) ? "on" : ""}" data-name="" title="None"></button>` : ""}${semantic.map(sw).join("")}</div></div>
    ${theme.ramps.map((r) => `<div class="p-group"><div class="p-label">${colorLabel(r.name)}</div><div class="p-row">${r.steps.map(sw).join("")}</div></div>`).join("")}
    <details class="p-custom"><summary>Custom color</summary>
      <input type="color" class="hex-picker" aria-label="Color">
      <form class="p-hex"><span class="hash">#</span><input spellcheck="false" maxlength="7" aria-label="Hex color"><button type="submit" class="primary small">Apply</button></form>
    </details>
    <div class="p-foot"><span class="p-hover"></span></div>`;
  ctx.paletteHost.append(pal);
  const picker = findAs(pal, ".hex-picker", HTMLInputElement);
  const hexIn = findAs(pal, ".p-hex input", HTMLInputElement);
  const prop = which === "text" ? "color" : "background-color";
  const start = rgbToHex(
    which === "text"
      ? cs.color
      : TRANSPARENT.test(cs.backgroundColor)
        ? "#ffffff"
        : cs.backgroundColor,
  );
  picker.value = start;
  hexIn.value = start.slice(1);
  picker.addEventListener("input", () => {
    hexIn.value = picker.value.slice(1);
    ctx.onPreview(prop, picker.value);
  });
  hexIn.addEventListener("input", () => {
    if (/^[0-9a-f]{6}$/i.test(hexIn.value)) {
      picker.value = `#${hexIn.value}`;
      ctx.onPreview(prop, `#${hexIn.value}`);
    }
  });
  findAs(pal, ".p-hex", HTMLFormElement).addEventListener("submit", (e) => {
    e.preventDefault();
    const hex = `#${hexIn.value.replace(/^#/, "").toLowerCase()}`;
    if (!/^#[0-9a-f]{6}$/.test(hex)) {
      return;
    }
    ctx.onPreview(null);
    closePalette();
    ctx.onOp({
      add: `${prefix}-[${hex}]`,
      change: `Set the ${which === "text" ? "text color" : "background"} to ${hex}`,
      key: prefix,
      label: `${which === "text" ? "Text color" : "Background"} → ${hex}`,
      props: [prop],
    });
  });
  const hover = findAs(pal, ".p-hover", HTMLElement);
  pal.addEventListener("mouseover", (e) => {
    const b = closestIn(e, ".psw");
    hover.textContent = b ? b.title : "";
  });
  pal.addEventListener("click", (e) => {
    const b = closestIn(e, ".psw");
    if (!b) {
      return;
    }
    const name = b.dataset.name;
    closePalette();
    if (b.classList.contains("on")) {
      return;
    }
    if (!name) {
      ctx.onOp(
        current
          ? {
              change: "Remove the background",
              clear: "bg-[transparent]",
              key: prefix,
              label: "Background removed",
              props: ["background-color"],
            }
          : {
              add: "bg-transparent",
              change: "Remove the background",
              key: prefix,
              label: "Background → None",
              props: ["background-color"],
            },
      );
      return;
    }
    ctx.onOp({
      add: `${prefix}-${name}`,
      change: `Set the ${which === "text" ? "text color" : "background"} to the theme's ${colorLabel(name)} (${prefix}-${name})`,
      key: prefix,
      label: `${which === "text" ? "Text color" : "Background"} → ${colorLabel(name)}`,
      props: [prop],
    });
  });
  const place = () =>
    computePosition(anchor, pal, {
      middleware: [
        offset(10),
        flip({ fallbackPlacements: ["bottom-end", "top-end"], padding: 10 }),
        shift({ padding: 10 }),
      ],
      placement: "left-start",
      strategy: "fixed",
    }).then(({ x, y }) => {
      pal.style.left = `${x}px`;
      pal.style.top = `${y}px`;
    });
  void place();
  findAs(pal, "details", HTMLDetailsElement).addEventListener("toggle", () => {
    void place();
  });
  // A press inside the editor's closed root is judged there, where the
  // element pressed is seen; one on the page always closes the palette.
  const root = pal.getRootNode();
  const host = root instanceof ShadowRoot ? root.host : null;
  const away = (e: Event) => {
    if (!e.isTrusted) {
      return;
    }
    const t = e.composedPath()[0];
    if (!(t instanceof Node) || (!pal.contains(t) && !anchor.contains(t))) {
      ctx.onPreview(null);
      closePalette();
    }
  };
  const awayOnPage = (e: Event) => {
    if (!e.isTrusted || (host && e.composedPath().includes(host))) {
      return;
    }
    ctx.onPreview(null);
    closePalette();
  };
  const key = (e: KeyboardEvent) => {
    if (e.isTrusted && e.key === "Escape") {
      ctx.onPreview(null);
      closePalette();
    }
  };
  setTimeout(() => {
    root.addEventListener("pointerdown", away, true);
    document.addEventListener("pointerdown", awayOnPage, true);
  }, 0);
  document.addEventListener("keydown", key, true);
  paletteCleanup = () => {
    root.removeEventListener("pointerdown", away, true);
    document.removeEventListener("pointerdown", awayOnPage, true);
    document.removeEventListener("keydown", key, true);
    pal.remove();
  };
}

function rgbToHex(rgb: string) {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(rgb);
  if (!m) {
    return "#000000";
  }
  return `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("")}`;
}
