// The Style panel: Text, Fill, Spacing and Shape controls bound to the page's
// own theme tokens. It only describes changes; main.js applies them (class list
// in the page, then a splice of the file). Each control reads its value from
// the class list as written in the file, falls back to what the page computes,
// and shows itself as "set by the page" when a probe found that a utility
// class cannot change that property on this element.
import { computePosition, flip, offset, shift } from "@floating-ui/dom";

import { icon, mark } from "./icons.js";
import {
  RADII,
  SHADOWS,
  SIZES,
  WEIGHTS,
  colorLabel,
  nextSize,
  nextSpace,
  readColor,
  readRadius,
  readShadow,
  readSize,
  readSpacing,
  readWeight,
  stepPx,
} from "./tokens.js";

const SIDE_NAME = { t: "top", r: "right", b: "bottom", l: "left" };
const PROP = {
  size: "font-size",
  weight: "font-weight",
  color: "color",
  bg: "background-color",
  radius: "border-top-left-radius",
  shadow: "box-shadow",
};
const spaceProp = (kind, s) =>
  `${kind === "p" ? "padding" : "margin"}-${SIDE_NAME[s]}`;
const fmt = (n) =>
  n == null
    ? "–"
    : Number.isInteger(n)
      ? String(n)
      : n.toFixed(1).replace(/\.0$/, "");
const px = (v) => Number.parseFloat(v) || 0;
const TRANSPARENT = /^(transparent|rgba\(0, 0, 0, 0\))$/;

const ICONS = {
  minus: icon("minus", 12),
  plus: icon("plus", 12),
  chevron: icon("caretDown", 10),
  ask: mark(12),
  lock: icon("lock", 12),
};

export const STYLE_PROPS = {
  text: ["font-size", "font-weight", "color"],
  fill: ["background-color"],
  spacing: ["p", "m"].flatMap((k) =>
    ["t", "r", "b", "l"].map((s) => spaceProp(k, s)),
  ),
  shape: ["border-top-left-radius", "box-shadow"],
};

/** Classes that each change one property to a value nothing on the page uses. */
export function probeClasses(cs) {
  const weightProbe =
    cs.fontWeight === "100" ? ["font-black", "900"] : ["font-thin", "100"];
  const out = [
    ["font-size", "text-[7.25px]", "7.25px"],
    ["font-weight", weightProbe[0], weightProbe[1]],
    ["color", "text-[#010203]", "rgb(1, 2, 3)"],
    ["background-color", "bg-[#010203]", "rgb(1, 2, 3)"],
    ["border-top-left-radius", "rounded-[3.25px]", "3.25px"],
    ["box-shadow", "shadow-[0_0_0_3px_#010203]", "rgb(1, 2, 3)"],
  ];
  for (const [k, c] of [
    ["padding", "p"],
    ["margin", "m"],
  ]) {
    for (const s of ["t", "r", "b", "l"])
      out.push([`${k}-${SIDE_NAME[s]}`, `${c}${s}-[1.25px]`, "1.25px"]);
  }
  return out;
}

/**
 * Which sections would visibly do something on this element. Text controls
 * need text of its own; a fill needs something that is not an image; corners
 * and shadow need a surface to draw on (a fill, a border, a shadow, or an
 * image to clip), which a fill added here provides; padding shows on a
 * surface or around children, and margin needs a box that takes it (not an
 * inline run or a table cell).
 */
export function applicable(el, kind, tokens) {
  const cs = el.ownerDocument.defaultView.getComputedStyle(el);
  const ownText =
    kind === "text" ||
    [...el.childNodes].some((n) => n.nodeType === 3 && /\S/.test(n.data));
  const border = ["Top", "Right", "Bottom", "Left"].some(
    (s) => px(cs[`border${s}Width`]) > 0 && cs[`border${s}Style`] !== "none",
  );
  const surface =
    !TRANSPARENT.test(cs.backgroundColor) ||
    cs.backgroundImage !== "none" ||
    border ||
    cs.boxShadow !== "none" ||
    tokens.some((t) => /^(bg|border|shadow|ring)(-|$)/.test(t));
  const d = cs.display;
  const inline = d === "inline";
  const cell = d === "table-cell";
  const row =
    /^table-(row|row-group|header-group|footer-group|column)/.test(d) ||
    d === "contents";
  const padded = ["Top", "Right", "Bottom", "Left"].some(
    (s) => px(cs[`padding${s}`]) > 0,
  );
  return {
    text: kind !== "image" && ownText,
    fill: kind !== "image" && !row,
    shape: kind === "image" || surface,
    padding:
      !row &&
      kind !== "image" &&
      (surface || padded || cell || (kind === "box" && !inline)),
    margin: !row && !cell && !inline,
  };
}

