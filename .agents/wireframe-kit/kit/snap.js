// Snapshots: frames drawn from Studio as it runs, not redrawn. snap/capture.mjs keeps
// the app's own DOM in each state a round may start from, and snap() draws a frame from
// one, edited by name, so whatever the edit leaves alone is the app itself. Every edit
// is marked "new" unless it says { quiet: true }, so a reader sees exactly what the
// proposal changes. The build runs the edits in Node and the page carries the result;
// pressing B on the page shows each frame as it was captured, before the edits.
// SNAPSHOTS.md is how to use it; snap/library.mjs writes the library's INDEX.md.

/**
 * A frame from the snapshot `state` (INDEX.md lists them; `<name>.dark` for dark),
 * edited by `edit($)`. `$(target)` finds one element by what a person reads (its
 * outline name, the way studio-drive targets are written) and hands back the edits
 * below. Returns the frame's HTML at the snapshot's true size, 1280x800.
 * @param {string} state
 * @param {(($: SnapQuery) => void)} [edit]
 */
function snap(state, edit) {
  return typeof __snapHost === "undefined" ? __snapInPage() : __snapBuild(state, edit);
}

/** @typedef {((target: SnapTarget) => SnapEl) & { root: SnapEl }} SnapQuery */
/** @typedef {string | { text?: string, contains?: string, label?: string, role?: string, selector?: string, nth?: number, within?: SnapTarget }} SnapTarget */
/** @typedef {any} SnapEl */

const __SNAP_ROLES = {
  button: "button,[role=button]",
  link: "a[href],[role=link]",
  textbox: "textarea,input:not([type=checkbox]):not([type=radio]),[role=textbox],[contenteditable=true]",
  heading: "h1,h2,h3,h4,h5,h6,[role=heading]",
  listitem: "li,[role=listitem]",
  navigation: "nav,[role=navigation]",
  dialog: "dialog,[role=dialog],[role=alertdialog]",
  image: "img,svg[role=img],[role=img]",
};
const __SNAP_VOID = /^(img|input|textarea|br|hr|svg|use|path|video|canvas)$/i;

/** The words a person would find an element by: its label, placeholder, alt, or text. */
const __snapName = (/** @type {any} */ el) =>
  String(el.getAttribute?.("aria-label") || el.getAttribute?.("placeholder") || el.getAttribute?.("alt") || el.textContent || "")
    .replace(/\s+/g, " ")
    .trim();

const __snapDescribe = (/** @type {any} */ el) => {
  const role = el.getAttribute("role") || el.tagName.toLowerCase();
  const name = __snapName(el);
  return `${role} "${name.length > 60 ? `${name.slice(0, 60)}…` : name}"`;
};

function __snapFind(/** @type {any} */ scope, /** @type {SnapTarget} */ target, /** @type {string} */ state) {
  const t = typeof target === "string" ? { text: target } : target;
  const where = t.within ? __snapFind(scope, t.within, state) : scope;
  let els = [...where.querySelectorAll(t.selector ?? "*")];
  if (t.role) {
    const implicit = __SNAP_ROLES[/** @type {keyof typeof __SNAP_ROLES} */ (t.role)];
    els = els.filter((el) => el.getAttribute("role") === t.role || (implicit && el.matches(implicit)));
  }
  if (t.label !== undefined) els = els.filter((el) => el.getAttribute("aria-label") === t.label);
  if (t.text !== undefined) els = els.filter((el) => __snapName(el) === t.text || el.getAttribute("aria-label") === t.text);
  if (t.contains !== undefined) els = els.filter((el) => __snapName(el).includes(/** @type {string} */ (t.contains)));
  // Of nested matches (a button and the span holding its words), the innermost; `.up()` climbs.
  if (!t.role && !t.selector) els = els.filter((el) => !els.some((o) => o !== el && el.contains(o)));
  else els = els.filter((el) => !els.some((o) => o !== el && o.contains(el)));
  const asked = JSON.stringify(target);
  if (els.length === 0) {
    const word = String(t.text ?? t.contains ?? t.label ?? "").split(/\s+/)[0]?.toLowerCase() ?? "";
    const near = word
      ? [...where.querySelectorAll("button,a,[role],input,h1,h2,h3,li,span,p")].filter((el) => __snapName(el).toLowerCase().includes(word)).slice(0, 8).map(__snapDescribe)
      : [];
    throw new Error(`snap("${state}"): nothing matches ${asked}.${near.length ? ` Close: ${near.join("; ")}.` : ""} The state's .outline.txt has every name, and snap/peek.mjs shows an element's HTML.`);
  }
  if (t.nth !== undefined) {
    const el = els[t.nth - 1];
    if (!el) throw new Error(`snap("${state}"): ${asked} has ${els.length} matches, not ${t.nth}`);
    return el;
  }
  if (els.length > 1)
    throw new Error(`snap("${state}"): ${asked} matches ${els.length} elements (${els.slice(0, 6).map(__snapDescribe).join("; ")}). Add a role, { within }, or { nth }.`);
  return els[0];
}