/**
 * Render into `root`. ctx:
 *   el, kind ('text' | 'box' | 'image'), tokens (source class tokens), theme,
 *   colors (Map token -> rgb), blocked (Map prop -> reason, or null while probing),
 *   onOp(op), onAsk({ change, prop }), onPreview(prop, value | null), paletteHost
 * An op is { key, add?, clear?, props, label, change }.
 */
export function renderStylePanel(root, ctx) {
  const { el, kind, tokens, theme, colors, blocked } = ctx;
  const cs = el.ownerDocument.defaultView.getComputedStyle(el);
  const show = applicable(el, kind, tokens);
  const isBlocked = (prop) => blocked?.get(prop);
  root.innerHTML = "";
  const add = (html) => {
    const t = document.createElement("template");
    t.innerHTML = html.trim();
    const n = t.content.firstElementChild;
    root.append(n);
    return n;
  };
  const section = (title, props) => {
    const s = add(`<section class="sp-sec"><h4>${title}</h4></section>`);
    const reasons = [...new Set(props.map(isBlocked).filter(Boolean))];
    if (reasons.length && props.every(isBlocked)) {
      s.classList.add("blocked");
      const note = add(
        `<div class="sp-blocked">${ICONS.lock}<span>${reasons[0] === "responsive" ? "Set per screen size here." : "The page’s stylesheet sets these."}</span><button type="button" class="linkish">${ICONS.ask}Ask Instrument</button></div>`,
      );
      note.querySelector("button").onclick = () =>
        ctx.onAsk({
          change: `Change the ${title.toLowerCase()} of this element`,
          prop: props[0],
          reason: reasons[0],
        });
      s.append(note);
    }
    return s;
  };
  const blockedTag = (prop) => {
    const r = isBlocked(prop);
    if (!r) return "";
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
    const sizeName = size.name
      ? size.name
      : size.px != null
        ? "custom"
        : "inherited";
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
        <div class="seg">${WEIGHTS.map(([n, v, l]) => `<button type="button" data-v="${n}" class="${(w ? w === n : curW === v) ? "on" : ""}" style="font-weight:${v}" title="${l}">${{ Regular: "Reg", Medium: "Med", Semibold: "Semi", Bold: "Bold" }[l]}</button>`).join("")}</div>
      </div>
      <div class="sp-row ${isBlocked("color") ? "is-blocked" : ""}" data-ctl="color">
        <label>Color ${blockedTag("color")}</label>
        <button type="button" class="swatch-btn" data-palette="text">
          <span class="sw" style="background:${color ? (colors.get(color) ?? cs.color) : cs.color}"></span>
          <span class="nm">${color ? colorLabel(color) : "Inherited"}</span>${ICONS.chevron}
        </button>
      </div>`,
    );
    s.querySelector("[data-ctl=size]").onclick = (e) => {
      const b = e.target.closest("[data-step]");
      if (!b) return;
      const n = nextSize(curPx, Number(b.dataset.step));
      if (!n) return;
      ctx.onOp({
        key: "size",
        add: `text-${n[0]}`,
        props: ["font-size"],
        label: `Text size ${fmt(curPx)} → ${n[1]}`,
        change: `Set the text size to ${n[1]}px (${n[0]})`,
      });
    };
    s.querySelector("[data-ctl=weight]").onclick = (e) => {
      const b = e.target.closest("[data-v]");
      if (!b || b.classList.contains("on")) return;
      const wv = WEIGHTS.find((x) => x[0] === b.dataset.v);
      ctx.onOp({
        key: "weight",
        add: `font-${wv[0]}`,
        props: ["font-weight"],
        label: `Weight → ${wv[2]}`,
        change: `Make the text ${wv[2].toLowerCase()}`,
      });
    };
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
    const cell = (k, side) => {
      const prop = spaceProp(k, side);
      const step = (k === "p" ? P : M)[side];
      const val =
        step === "auto"
          ? "auto"
          : fmt(stepPx(step) ?? px(cs.getPropertyValue(prop)));
      const b = isBlocked(prop);
      return `<span class="num ${step == null ? "implicit" : ""} ${b ? "is-blocked" : ""}" data-k="${k}" data-side="${side}" title="${k === "p" ? "Padding" : "Margin"} ${SIDE_NAME[side]}${b ? " · set by the page" : ""}"><button type="button" data-step="-1" aria-label="Less">${ICONS.minus}</button><b>${val}</b><button type="button" data-step="1" aria-label="More">${ICONS.plus}</button></span>`;
    };
    const ring = (k, inner) => `
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
    s.querySelector(".boxmodel").onclick = (e) => {
      const b = e.target.closest("[data-step]");
      if (!b) return;
      const n = b.closest(".num");
      const { k, side } = n.dataset;
      const prop = spaceProp(k, side);
      const step = (k === "p" ? P : M)[side];
      const cur =
        step === "auto"
          ? px(cs.getPropertyValue(prop))
          : (stepPx(step) ?? px(cs.getPropertyValue(prop)));
      const dir = Number(b.dataset.step);
      let next;
      if (cur < 0) {
        const m = nextSpace(-cur, -dir);
        next = m == null ? null : m === 0 ? "0" : `-${m}`;
      } else {
        const m = nextSpace(cur, dir);
        next = m == null ? null : String(m);
      }
      if (next == null) return;
      const nextPx = stepPx(next);
      const what = `${k === "p" ? "Padding" : "Margin"} ${SIDE_NAME[side]}`;
      const cls = next.startsWith("-")
        ? `-${k}${side}-${next.slice(1)}`
        : `${k}${side}-${next}`;
      ctx.onOp({
        key: `${k}${side}`,
        add: cls,
        props: [prop],
        label: `${what} ${fmt(cur)} → ${fmt(nextPx)}`,
        change: `Set the ${what.toLowerCase()} to ${fmt(nextPx)}px`,
      });
    };
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
    s.querySelector("[data-ctl=radius]").onclick = (e) => {
      const b = e.target.closest("[data-v]");
      if (!b || b.classList.contains("on")) return;
      const l = RADII.find((x) => x[0] === b.dataset.v)[1];
      ctx.onOp({
        key: "radius",
        add: `rounded-${b.dataset.v}`,
        props: ["border-top-left-radius"],
        label: `Corners → ${l}`,
        change: `Set the corner radius to ${b.dataset.v}`,
      });
    };
    s.querySelector("[data-ctl=shadow]").onclick = (e) => {
      const b = e.target.closest("[data-v]");
      if (!b || b.classList.contains("on")) return;
      const l = SHADOWS.find((x) => x[0] === b.dataset.v)[1];
      const v = b.dataset.v;
      ctx.onOp(
        v === "none" && sh
          ? {
              key: "shadow",
              clear: "shadow-none",
              props: ["box-shadow"],
              label: "Shadow removed",
              change: "Remove the shadow",
            }
          : {
              key: "shadow",
              add: `shadow-${v}`,
              props: ["box-shadow"],
              label: `Shadow → ${l}`,
              change: `Give it a ${l} shadow`,
            },
      );
    };
  }

  if (!root.children.length)
    root.innerHTML =
      '<p class="ins-empty">Nothing here takes a style of its own. Press Esc to select what holds it.</p>';

  for (const b of root.querySelectorAll("[data-palette]")) {
    b.onclick = () => openPalette(ctx, b, b.dataset.palette, cs);
  }
  for (const row of root.querySelectorAll(".is-blocked")) {
    row.addEventListener(
      "click",
      (e) => {
        e.stopPropagation();
        e.preventDefault();
        const prop = row.dataset.ctl
          ? PROP[row.dataset.ctl]
          : spaceProp(row.dataset.k, row.dataset.side);
        const step = e.target.closest("[data-step]")?.dataset.step;
        const what = row.dataset.ctl
          ? row.querySelector("label").textContent.trim().toLowerCase()
          : `${SIDE_NAME[row.dataset.side]} ${row.dataset.k === "p" ? "padding" : "margin"}`;
        const verb =
          step === "1" ? "Increase" : step === "-1" ? "Decrease" : "Change";
        ctx.onAsk({
          change: `${verb} the ${what} of this ${ctx.name ?? "element"}`,
          prop,
          reason: isBlocked(prop),
        });
      },
      true,
    );
  }
}

// ------------------------------------------------------------------ palette

let paletteCleanup = null;
export function closePalette() {
  paletteCleanup?.();
  paletteCleanup = null;
}

function openPalette(ctx, anchor, which, cs) {
  closePalette();
  const { theme, colors, tokens } = ctx;
  const prefix = which === "text" ? "text" : "bg";
  const current = readColor(theme, tokens, prefix);
  const pal = document.createElement("div");
  pal.className = "palette";
  const sw = (name) =>
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
  const picker = pal.querySelector(".hex-picker");
  const hexIn = pal.querySelector(".p-hex input");
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
    ctx.onPreview(
      which === "text" ? "color" : "background-color",
      picker.value,
    );
  });
  hexIn.addEventListener("input", () => {
    if (/^[0-9a-f]{6}$/i.test(hexIn.value)) {
      picker.value = `#${hexIn.value}`;
      ctx.onPreview(
        which === "text" ? "color" : "background-color",
        `#${hexIn.value}`,
      );
    }
  });
  pal.querySelector(".p-hex").onsubmit = (e) => {
    e.preventDefault();
    const hex = `#${hexIn.value.replace(/^#/, "").toLowerCase()}`;
    if (!/^#[0-9a-f]{6}$/.test(hex)) return;
    ctx.onPreview(null);
    closePalette();
    ctx.onOp({
      key: prefix,
      add: `${prefix}-[${hex}]`,
      props: [which === "text" ? "color" : "background-color"],
      label: `${which === "text" ? "Text color" : "Background"} → ${hex}`,
      change: `Set the ${which === "text" ? "text color" : "background"} to ${hex}`,
    });
  };
  const hover = pal.querySelector(".p-hover");
  pal.addEventListener("mouseover", (e) => {
    const b = e.target.closest(".psw");
    hover.textContent = b ? b.title : "";
  });
  pal.addEventListener("click", (e) => {
    const b = e.target.closest(".psw");
    if (!b) return;
    const name = b.dataset.name;
    closePalette();
    if (b.classList.contains("on")) return;
    if (!name)
      return ctx.onOp(
        current
          ? {
              key: prefix,
              clear: "bg-[transparent]",
              props: ["background-color"],
              label: "Background removed",
              change: "Remove the background",
            }
          : {
              key: prefix,
              add: "bg-transparent",
              props: ["background-color"],
              label: "Background → None",
              change: "Remove the background",
            },
      );
    ctx.onOp({
      key: prefix,
      add: `${prefix}-${name}`,
      props: [which === "text" ? "color" : "background-color"],
      label: `${which === "text" ? "Text color" : "Background"} → ${colorLabel(name)}`,
      change: `Set the ${which === "text" ? "text color" : "background"} to the theme's ${colorLabel(name)} (${prefix}-${name})`,
    });
  });
  const place = () =>
    computePosition(anchor, pal, {
      strategy: "fixed",
      placement: "left-start",
      middleware: [
        offset(10),
        flip({ fallbackPlacements: ["bottom-end", "top-end"], padding: 10 }),
        shift({ padding: 10 }),
      ],
    }).then(({ x, y }) => {
      pal.style.left = `${x}px`;
      pal.style.top = `${y}px`;
    });
  place();
  pal.querySelector("details").addEventListener("toggle", place);
  const away = (e) => {
    const t = e.composedPath()[0];
    if (!pal.contains(t) && !anchor.contains(t)) {
      ctx.onPreview(null);
      closePalette();
    }
  };
  const key = (e) => {
    if (e.key === "Escape") {
      ctx.onPreview(null);
      closePalette();
    }
  };
  setTimeout(() => document.addEventListener("pointerdown", away, true), 0);
  document.addEventListener("keydown", key, true);
  paletteCleanup = () => {
    document.removeEventListener("pointerdown", away, true);
    document.removeEventListener("keydown", key, true);
    pal.remove();
  };
}

function rgbToHex(rgb) {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(rgb);
  if (!m) return "#000000";
  return `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("")}`;
}