function __snapBuild(/** @type {string} */ state, /** @type {any} */ edit) {
  const s = __snapHost.load(state);
  const doc = __snapHost.doc();
  const root = doc.createElement("div");
  root.className = "snap";
  root.setAttribute("data-snap", state);
  root.setAttribute(
    "style",
    `position:relative;width:${s.w}px;height:${s.h}px;overflow:hidden;container:snap / size;--snap-vh:${s.h / 100}px;--snap-vw:${s.w / 100}px`,
  );
  // The window's lights are drawn by macOS over the web contents, so a capture has none.
  root.innerHTML = `${s.html}<div aria-hidden="true" style="position:absolute;left:0;top:0;height:40px;display:flex;align-items:center;pointer-events:none;z-index:2147483646">${trafficLights}</div>`;
  const baseHtml = root.innerHTML;
  const markOn = (/** @type {any} */ el, label = "new", tone = "new", pointer = false) => {
    const host = __SNAP_VOID.test(el.tagName) ? el.parentElement : el;
    if (!host || [...host.children].some((c) => c.matches("i.mark") && c.getAttribute("data-label") === label)) return;
    host.insertAdjacentHTML("beforeend", ann(label, tone) + (pointer ? cursor : ""));
  };
  const parse = (/** @type {string} */ html) => {
    const tpl = doc.createElement("template");
    tpl.innerHTML = html;
    return [...tpl.content.childNodes];
  };
  const nodesOf = (/** @type {any} */ x) => (typeof x === "string" ? parse(x) : [x.el]);
  /** Inserted nodes are marked, words alone wrapped so the mark has a box to ring. */
  const placed = (/** @type {any[]} */ nodes, /** @type {any} */ o) => {
    for (const n of nodes) {
      if (n.nodeType === 1) {
        if (!o?.quiet) markOn(n);
      } else if (n.nodeType === 3 && n.nodeValue.trim() && !o?.quiet) {
        const span = doc.createElement("span");
        n.replaceWith(span);
        span.append(n);
        markOn(span);
      }
    }
  };
  const wrap = (/** @type {any} */ el, detached = false) => {
    const changed = (/** @type {any} */ o) => {
      if (!detached && !o?.quiet) markOn(el);
    };
    const w = {
      el,
      /** One element inside this one. */
      find: (/** @type {SnapTarget} */ t) => wrap(__snapFind(el, t, state), detached),
      /** The nearest element around this one matching a selector or a role (`"button"`, `"row"`). */
      up: (/** @type {string} */ sel) => {
        const implicit = __SNAP_ROLES[/** @type {keyof typeof __SNAP_ROLES} */ (sel)];
        let a = el.parentElement;
        while (a && !(a.getAttribute("role") === sel || (implicit ? a.matches(implicit) : (() => { try { return a.matches(sel); } catch { return false; } })()))) a = a.parentElement;
        if (!a) throw new Error(`snap("${state}"): no ${sel} around ${__snapDescribe(el)}`);
        return wrap(a, detached);
      },
      /** `.text(to)` sets the one piece of words inside; `.text(from, to)` replaces those words. */
      text: (/** @type {string} */ a, /** @type {any} */ b, /** @type {any} */ c) => {
        const [from, to, o] = typeof b === "string" ? [a, b, c] : [undefined, a, b];
        const walker = doc.createTreeWalker(el, 4);
        const nodes = [];
        for (let n = walker.nextNode(); n; n = walker.nextNode()) if (n.nodeValue.trim()) nodes.push(n);
        if (from === undefined) {
          if (nodes.length === 1) nodes[0].nodeValue = nodes[0].nodeValue.replace(nodes[0].nodeValue.trim(), to);
          else if (nodes.length === 0) el.append(doc.createTextNode(to));
          else
            throw new Error(
              `snap("${state}"): ${__snapDescribe(el)} holds ${nodes.length} pieces of words (${nodes.slice(0, 5).map((n) => JSON.stringify(n.nodeValue.trim())).join(", ")}); say which with .text(from, to)`,
            );
        } else {
          let hit = false;
          for (const n of nodes)
            if (n.nodeValue.includes(from)) {
              n.nodeValue = n.nodeValue.replace(from, to);
              hit = true;
            }
          if (!hit) throw new Error(`snap("${state}"): ${__snapDescribe(el)} has no words "${from}"`);
        }
        const label = el.getAttribute("aria-label");
        if (label && from && label.includes(from)) el.setAttribute("aria-label", label.replace(from, to));
        changed(o);
        return w;
      },
      /** Replaces what is inside. */
      html: (/** @type {string} */ html, /** @type {any} */ o) => {
        el.innerHTML = html;
        changed(o);
        return w;
      },
      /** Puts HTML (or a clone) in this element's place. */
      replace: (/** @type {any} */ x, /** @type {any} */ o) => {
        const nodes = nodesOf(x);
        el.replaceWith(...nodes);
        placed(nodes, o);
        return nodes[0]?.nodeType === 1 ? wrap(nodes[0], detached) : w;
      },
      before: (/** @type {any} */ x, /** @type {any} */ o) => {
        const nodes = nodesOf(x);
        el.before(...nodes);
        placed(nodes, o);
        return w;
      },
      after: (/** @type {any} */ x, /** @type {any} */ o) => {
        const nodes = nodesOf(x);
        el.after(...nodes);
        placed(nodes, o);
        return w;
      },
      append: (/** @type {any} */ x, /** @type {any} */ o) => {
        const nodes = nodesOf(x);
        el.append(...nodes);
        placed(nodes, o);
        return w;
      },
      prepend: (/** @type {any} */ x, /** @type {any} */ o) => {
        const nodes = nodesOf(x);
        el.prepend(...nodes);
        placed(nodes, o);
        return w;
      },
      /** A copy to change and then place with before/after/append/replace, marked once placed. */
      clone: () => wrap(el.cloneNode(true), true),
      remove: () => {
        el.remove();
        return w;
      },
      /** Keeps its room but draws nothing. */
      hide: () => {
        el.setAttribute("style", `${el.getAttribute("style") ?? ""};visibility:hidden`);
        return w;
      },
      attr: (/** @type {string} */ name, /** @type {string | null} */ value, /** @type {any} */ o) => {
        if (value === null) el.removeAttribute(name);
        else el.setAttribute(name, value);
        changed(o);
        return w;
      },
      addClass: (/** @type {string} */ cls, /** @type {any} */ o) => {
        el.classList.add(...cls.split(/\s+/).filter(Boolean));
        changed(o);
        return w;
      },
      removeClass: (/** @type {string} */ cls, /** @type {any} */ o) => {
        el.classList.remove(...cls.split(/\s+/).filter(Boolean));
        changed(o);
        return w;
      },
      /** Takes another element's look: its classes and its variant and size, as a button's. */
      look: (/** @type {SnapTarget} */ t, /** @type {any} */ o) => {
        const src = __snapFind(root, t, state);
        el.setAttribute("class", src.getAttribute("class") ?? "");
        for (const a of ["data-variant", "data-size"]) {
          const v = src.getAttribute(a);
          if (v === null) el.removeAttribute(a);
          else el.setAttribute(a, v);
        }
        changed(o);
        return w;
      },
      /** Adds inline style, as `"left: 40px; width: 320px"`. */
      css: (/** @type {string} */ style, /** @type {any} */ o) => {
        el.setAttribute("style", `${el.getAttribute("style") ?? ""};${style}`);
        changed(o);
        return w;
      },
      /** A mark of its own: `.mark()` is "new", `.mark("moved")` any word. */
      mark: (label = "new", tone = "new") => {
        markOn(el, label, tone);
        return w;
      },
      /** The one thing clicked in this frame. */
      click: () => {
        markOn(el, "click", "click", true);
        return w;
      },
    };
    return w;
  };
  // $.root is the snapshot's own <html>, where the app's colors and fonts are defined, so
  // something placed over everything is drawn in them.
  const page = root.querySelector(".snap-html") ?? root;
  const $ = /** @type {SnapQuery} */ (Object.assign((/** @type {SnapTarget} */ t) => wrap(__snapFind(root, t, state)), { root: wrap(page) }));
  if (edit) edit($);
  const html = `<!--snap:start-->${root.outerHTML}<!--snap:end-->`;
  (globalThis.__snapBuilt ??= []).push({ state, html, base: baseHtml });
  return html;
}

/** @type {null | { built: string[], base: Record<string, string>, assets: string[], sprites: string }} */
let __snapData = null;
let __snapNext = 0;

/** On the page: the next frame the build drew, in the order the part asks for them. */
function __snapInPage() {
  if (!__snapData) {
    const data = document.getElementById("snap-data");
    if (!data) throw new Error("snap(): this page was not built with its snapshots; build it with build.mjs");
    __snapData = JSON.parse(data.textContent ?? "{}");
    __snapPageSetup();
  }
  const html = /** @type {NonNullable<typeof __snapData>} */ (__snapData).built[__snapNext++] ?? "";
  return __snapAssets(html);
}

const __snapAssets = (/** @type {string} */ html) => html.replace(/snap-asset:(\d+)/g, (_, i) => /** @type {NonNullable<typeof __snapData>} */ (__snapData).assets[Number(i)] ?? "");

/** Sprites once, scroll positions as captured, and B for the frames before their edits. */
function __snapPageSetup() {
  const data = /** @type {NonNullable<typeof __snapData>} */ (__snapData);
  const sprites = document.createElement("div");
  sprites.setAttribute("aria-hidden", "true");
  sprites.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
  sprites.innerHTML = data.sprites;
  document.body.append(sprites);
  const restore = () => {
    for (const el of document.querySelectorAll(".snap [data-still-scroll]")) {
      const [x, y] = (el.getAttribute("data-still-scroll") ?? "0,0").split(",").map(Number);
      if (el.scrollLeft !== x) el.scrollLeft = x;
      if (el.scrollTop !== y) el.scrollTop = y;
    }
  };
  new MutationObserver(restore).observe(document.body, { childList: true, subtree: true });
  setTimeout(restore, 0);
  const pill = document.createElement("div");
  pill.className = "ann";
  pill.hidden = true;
  pill.style.cssText =
    "position:fixed;left:50%;bottom:calc(20px + env(safe-area-inset-bottom, 0px));transform:translateX(-50%);z-index:60;padding:6px 12px;border-radius:999px;background:#1c1917;color:#fafaf9;font:500 12px/1.4 system-ui,sans-serif;box-shadow:0 4px 16px rgb(0 0 0/.2)";
  pill.textContent = "Before: Studio as captured, without this page's edits. B to go back.";
  document.body.append(pill);
  /** @type {WeakMap<Element, string>} */
  const edited = new WeakMap();
  let before = false;
  document.addEventListener("keydown", (e) => {
    if (e.key !== "b" && e.key !== "B") return;
    if (e.metaKey || e.ctrlKey || e.altKey || (e.target instanceof HTMLElement && e.target.closest("input,textarea,[contenteditable]"))) return;
    before = !before;
    pill.hidden = !before;
    document.body.toggleAttribute("data-snap-before", before);
    for (const el of document.querySelectorAll(".snap[data-snap]")) {
      if (before) {
        edited.set(el, el.innerHTML);
        el.innerHTML = __snapAssets(data.base[el.getAttribute("data-snap") ?? ""] ?? el.innerHTML);
      } else el.innerHTML = edited.get(el) ?? el.innerHTML;
    }
    restore();
  });
}
