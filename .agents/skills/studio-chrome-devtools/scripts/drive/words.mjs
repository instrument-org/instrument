// The words a script drives Studio with: tabs, groups, sides, the composer,
// the omnibar, menus by item name, the command menu, dialogs, settings,
// chats, files, the sidebar, pages, windows. Every word finds what it acts on
// by role and accessible name, acts with real input, and resolves once the
// app has settled (`__studioDrive.settled()`), so a script never sleeps. A
// word that cannot find its target says what is on screen instead, with the
// nearest names and a picture.
//
// Each word carries a one-line comment starting `@word`, which is where the
// vocabulary in SKILL.md comes from (`studio-drive.mjs words`).

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { callRpc, waitForDriveHandle, waitIdle } from "../studio-app.mjs";
import { describeNode, findNodes, indexTree, outline, placeOf, ROLES } from "./ax.mjs";
import { parseChord } from "./keys.mjs";
import { describeLook, menuLines } from "./look.mjs";
import { fold, nearest, quote, tierOf } from "./names.mjs";
import { startModelStub } from "./model-stub.mjs";

/** How long a word looks for what it names before saying it is not there. */
const FIND_MS = 5000;
/** How long the app is given to settle after an input. */
const SETTLE_CAP_MS = 8000;

const PICTURES = path.join(tmpdir(), "instrument-studio-drive", "pictures");

export class WordError extends Error {}

const sleep = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Builds the words over a connection from studio-app.mjs. `options.workspaceDir`
 * is the folder `seed.file` writes into; `options.allowReload` lets a run go
 * on across a reload of the renderer.
 */
export function createWords(app, options = {}) {
  const { cdp } = app;
  let pictureCount = 0;
  let load;
  const consoleErrors = [];
  /** A page's file picker waiting on dialog.choose. */
  let fileChooser;
  const stubs = [];
  /** Other windows' words, ended with these. */
  const others = [];

  // --- plumbing -------------------------------------------------------

  const evaluate = async (expression, target = cdp) => {
    const { exceptionDetails, result } = await target.send("Runtime.evaluate", {
      awaitPromise: true,
      expression,
      returnByValue: true,
    });
    if (exceptionDetails) {
      throw new WordError(
        exceptionDetails.exception?.description ?? exceptionDetails.text,
      );
    }
    return result.value;
  };

  /** Records a word in the run's trace, timed, as the rest of studio-app does. */
  // Only the outermost word is a step: a fill is one step, not the click,
  // the select-all and the typing it is made of.
  let depth = 0;
  const step = async (label, run) => {
    if (depth > 0) {
      return run();
    }
    const entry = { label, step: app.trace.length + 1 };
    app.trace.push(entry);
    const startedAt = Date.now();
    depth++;
    try {
      const value = await run();
      entry.ms = Date.now() - startedAt;
      entry.ok = true;
      return value;
    } catch (error) {
      entry.ms = Date.now() - startedAt;
      entry.ok = false;
      entry.error = error.message;
      throw error;
    } finally {
      depth--;
    }
  };

  const picture = async (name = "fail") => {
    mkdirSync(PICTURES, { recursive: true });
    const file = path.join(
      PICTURES,
      `${new Date().toISOString().replaceAll(/[:.]/g, "-")}-${++pictureCount}-${name}.png`,
    );
    try {
      const { data } = await cdp.send("Page.captureScreenshot", {
        format: "png",
        fromSurface: true,
      });
      writeFileSync(file, Buffer.from(data, "base64"));
      return file;
    } catch {
      return undefined;
    }
  };

  /** Waits for the app to settle, and notices a reload under the run. */
  const settle = async () => {
    // A system dialog or menu the input opened is held in main, and the
    // request that asked for it waits on it: nothing more will settle until
    // the script answers, so that is where the wait ends.
    let isDone = false;
    const heldOne = (async () => {
      while (!isDone) {
        await sleep(150);
        const native = await held();
        if (native.menu || native.dialogs.length > 0) {
          return { settled: { busy: [], heldNative: true } };
        }
      }
    })();
    const outcome = await Promise.race([
      evaluate(
        `(async () => ({ settled: await window.__studioDrive?.settled({ capMs: ${SETTLE_CAP_MS} }), load: window.__studioDrive?.load() }))()`,
      ).catch(() => undefined),
      heldOne,
    ]);
    isDone = true;
    const now = outcome?.load;
    if (now && load && now.id !== load.id && !options.allowReload) {
      throw new WordError(
        "The app reloaded during this step, so what was open or typed is gone. Run again, or pass --allow-reload when the run expects one.",
      );
    }
    load = now ?? load;
    return outcome?.settled;
  };

  const rpc = (route, input) => callRpc(cdp, route, input);

  let treeEnabled = false;
  const tree = async () => {
    if (!treeEnabled) {
      await cdp.send("Accessibility.enable");
      treeEnabled = true;
    }
    const { nodes } = await cdp.send("Accessibility.getFullAXTree");
    return indexTree(nodes);
  };

  // --- what is on screen ---------------------------------------------

  const held = () =>
    rpc("debug.drive.held").catch(() => ({ dialogs: [], menu: null }));

  const focusLine = async (index) => {
    const focused = [...index.byId.values()].find(
      (node) => node.props.focused && !node.ignored && node.role !== "RootWebArea",
    );
    return focused ? describeNode(index, focused) : undefined;
  };

  /** The window as text: groups, tabs, what is in front, and the screen's outline. */
  const describeScreen = async ({ withScreen = true, busy } = {}) => {
    const [look, index, native] = await Promise.all([
      evaluate("window.__studioDrive.look()"),
      tree(),
      held(),
    ]);
    const dialogs = [...index.byId.values()]
      .filter((node) => !node.ignored && (node.role === "dialog" || node.role === "alertdialog"))
      .map((node) => `${node.name || "(untitled)"}`);
    for (const dialog of native.dialogs) {
      dialogs.push(`(system) ${dialog.message} [${dialog.buttons.join(", ")}]`);
    }
    const toasts = [...index.byId.values()]
      .filter((node) => !node.ignored && node.role === "listitem" && placeOf(index, node.id)?.startsWith('region "Notifications'))
      .map((node) => textUnder(index, node));
    return {
      look,
      text: describeLook(look, {
        busy,
        dialogs,
        focus: await focusLine(index),
        menu: native.menu ? menuLines(native.menu) : undefined,
        screen: withScreen ? outline(index, { maxLines: 160 }) : undefined,
        toasts,
      }),
    };
  };

  const textUnder = (index, node) => {
    const parts = [];
    const walk = (id) => {
      const each = index.byId.get(id);
      if (!each) return;
      if (each.role === "StaticText" && each.name) parts.push(each.name);
      for (const child of each.children) walk(child);
    };
    walk(node.id);
    return parts.join(" ").replaceAll(/\s+/g, " ").trim();
  };

  /** A failure that shows what was there instead. */
  const missing = async (message, { pool = [], wanted, index } = {}) => {
    const near =
      wanted === undefined
        ? []
        : nearest(
            pool.map((node) => node.name),
            wanted,
          );
    const file = await picture();
    let screen = "";
    try {
      screen = (await describeScreen({ withScreen: Boolean(index) })).text;
    } catch {
      // The window may be gone; the message stands on its own.
    }
    const nearLines = near.length
      ? `\nNearest: ${near
          .map((name) => {
            const node = pool.find((each) => each.name === name);
            return node && index ? describeNode(index, node) : JSON.stringify(name);
          })
          .join("; ")}`
      : "";
    return new WordError(
      `${message}${nearLines}${file ? `\nPicture: ${file}` : ""}${screen ? `\nOn screen:\n${screen}` : ""}`,
    );
  };

  // --- finding --------------------------------------------------------

  /** Where a scope is: the ids of the nodes it covers, or undefined for the whole window. */
  const scopeIds = async (index, scopes) => {
    // A scope may be decided when the word acts: the side with the keyboard.
    const within = typeof scopes === "function" ? await scopes() : scopes;
    if (!within || within.length === 0) {
      return undefined;
    }
    let ids;
    for (const scope of within) {
      const node = await scope._node(index);
      if (!node) {
        return null;
      }
      ids = new Set([node.id]);
    }
    return ids;
  };

  /**
   * The one node a Thing names, looked for until `timeout`. Ambiguity fails
   * at once with every match listed, unless `nth` picks one.
   */
  const locate = async (spec, { timeout = FIND_MS } = {}) => {
    const deadline = Date.now() + timeout;
    let last;
    for (;;) {
      const index = await tree();
      const within = await scopeIds(index, spec.within);
      if (within !== null) {
        const { matches, pool } = findNodes(index, {
          name: spec.name,
          nameOf: spec.nameOf,
          roles: spec.roles,
          selected: spec.selected,
          within,
        });
        last = { index, matches, pool };
        if (spec.nth !== undefined) {
          const node = spec.nth < 0 ? matches.at(spec.nth) : matches[spec.nth];
          if (node) return { index, node };
        } else if (matches.length === 1) {
          return { index, node: matches[0] };
        } else if (matches.length > 1 && Date.now() > deadline - timeout + 600) {
          throw await missing(
            `${spec.label} matches ${matches.length}: ${matches
              .map((node, at) => `(${at}) ${describeNode(index, node)}`)
              .join("; ")}.\nPick one with .nth(i) (0 first, -1 last), or look inside a place: side("right").button(…), dialog.button(…).`,
          );
        }
      } else {
        last = { index, matches: [], pool: [], scopeMissing: true };
      }
      if (Date.now() > deadline) {
        const scopeNote = last.scopeMissing
          ? " (the place it is in is not on screen)"
          : "";
        throw await missing(
          `${spec.label.startsWith("the ") ? `${spec.label[0].toUpperCase()}${spec.label.slice(1)} is not` : `No ${spec.label}`} on screen${scopeNote}.${spec.selected ? " A side with one tab draws no tab strip." : ""}`,
          {
          index: last.index,
          pool: last.pool,
          wanted: spec.name,
        });
      }
      await sleep(100);
    }
  };

  /** Where a node is in the window, scrolled into view and checked for what covers it. */
  const boxOf = async (node, { allowCovered = false } = {}) => {
    if (node.backend === undefined) {
      throw new WordError(`${node.role} "${node.name}" has no element to act on.`);
    }
    await cdp
      .send("DOM.scrollIntoViewIfNeeded", { backendNodeId: node.backend })
      .catch(() => {});
    const { quads } = await cdp.send("DOM.getContentQuads", {
      backendNodeId: node.backend,
    });
    const quad = quads?.[0];
    if (!quad) {
      throw new WordError(`${node.role} "${node.name}" takes no space on screen.`);
    }
    const xs = [quad[0], quad[2], quad[4], quad[6]];
    const ys = [quad[1], quad[3], quad[5], quad[7]];
    const box = {
      height: Math.max(...ys) - Math.min(...ys),
      width: Math.max(...xs) - Math.min(...xs),
      x: Math.min(...xs),
      y: Math.min(...ys),
    };
    const center = {
      x: Math.round(box.x + box.width / 2),
      y: Math.round(box.y + box.height / 2),
    };
    if (!allowCovered) {
      const hit = await cdp
        .send("DOM.getNodeForLocation", {
          includeUserAgentShadowDOM: false,
          x: center.x,
          y: center.y,
        })
        .catch(() => undefined);
      if (hit?.backendNodeId !== undefined && hit.backendNodeId !== node.backend) {
        const [target, over] = await Promise.all([
          cdp.send("DOM.resolveNode", { backendNodeId: node.backend }),
          cdp.send("DOM.resolveNode", { backendNodeId: hit.backendNodeId }),
        ]);
        const { result } = await cdp.send("Runtime.callFunctionOn", {
          arguments: [{ objectId: over.object.objectId }],
          functionDeclaration: `function (hit) {
            const element = hit.nodeType === 1 ? hit : hit.parentElement;
            if (!element || this === element || this.contains(element) || element.contains(this)) return null;
            const label = element.closest("[aria-label],[role],button,a,input,textarea") ?? element;
            const role = label.getAttribute("role");
            const name = (label.getAttribute("aria-label") || label.innerText || "").replace(/\\s+/g, " ").trim().slice(0, 60);
            return label.tagName.toLowerCase() + (role ? "[role=" + role + "]" : "") + (name ? ' "' + name + '"' : "");
          }`,
          objectId: target.object.objectId,
          returnByValue: true,
        });
        if (result.value) {
          return { ...box, center, covered: result.value };
        }
      }
    }
    return { ...box, center };
  };

  const mouse = (type, { x, y }, extra = {}) =>
    cdp.send("Input.dispatchMouseEvent", { type, x, y, ...extra });

  /** The menu the app's own window holds open (role menu), or the system's, held for the run. */
  const openMenus = async (index) => {
    const menus = [...index.byId.values()].filter(
      (node) => !node.ignored && node.role === "menu",
    );
    return menus;
  };

  // --- a thing on screen ---------------------------------------------

  /**
   * What a word returns: something on screen named by role and name, found
   * when it is acted on, never before, so a Thing made ahead stays good.
   */
  class Thing {
    constructor(spec) {
      this.spec = {
        label: spec.label ?? `${spec.word} ${quote(spec.name)}`,
        ...spec,
      };
    }

    get label() {
      return this.spec.label;
    }

    async _node(index) {
      const within = await scopeIds(index, this.spec.within);
      if (within === null) return undefined;
      const { matches } = findNodes(index, { ...this.spec, within });
      return this.spec.nth === undefined
        ? matches.length === 1
          ? matches[0]
          : undefined
        : matches.at(this.spec.nth);
    }

    /** @word thing.nth(i): the i-th of several things with one name (0 first, -1 last) */
    nth(at) {
      return new this.constructor({ ...this.spec, label: `${this.spec.label} #${at}`, nth: at });
    }

    _within(word, roles, name) {
      return new Thing({
        name,
        roles,
        within: [this],
        word,
        label: `${word} ${quote(name)} in ${this.spec.label}`,
      });
    }

    /** @word thing.button(name) / .field / .toggle / .tab / .row / .item / .link / .find(role, name): one inside this one */
    button(name) {
      return this._within("button", ROLES.button, name);
    }
    field(name) {
      return this._within("field", ROLES.field, name);
    }
    toggle(name) {
      return this._within("toggle", ROLES.toggle, name);
    }
    tab(name) {
      return new Tab({ name, roles: ROLES.tab, within: [this], word: "tab", label: `tab ${quote(name)} in ${this.spec.label}` });
    }
    row(name) {
      return this._within("row", ROLES.row, name);
    }
    item(name) {
      return this._within("item", ROLES.item, name);
    }
    link(name) {
      return this._within("link", ROLES.link, name);
    }
    control(name) {
      return this._within("control", ROLES.control, name);
    }
    find(role, name) {
      return this._within(role, [role], name);
    }
    /** @word thing.text(): the words it shows; thing.see(text) waits for text inside it */
    async text() {
      const { index, node } = await locate(this.spec);
      return textUnder(index, node) || node.name;
    }
    see(text, options) {
      return seeText(text, { ...options, within: this });
    }

    /** @word thing.click({ button, count, modifiers, at }): a real click at its middle (or at [fx, fy] of its box) */
    click({ at, button = "left", count = 1, modifiers = [], timeout } = {}) {
      return step(`click ${this.label}`, async () => {
        const { node } = await locate(this.spec, { timeout });
        const box = await boxOf(node);
        if (box.covered) {
          throw await missing(
            `${this.label} is under ${box.covered}, so a click would land there. Close or move what covers it first.`,
          );
        }
        const point = at
          ? { x: Math.round(box.x + box.width * at[0]), y: Math.round(box.y + box.height * at[1]) }
          : box.center;
        const bits = modifierBits(modifiers);
        await mouse("mouseMoved", point, { modifiers: bits });
        for (let press = 1; press <= count; press++) {
          await mouse("mousePressed", point, { button, buttons: button === "right" ? 2 : 1, clickCount: press, modifiers: bits });
          await mouse("mouseReleased", point, { button, buttons: 0, clickCount: press, modifiers: bits });
        }
        const settled = await settle();
        return { at: point, ...(settled?.busy?.length ? { busy: settled.busy } : {}) };
      });
    }
    /** @word thing.dblclick() / thing.rightClick() */
    dblclick(options) {
      return this.click({ ...options, count: 2 });
    }
    rightClick(options) {
      return this.click({ ...options, button: "right" });
    }
    /**
     * @word thing.menu(...items): right-clicks it and picks the item (a path for a submenu); with no items, returns what the menu offers
     */
    menu(...items) {
      return step(`${this.label} menu${items.length ? ` › ${items.join(" › ")}` : ""}`, async () => {
        await this.rightClick();
        if (items.length === 0) {
          const offered = await menuWord.items();
          await menuWord.close();
          return offered;
        }
        return menuWord(...items);
      });
    }
    /** @word thing.hover(): the pointer rests on it until the app settles */
    hover() {
      return step(`hover ${this.label}`, async () => {
        const { node } = await locate(this.spec);
        const box = await boxOf(node, { allowCovered: true });
        await mouse("mouseMoved", box.center);
        await settle();
        return { at: box.center };
      });
    }
    /** @word thing.focus(): puts the keyboard on it */
    focus() {
      return step(`focus ${this.label}`, async () => {
        const { node } = await locate(this.spec);
        await cdp.send("DOM.focus", { backendNodeId: node.backend });
        await settle();
      });
    }
    /** @word thing.type(text): clicks into it and types, as keys would */
    type(text) {
      return step(`type ${quote(String(text).slice(0, 40))} into ${this.label}`, async () => {
        await this.click();
        return typeWord(text);
      });
    }
    /** @word thing.fill(text): replaces what it has with text */
    fill(text) {
      return step(`fill ${this.label} with ${quote(String(text).slice(0, 40))}`, async () => {
        await this.click();
        await pressWord("Meta+a");
        await pressWord("Backspace");
        return text ? typeWord(text) : undefined;
      });
    }
    /** @word thing.value(): what a field holds; thing.isOn(): a toggle's state */
    async value() {
      const { node } = await locate(this.spec);
      return node.value ?? node.props.valuetext ?? (await this.text());
    }
    async isOn() {
      const { node } = await locate(this.spec);
      const state = node.props.checked ?? node.props.pressed ?? node.props.selected;
      return state === true || state === "true" || state === "mixed";
    }
    /** @word thing.exists(): whether it is on screen now, without waiting */
    async exists() {
      const index = await tree();
      return Boolean(await this._node(index));
    }
    /** @word thing.wait({ timeout }) / thing.gone({ timeout }): until it shows, or until it is no longer on screen */
    wait({ timeout = 15_000 } = {}) {
      return step(`wait for ${this.label}`, async () => {
        await locate(this.spec, { timeout });
      });
    }
    gone({ timeout = 15_000 } = {}) {
      return step(`wait until ${this.label} is gone`, async () => {
        const deadline = Date.now() + timeout;
        while (await this.exists()) {
          if (Date.now() > deadline) {
            throw await missing(`${this.label} was still on screen after ${timeout} ms.`);
          }
          await sleep(100);
        }
        await settle();
      });
    }
    /** @word thing.box(): its place and size in the window, in CSS px */
    async box() {
      const { node } = await locate(this.spec);
      const { center: _center, ...box } = await boxOf(node, { allowCovered: true });
      return box;
    }
    /** @word thing.shot(file?): a picture of just it */
    async shot(file, { pad = 0 } = {}) {
      const box = await this.box();
      return shotWord(file, { clip: box, pad });
    }
    /** @word thing.measure(...properties): its box and computed styles */
    async measure(...properties) {
      const { node } = await locate(this.spec);
      const { object } = await cdp.send("DOM.resolveNode", { backendNodeId: node.backend });
      const { result } = await cdp.send("Runtime.callFunctionOn", {
        arguments: [{ value: properties }],
        functionDeclaration: `function (names) {
          const element = this.nodeType === 1 ? this : this.parentElement;
          const box = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          const styles = {};
          for (const name of names) styles[name] = style.getPropertyValue(name);
          return { box: { height: box.height, width: box.width, x: box.x, y: box.y }, styles };
        }`,
        objectId: object.objectId,
        returnByValue: true,
      });
      return result.value;
    }
    /** @word thing.outline(): the tree under it, as state() shows the screen */
    async outline() {
      const { index, node } = await locate(this.spec);
      return outline(index, { from: node.id });
    }
    /** @word thing.drag(): the start of a drag from it; see drag() */
    drag(options) {
      return dragWord(this, options);
    }
  }

  /** A tab in a side's strip. */
  class Tab extends Thing {
    /** @word tab(name).close(): its close button, shown on hover; tab().close() is File › Close Tab when the side has no strip */
    close() {
      return step(`close ${this.label}`, () => this._close());
    }
    async _close() {
      // A side with one tab draws no strip to close it from; the tab up
      // closes the way a person closes it then, with File › Close Tab.
      if (this.spec.selected && !(await this.exists())) {
        return menuWord("File", "Close Tab");
      }
      await this.hover();
      const { node } = await locate(this.spec);
      // The tab shows its close button inside itself while hovered or up.
      return this._within("button", ROLES.button, `Close ${node.name}`).click();
    }
    /** @word tab(name).page(): the web page it shows */
    page() {
      return pageWord(this);
    }
  }

  // --- words over the whole window -----------------------------------

  const thing = (word, roles, name) => new Thing({ name, roles, word });

  /** @word find(role, name): anything by its role and accessible name */
  const find = (role, name) => thing(role, [role], name);
  /** @word button(name), link(name), field(name), toggle(name), row(name), item(name), heading(name), control(name) */
  const button = (name) => thing("button", ROLES.button, name);
  const link = (name) => thing("link", ROLES.link, name);
  const field = (name) => thing("field", ROLES.field, name);
  const toggle = (name) => thing("toggle", ROLES.toggle, name);
  const row = (name) => thing("row", ROLES.row, name);
  const item = (name) => thing("item", ROLES.item, name);
  const heading = (name) => thing("heading", ROLES.heading, name);
  const control = (name) => thing("control", ROLES.control, name);
  /** @word click(name): clicks whatever control has that name */
  const click = (name, options) => control(name).click(options);

  /** @word see(text, { timeout }): waits until the text shows, and fails with the screen when it does not */
  const seeText = (text, { timeout = FIND_MS, within } = {}) =>
    step(`see ${quote(text)}`, async () => {
      await locate(
        {
          label: `text ${quote(text)}${within ? ` in ${within.label}` : ""}`,
          name: text,
          nth: 0,
          roles: ["StaticText", "heading", "button", "link", "textbox", "listitem", "paragraph", "cell"],
          within: within ? [within] : undefined,
          word: "text",
        },
        { timeout },
      );
    });

  /** @word tab(name): a tab in the group up, by its title; tab() is the one up; tabs() lists every tab of the window's groups */
  const tab = (name) =>
    name === undefined
      ? new Tab({ label: "the tab up", roles: ROLES.tab, selected: true, word: "tab", within: keyboardScope })
      : new Tab({ name, roles: ROLES.tab, word: "tab" });

  /** @word group(name): a tab group's row in the sidebar; .open(), .close(), .menu(...) */
  const group = (name) => {
    const rowThing = new Thing({
      label: `group ${quote(name)}`,
      name,
      // A row is named for its group: "Budget tab group", "A and B tab group".
      nameOf: (node) => (node.name.endsWith(" tab group") ? node.name.slice(0, -" tab group".length) : ""),
      roles: ["button", "link", "row", "treeitem"],
      within: [sidebarNav],
      word: "group",
    });
    return Object.assign(rowThing, {
      open: () => rowThing.click(),
      close: () => rowThing.menu(/^close/i),
    });
  };

  const sidebarNav = new Thing({ label: "the sidebar", name: "Tab groups", roles: ["navigation"], word: "sidebar" });

  /** @word side("left" | "right"): one side of a split group, to look inside: side("right").button("Send") */
  const side = (which) => {
    const name = which === "left" || which === 0 ? "Left side" : "Right side";
    return new Thing({ label: `the ${which} side`, name, roles: ["region"], word: "side" });
  };

  const look = () => evaluate("window.__studioDrive.look()");

  /** @word groups(): the window's groups, each with its sides and tabs */
  const groups = async () => (await look()).groups;
  const tabs = async () =>
    (await look()).groups.flatMap((each) => each.sides.flatMap((sideOf) => sideOf.tabs));

  /** The side holding the keyboard, as a scope, when the group up is split. */
  const keyboardSide = async () => {
    const up = (await look()).groups.find((each) => each.isUp);
    if (!up || up.sides.length < 2) {
      return undefined;
    }
    const at = up.sides.findIndex((each) => each.hasKeyboard);
    return side(at === 1 ? "right" : "left");
  };

  // --- keys ----------------------------------------------------------

  /** The page holding the keyboard, when a web page does. */
  const guestWithKeyboard = () =>
    evaluate(
      `(() => { const el = document.activeElement; return el && el.tagName === "WEBVIEW" && typeof el.getWebContentsId === "function" ? el.getWebContentsId() : null; })()`,
    );

  /**
   * @word press(chord): a key or chord as a person presses it: "Escape", "Meta+t", "Shift+Meta+]". The window's own shortcuts hear it, then the page, then the menu bar's
   */
  const pressWord = (chord) =>
    step(`press ${chord}`, async () => {
      const parsed = parseChord(chord);
      const guestId = await guestWithKeyboard();
      // Whether the page took the key, read from the event itself once it
      // has been through every listener.
      await evaluate(`(() => {
        window.__driveKey = undefined;
        addEventListener("keydown", (event) => { window.__driveKey = event; }, { capture: true, once: true });
      })()`);
      const { taken } = await rpc("debug.drive.pressKey", {
        keyCode: parsed.keyCode,
        modifiers: parsed.modifiers,
        ...(guestId === null ? {} : { guestId }),
      });
      let menuItem;
      const pageTook = await evaluate(
        "Boolean(window.__driveKey?.defaultPrevented)",
      );
      if (!taken && !pageTook && (parsed.modifiers.some((each) => each !== "shift") || /^F\d/.test(parsed.keyCode))) {
        ({ item: menuItem } = await rpc("debug.drive.menuKey", {
          ...parsed.input,
          ...(guestId === null ? {} : { guestId }),
        }));
      }
      await settle();
      return {
        ...(taken ? { by: "the window" } : pageTook ? { by: "the page" } : menuItem ? { by: `menu: ${menuItem}` } : {}),
      };
    });

  /** @word type(text): types into what has the keyboard; fails when nothing has it */
  const typeWord = (text) =>
    step(`type ${quote(String(text).slice(0, 40))}`, async () => {
      const guestId = await guestWithKeyboard();
      if (guestId !== null) {
        const guest = await guestCdp();
        await guest.send("Input.insertText", { text });
        await settle();
        return {};
      }
      const before = await evaluate(FOCUSED);
      if (before === null) {
        throw await missing("Nothing has the keyboard, so typing would go nowhere. Click a field first.");
      }
      await cdp.send("Input.insertText", { text });
      await settle();
      const after = await evaluate(FOCUSED);
      return after?.includes(text) ? {} : { landed: after };
    });

  /** @word paste(text): pastes text into what has the keyboard, leaving the clipboard alone */
  const pasteWord = (text) =>
    step("paste", async () => {
      const handled = await evaluate(`(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const data = new DataTransfer();
        data.setData("text/plain", ${JSON.stringify(text)});
        const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data });
        el.dispatchEvent(event);
        return event.defaultPrevented;
      })()`);
      if (handled === null) {
        throw await missing("Nothing has the keyboard to paste into. Click a field first.");
      }
      if (!handled) {
        await cdp.send("Input.insertText", { text });
      }
      await settle();
    });

  // --- menus ---------------------------------------------------------

  const pressInOpenMenu = async (labels) => {
    const native = await held();
    if (native.menu) {
      const { pressed } = await rpc("debug.drive.pressMenu", { from: "held", labels });
      if (!pressed) {
        throw await missing(
          `The menu has no ${labels.map(quote).join(" › ")}. It offers:\n${menuLines(native.menu).join("\n")}`,
        );
      }
      return "the menu";
    }
    const index = await tree();
    const menus = await openMenus(index);
    if (menus.length === 0) {
      return undefined;
    }
    for (const [at, label] of labels.entries()) {
      const isLast = at === labels.length - 1;
      const within = menus.at(-1);
      const menuThing = new Thing({ label: `menu ${quote(within.name)}`, name: within.name || undefined, roles: [within.role], word: "menu", nth: -1 });
      const entry = menuThing.item(label);
      if (isLast) {
        await entry.click();
      } else {
        await entry.hover();
        await pressWord("ArrowRight");
      }
    }
    return "the menu";
  };

  /**
   * @word menu(...items): picks an item in the menu that is open (the app's or a system one held for the run); with none open, in the menu bar: menu("File", "Print…") or menu("Print…")
   */
  const menuWord = (...labels) =>
    step(`menu ${labels.join(" › ")}`, async () => {
      const from = await pressInOpenMenu(labels);
      if (from) {
        await settle();
        return { from };
      }
      const bar = await rpc("debug.drive.menuBar");
      const pathTo = findMenuPath(bar, labels);
      if (!pathTo) {
        const all = bar.flatMap((top) => (top.submenu ?? []).map((row) => `${top.label} › ${row.label}`));
        throw await missing(
          `No menu is open, and the menu bar has no ${labels.map(quote).join(" › ")}. Nearest: ${nearest(all, labels.at(-1)).join("; ")}`,
        );
      }
      const { pressed } = await rpc("debug.drive.pressMenu", { from: "bar", labels: pathTo });
      if (!pressed) {
        throw await missing(`${pathTo.join(" › ")} is in the menu bar but turned off right now.`);
      }
      await settle();
      return { from: `menu bar: ${pathTo.join(" › ")}` };
    });
  /** @word menu.items(): what the open menu offers, as lines */
  menuWord.items = async () => {
    const native = await held();
    if (native.menu) return menuLines(native.menu);
    const index = await tree();
    const menus = await openMenus(index);
    const open = menus.at(-1);
    if (!open) return [];
    const lines = [];
    const walk = (id) => {
      const node = index.byId.get(id);
      if (!node) return;
      if (ROLES.item.includes(node.role) && !node.ignored) {
        const on = node.props.checked === true || node.props.checked === "true";
        lines.push(`${on ? "✓ " : ""}${node.name}${node.props.disabled ? " (disabled)" : ""}${node.props.haspopup ? " ›" : ""}`);
        return;
      }
      if (node.role === "separator" && !node.ignored) {
        lines.push("—");
        return;
      }
      for (const child of node.children) walk(child);
    };
    walk(open.id);
    return lines;
  };
  /** @word menu.close(): closes the open menu */
  menuWord.close = async () => {
    const native = await held();
    if (native.menu) {
      await rpc("debug.drive.dismissMenu");
      await settle();
      return;
    }
    await pressWord("Escape");
  };
  /** @word menu.bar(): the menu bar's menus and items, as lines */
  menuWord.bar = async () => menuLines(await rpc("debug.drive.menuBar"));

  // --- dialogs -------------------------------------------------------

  const dialogThing = new Thing({ label: "dialog", roles: ["dialog", "alertdialog"], word: "dialog", nth: -1 });

  /**
   * @word dialog: the dialog in front, the app's or a system one held for the run. dialog.text(), dialog.button(name).click(), dialog.answer(button), dialog.cancel(), dialog.choose(paths) for a file picker
   */
  const dialogWord = Object.assign(dialogThing, {
    async answer(buttonName) {
      const native = await held();
      const first = native.dialogs[0];
      if (first) {
        const at = first.buttons.findIndex((each) => tierMatch(each, buttonName));
        if (at === -1) {
          throw await missing(`The system dialog "${first.message}" has no button ${quote(buttonName)}; it has ${first.buttons.map(quote).join(", ")}.`);
        }
        await rpc("debug.drive.answerDialog", { button: at, id: first.id });
        await settle();
        return { answered: first.message };
      }
      return dialogThing.button(buttonName).click();
    },
    async cancel() {
      if (fileChooser) {
        fileChooser = undefined;
        return;
      }
      const native = await held();
      if (native.dialogs[0]) {
        await rpc("debug.drive.answerDialog", { cancel: true, id: native.dialogs[0].id });
        await settle();
        return;
      }
      await pressWord("Escape");
    },
    async choose(paths) {
      const files = [paths].flat().map((each) => path.resolve(each));
      if (fileChooser) {
        const { backendNodeId } = fileChooser;
        fileChooser = undefined;
        await cdp.send("DOM.setFileInputFiles", { backendNodeId, files });
        await settle();
        return;
      }
      const native = await held();
      const picker = native.dialogs.find((each) => each.kind !== "message");
      if (!picker) {
        throw await missing("No file picker is open.");
      }
      await rpc("debug.drive.answerDialog", { id: picker.id, paths: files });
      await settle();
    },
    async text() {
      if (fileChooser) {
        return `Choose ${fileChooser.mode === "selectMultiple" ? "files" : "a file"}`;
      }
      const native = await held();
      if (native.dialogs[0]) {
        const { buttons, detail, kind, message } = native.dialogs[0];
        return [message || (kind === "message" ? "" : `A system ${kind} dialog`), detail, `[${buttons.join(", ")}]`].filter(Boolean).join("\n");
      }
      return Thing.prototype.text.call(dialogThing);
    },
    async isOpen() {
      const native = await held();
      return Boolean(fileChooser) || native.dialogs.length > 0 || (await dialogThing.exists());
    },
  });

  // --- the composer and the omnibar ----------------------------------

  /**
   * @word composer: the reply box of the side with the keyboard. composer.type(text), composer.send(text), composer.text(), composer.clear(), composer.button(name)
   */
  /** The side with the keyboard, as a scope, decided when a word acts. */
  const keyboardScope = async () => {
    const scope = await keyboardSide();
    return scope ? [scope] : undefined;
  };

  const composerThing = new Thing({
    label: "the composer",
    name: /^(Talk to Instrument|Reply|Ask|Message)/i,
    roles: ["textbox"],
    within: keyboardScope,
    word: "composer",
  });
  const composer = Object.assign(composerThing, {
    /** Sends text (or what is there already) with Enter, and resolves once the send has settled. */
    send(text) {
      return step(`send ${text === undefined ? "the composer" : quote(String(text).slice(0, 40))}`, async () => {
        if (text !== undefined) {
          await composerThing.fill(text);
        } else {
          await composerThing.click();
        }
        return pressWord("Enter");
      });
    },
    text: () => composerThing.value(),
    clear: () => composerThing.fill(""),
    button: (name) =>
      new Thing({ label: `button ${quote(name)} by the composer`, name, roles: ROLES.button, within: keyboardScope, word: "button" }),
  });

  /**
   * @word omnibar: the address field of the page up. omnibar.go(address) opens it (in a new tab's box when no page is up), omnibar.type(text), omnibar.rows(), omnibar.pick(row), omnibar.text()
   */
  const omnibarThing = new Thing({
    label: "the omnibar",
    name: /search or (enter|type) (an )?address/i,
    roles: ["combobox", "textbox"],
    within: keyboardScope,
    word: "omnibar",
  });
  const omnibar = Object.assign(omnibarThing, {
    go(address) {
      return step(`go to ${address}`, async () => {
        if (await omnibarThing.exists()) {
          await omnibarThing.fill(address);
        } else {
          await menuWord("Open Location…");
          await typeWord(address);
        }
        return pressWord("Enter");
      });
    },
    type: (text) => omnibarThing.fill(text),
    text: () => omnibarThing.value(),
    async rows() {
      const index = await tree();
      const lists = [...index.byId.values()].filter((node) => !node.ignored && node.role === "listbox" && node.name !== "Suggestions");
      return lists.flatMap((list) => optionNames(index, list));
    },
    pick: (name) => new Thing({ label: `omnibar row ${quote(name)}`, name, roles: ["option"], word: "row" }).click(),
  });

  /**
   * @word commandMenu: ⌘K. commandMenu.open(), commandMenu.search(text), commandMenu.rows(), commandMenu.pick(name), commandMenu.close()
   */
  const commandMenuDialog = new Thing({ label: "the command menu", name: "Command menu", roles: ["dialog"], word: "dialog" });
  const commandMenu = Object.assign(commandMenuDialog, {
    open() {
      return step("open the command menu", async () => {
        if (!(await commandMenuDialog.exists())) {
          await menuWord("File", "Command Menu");
        }
        await locate(commandMenuDialog.spec);
      });
    },
    search(text) {
      return step(`search the command menu for ${quote(text)}`, async () => {
        await commandMenu.open();
        return commandMenuDialog.field(/search/i).fill(text);
      });
    },
    async rows() {
      const { index } = await locate(commandMenuDialog.spec);
      const list = [...index.byId.values()].find((node) => !node.ignored && node.role === "listbox" && node.name === "Suggestions");
      return list ? optionNames(index, list) : [];
    },
    pick(name) {
      return step(`pick ${quote(name)} in the command menu`, async () => {
        await commandMenu.open();
        return commandMenuDialog.find("option", name).click();
      });
    },
    async close() {
      if (await commandMenuDialog.exists()) await pressWord("Escape");
    },
  });

  // --- the sidebar, settings, toasts --------------------------------

  /**
   * @word sidebar: sidebar.toggle(), sidebar.isOpen(), sidebar.width(px) drags its edge, sidebar.button(name), sidebar.new() makes a group
   */
  const sidebar = Object.assign(sidebarNav, {
    async isOpen() {
      return (await look()).sidebarOpen;
    },
    toggle: () => menuWord("View", "Toggle Sidebar"),
    async width(px) {
      const edge = find("separator", "Resize the sidebar");
      const box = await edge.box();
      const from = { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
      await mouse("mouseMoved", from);
      await mouse("mousePressed", from, { button: "left", buttons: 1, clickCount: 1 });
      const steps = 8;
      for (let at = 1; at <= steps; at++) {
        await mouse("mouseMoved", { x: Math.round(from.x + ((px - from.x) * at) / steps), y: from.y }, { button: "left", buttons: 1 });
      }
      await mouse("mouseReleased", { x: px, y: from.y }, { button: "left", buttons: 0, clickCount: 1 });
      await settle();
      return edge.box();
    },
    new: () => menuWord("File", "New Tab Group"),
  });

  /** @word settings: settings.open(section?) opens Settings at a section, settings.toggle(name) a switch on it */
  const settings = {
    async open(section) {
      await menuWord("Settings…");
      if (section) {
        await control(section).click();
      }
    },
    toggle: (name) => toggle(name),
  };

  const toastRegion = new Thing({ label: "the notifications", name: /^Notifications/, roles: ["region"], word: "region", nth: 0 });
  /** @word toast(): the toasts showing, as text; toast.button(name) inside the front one ("Undo") */
  const toast = Object.assign(
    async () => {
      const index = await tree();
      return [...index.byId.values()]
        .filter((node) => !node.ignored && node.role === "listitem" && placeOf(index, node.id)?.startsWith('region "Notifications'))
        .map((node) => textUnder(index, node));
    },
    { button: (name) => toastRegion.button(name), see: (text, options) => toastRegion.see(text, options) },
  );

  // --- chats ---------------------------------------------------------

  /**
   * @word chat(name?): a chat, opened from the command menu by name; chat() is the one up. .open(), .state() (title, working, model), .idle() waits for its agent to stop
   */
  const chat = (name) => ({
    async open() {
      await commandMenu.search(name);
      await commandMenu.pick(name);
    },
    async id() {
      if (name !== undefined) await this.open();
      const up = await upTab();
      const match = /^\/chats\/([^/?#]+)/.exec(up?.address ?? "");
      if (!match) {
        throw await missing(`The tab up is not a chat (${up?.address ?? "nothing up"}).`);
      }
      return decodeURIComponent(match[1]);
    },
    async state() {
      const id = await this.id();
      return rpc("workspace.chats.byId", { id });
    },
    async idle({ timeout = 120_000 } = {}) {
      const id = await this.id();
      return step("wait for the chat to finish", () => waitIdle(cdp, { chatId: id, settleMs: 1000, timeoutMs: timeout }));
    },
  });

  const upTab = async () => {
    const up = (await look()).groups.find((each) => each.isUp);
    const sideUp = up?.sides.find((each) => each.hasKeyboard) ?? up?.sides[0];
    return sideUp?.tabs.find((each) => each.isUp);
  };

  // --- files ---------------------------------------------------------

  /**
   * @word files: the Files screen. files.open(folder?) opens it, files.item(name) a file or folder in it (.click(), .dblclick(), .menu(...))
   */
  const files = {
    async open(folder) {
      await goto(folder ? `/files?path=${encodeURIComponent(folder)}` : "/files");
    },
    item: (name) => new Thing({ name, roles: [...ROLES.row, "link", "button"], word: "file" }),
  };

  // --- pages in tabs -------------------------------------------------

  const guestCdps = new Map();
  const guestCdp = async (webviewExpression = "document.activeElement") => {
    const mark = `drive-${Math.random().toString(36).slice(2)}`;
    const ok = await evaluate(`(async () => {
      const el = ${webviewExpression};
      if (!el || el.tagName !== "WEBVIEW") return false;
      await el.executeJavaScript(${JSON.stringify(`window.__driveMark = ${JSON.stringify(mark)}`)});
      return true;
    })()`);
    if (!ok) {
      throw await missing("No web page is there to drive.");
    }
    const list = await (await fetch(`http://127.0.0.1:${app.port}/json/list`)).json();
    for (const target of list.filter((each) => each.type === "webview")) {
      let connection = guestCdps.get(target.id);
      if (!connection) {
        connection = await openSocket(target.webSocketDebuggerUrl);
        guestCdps.set(target.id, connection);
      }
      const marked = await evaluate("window.__driveMark", connection).catch(() => undefined);
      if (marked === mark) {
        return connection;
      }
    }
    throw await missing("The page's debug target was not found.");
  };

  /**
   * @word page(): the web page up in the side with the keyboard (tab(name).page() for another). page.url(), .title(), .text(), .eval(js), .see(text), .click(name?), .menu(name?, ...items), .type(text), .shot(file)
   */
  const pageWord = (tabThing) => {
    let isShown = !tabThing;
    const webviewOf = async () => {
      if (!isShown) {
        await tabThing.click();
        isShown = true;
      }
      const up = await upTab();
      if (up?.kind !== "page") {
        throw await missing(`The tab up is ${up ? `a screen (${up.address})` : "missing"}, not a web page.`);
      }
      const id = await evaluate(`window.__studioDrive.pageOf(${JSON.stringify(up.id)})`);
      if (id === null) {
        throw await missing(`The page in "${up.title}" has not loaded.`);
      }
      return `[...document.querySelectorAll("webview")].find((each) => each.getWebContentsId?.() === ${id})`;
    };
    let guest;
    let guestOf;
    const connection = async () => {
      const expression = await webviewOf();
      if (guestOf !== expression) {
        guest = await guestCdp(expression);
        guestOf = expression;
      }
      return guest;
    };
    const pageEval = async (expression) => evaluate(expression, await connection());
    return {
      eval: pageEval,
      url: () => pageEval("location.href"),
      title: () => pageEval("document.title"),
      text: () => pageEval("document.body.innerText"),
      async see(text, { timeout = FIND_MS } = {}) {
        const deadline = Date.now() + timeout;
        while (!(await pageEval(`document.body.innerText.includes(${JSON.stringify(text)})`))) {
          if (Date.now() > deadline) {
            throw await missing(`The page never showed ${quote(text)}. It shows: ${(await pageEval("document.body.innerText")).slice(0, 400)}`);
          }
          await sleep(100);
        }
      },
      /** Clicks a link, button or field in the page by its name, with the mouse the app's window has. */
      /** Clicks a control in the page by name (the page's middle with no name). */
      click: (name, { button = "left", count = 1 } = {}) =>
        step(`page ${button === "right" ? "right-click" : "click"} ${name === undefined ? "" : quote(name)}`.trim(), async () => {
          const guest = await connection();
          let inner;
          if (name === undefined) {
            inner = await evaluate("({ x: innerWidth / 2, y: innerHeight / 2 })", guest);
          } else {
            await guest.send("Accessibility.enable");
            const { nodes } = await guest.send("Accessibility.getFullAXTree");
            const index = indexTree(nodes);
            const { matches, pool } = findNodes(index, { name, roles: [...ROLES.control, "StaticText", "heading"] });
            if (matches.length === 0) {
              throw await missing(`The page has nothing named ${quote(name)}.`, { pool, wanted: name });
            }
            const node = matches[0];
            await guest.send("DOM.scrollIntoViewIfNeeded", { backendNodeId: node.backend }).catch(() => {});
            const { quads } = await guest.send("DOM.getContentQuads", { backendNodeId: node.backend });
            const quad = quads[0];
            inner = { x: (quad[0] + quad[4]) / 2, y: (quad[1] + quad[5]) / 2 };
          }
          // Sent to the page itself: input sent to the app's window at the
          // page's place stops at the <webview> and never reaches it.
          const point = { x: Math.round(inner.x), y: Math.round(inner.y) };
          const press = (type, extra) => guest.send("Input.dispatchMouseEvent", { type, ...point, ...extra });
          await press("mouseMoved", {});
          for (let at = 1; at <= count; at++) {
            await press("mousePressed", { button, buttons: button === "right" ? 2 : 1, clickCount: at });
            await press("mouseReleased", { button, buttons: 0, clickCount: at });
          }
          await settle();
          return { at: point };
        }),
      /** The page's context menu at a control (or its middle), picking an item; with no items, what it offers. */
      async menu(name, ...items) {
        await this.click(name, { button: "right" });
        await until(async () => (await held()).menu, { label: "the page's menu", timeout: 3000 });
        if (items.length === 0) {
          const offered = await menuWord.items();
          await menuWord.close();
          return offered;
        }
        return menuWord(...items);
      },
      async type(text) {
        const guest = await connection();
        await guest.send("Input.insertText", { text });
        await settle();
      },
      async shot(file) {
        const guest = await connection();
        const { data } = await guest.send("Page.captureScreenshot", { format: "png" });
        const out = file ?? path.join(PICTURES, `page-${++pictureCount}.png`);
        mkdirSync(path.dirname(out), { recursive: true });
        writeFileSync(out, Buffer.from(data, "base64"));
        return out;
      },
    };
  };

  // --- drags ---------------------------------------------------------

  /**
   * @word drag(thing): drags it with the mouse. drag(tab("A")).to(target) drops it where it lands on arrival (between rows, beside a tab); .into(group("B")) rests on it until it goes in; .over(target) holds it there and returns the app's drag; .drop() / .cancel() end it
   */
  const dragWord = (from, { steps = 12 } = {}) => {
    let at;
    let pressed = false;
    const pointOf = async (target) => {
      if (target && typeof target.x === "number") return target;
      const box = await target.box();
      return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
    };
    const start = async () => {
      if (pressed) return;
      at = await pointOf(from);
      await mouse("mouseMoved", at);
      await mouse("mousePressed", at, { button: "left", buttons: 1, clickCount: 1 });
      pressed = true;
    };
    const moveTo = async (target) => {
      const to = await pointOf(target);
      for (let each = 1; each <= steps; each++) {
        await mouse(
          "mouseMoved",
          { x: Math.round(at.x + ((to.x - at.x) * each) / steps), y: Math.round(at.y + ((to.y - at.y) * each) / steps) },
          { button: "left", buttons: 1 },
        );
        await sleep(16);
      }
      at = to;
    };
    const dragState = () => evaluate("window.__studioDrive.drag()");
    return {
      over: (target) =>
        step(`drag ${from.label ?? "point"} over ${target.label ?? "point"}`, async () => {
          await start();
          await moveTo(target);
          await sleep(50);
          return dragState();
        }),
      to: (target) =>
        step(`drag ${from.label ?? "point"} to ${target.label ?? "point"}`, async () => {
          await start();
          await moveTo(target);
          const during = await dragState();
          await mouse("mouseReleased", at, { button: "left", buttons: 0, clickCount: 1 });
          await settle();
          return { during };
        }),
      into: (target, { timeout = 3000 } = {}) =>
        step(`drag ${from.label ?? "point"} into ${target.label ?? "point"}`, async () => {
          await start();
          await moveTo(target);
          // Going into a row or a tab takes the pointer resting on its
          // middle; it rests until the app's drag says it has gone in.
          const deadline = Date.now() + timeout;
          let during = await dragState();
          while (during?.landing?.drop?.kind !== "into") {
            if (Date.now() > deadline) {
              await mouse("mouseReleased", at, { button: "left", buttons: 0, clickCount: 1 });
              throw await missing(`${target.label} never took what was held; the drag's landing was ${JSON.stringify(during?.landing ?? null)}.`);
            }
            await mouse("mouseMoved", at, { button: "left", buttons: 1 });
            await sleep(100);
            during = await dragState();
          }
          await mouse("mouseReleased", at, { button: "left", buttons: 0, clickCount: 1 });
          await settle();
          return { during };
        }),
      drop: () =>
        step("drop", async () => {
          await mouse("mouseReleased", at, { button: "left", buttons: 0, clickCount: 1 });
          await settle();
        }),
      cancel: async () => {
        await pressWord("Escape");
        await mouse("mouseReleased", at, { button: "left", buttons: 0, clickCount: 1 });
        await settle();
      },
    };
  };

  /**
   * @word dropFiles(paths).on(thing): drops files from the Finder onto it; .over(thing) holds them there
   */
  const dropFiles = (paths) => {
    const list = [paths].flat().map((each) => path.resolve(each));
    const data = { dragOperationsMask: 1, files: list, items: [] };
    const send = async (type, point) => cdp.send("Input.dispatchDragEvent", { data, type, x: point.x, y: point.y });
    const pointOf = async (target) => {
      const box = await target.box();
      return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
    };
    const enter = async (point) => {
      if (process.platform === "darwin") {
        // The app names held files from the system's drag pasteboard, as a
        // Finder drag fills it.
        execFileSync("osascript", ["-l", "JavaScript", "-e", WRITE_DRAG_PASTEBOARD, ...list]);
      }
      await send("dragEnter", point);
      await send("dragOver", point);
    };
    return {
      over: (target) =>
        step(`files over ${target.label}`, async () => {
          const point = await pointOf(target);
          await enter(point);
          await settle();
          return evaluate("window.__studioDrive.drag()");
        }),
      on: (target) =>
        step(`drop files on ${target.label}`, async () => {
          const point = await pointOf(target);
          await enter(point);
          await send("drop", point);
          await settle();
        }),
    };
  };

  // --- pictures ------------------------------------------------------

  /** @word shot(file?): a picture of the window; returns its path */
  const shotWord = (file, { clip, pad = 0 } = {}) =>
    step(`shot ${file ?? ""}`.trim(), async () => {
      const out = file ? path.resolve(file) : path.join(PICTURES, `shot-${Date.now()}-${++pictureCount}.png`);
      mkdirSync(path.dirname(out), { recursive: true });
      const { data } = await cdp.send("Page.captureScreenshot", {
        captureBeyondViewport: true,
        format: "png",
        fromSurface: true,
        ...(clip && {
          clip: {
            height: clip.height + pad * 2,
            scale: 1,
            width: clip.width + pad * 2,
            x: Math.max(0, clip.x - pad),
            y: Math.max(0, clip.y - pad),
          },
        }),
      });
      writeFileSync(out, Buffer.from(data, "base64"));
      return out;
    });

  /**
   * @word burst(action, { every, max, dir }): pictures of the window every `every` ms (50) while action runs; returns their paths
   */
  const burst = (action, { dir, every = 50, max = 40 } = {}) =>
    step("burst", async () => {
      const out = dir ? path.resolve(dir) : path.join(PICTURES, `burst-${Date.now()}`);
      mkdirSync(out, { recursive: true });
      const frames = [];
      let running = true;
      const shooting = (async () => {
        while (running && frames.length < max) {
          const startedAt = Date.now();
          const { data } = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
          const file = path.join(out, `frame-${String(frames.length).padStart(3, "0")}.png`);
          writeFileSync(file, Buffer.from(data, "base64"));
          frames.push(file);
          await sleep(Math.max(0, every - (Date.now() - startedAt)));
        }
      })();
      try {
        await action();
      } finally {
        running = false;
        await shooting;
      }
      return frames;
    });

  // --- the window ----------------------------------------------------

  /** @word keyboard(): what has the keyboard, as `role "name": "value"`, or null */
  const keyboard = async () => {
    const index = await tree();
    const focused = [...index.byId.values()].find(
      (node) => node.props.focused && !node.ignored && node.role !== "RootWebArea",
    );
    if (!focused) return null;
    const value = typeof focused.value === "string" && focused.value.trim() ? `: ${JSON.stringify(focused.value)}` : "";
    return `${describeNode(index, focused)}${value}`;
  };

  /** @word state(): what is on screen, as text: groups, tabs, the dialog or menu in front, toasts, and the screen's outline */
  const state = async () => {
    const settled = await settle();
    return (await describeScreen({ busy: settled?.busy })).text;
  };

  /** @word theme("dark" | "light" | "system") */
  const theme = (name) =>
    step(`theme ${name}`, async () => {
      await rpc("preferences.setTheme", { theme: name });
      await settle();
    });

  /** @word size(width, height): sizes the window's content, which keeps its place off screen */
  const size = (width, height) =>
    step(`size ${width}x${height}`, async () => {
      await rpc("debug.drive.resize", { height, width });
      await settle();
      return evaluate("({ width: innerWidth, height: innerHeight })");
    });

  /** @word goto(address, { newTab }): opens an app address (/chats, instrument://settings) in the tab up */
  const goto = (address, { newTab = false } = {}) =>
    step(`goto ${address}`, async () => {
      await evaluate(`window.__studioDrive.goto(${JSON.stringify(address.replace(/^#/, ""))}, ${JSON.stringify({ newTab })})`);
      await settle();
    });

  /** @word errors(): console errors and uncaught exceptions since the run began */
  const errors = () => [...consoleErrors];

  /** @word until(check, { timeout, every }): waits until a function (or page expression) returns something truthy, and returns it */
  const until = (check, { every = 100, label, timeout = 15_000 } = {}) =>
    step(label ?? `until ${typeof check === "string" ? check.slice(0, 40) : "condition"}`, async () => {
      const deadline = Date.now() + timeout;
      for (;;) {
        const value = typeof check === "string" ? await evaluate(check) : await check();
        if (value) return value;
        if (Date.now() > deadline) {
          throw await missing(`Waited ${timeout} ms and it never came true: ${typeof check === "string" ? check : check.toString().slice(0, 200)}`);
        }
        await sleep(every);
      }
    });

  /** @word expect(value, message): fails the run with the screen when value is falsy */
  const expect = async (value, message = "expectation") => {
    if (!(await value)) {
      throw await missing(`Expected ${message}.`);
    }
  };

  /** @word windows(): the app's windows, newest first; window(n) is the n-th's own words */
  const windows = async () => {
    const list = await (await fetch(`http://127.0.0.1:${app.port}/json/list`)).json();
    return list.filter((each) => each.type === "page" && /\/renderer\/|:\/\/app\/index\.html/.test(each.url) && !each.url.includes("#/onboarding")).map((each, at) => ({ at, title: each.title }));
  };
  const windowWord = async (at) => {
    const { connect } = await import("../studio-app.mjs");
    const other = await connect({ page: `window:${at}`, port: app.port, workspace: app.workspace });
    const made = createWords(other, options);
    await made.begin();
    others.push({ connection: other, made });
    return made.words;
  };

  // --- setup ---------------------------------------------------------

  /**
   * @word seed.file(relativePath, content): writes a file into the workspace folder; seed.chat(prompt) makes a chat with model.replies' next answer
   */
  const seed = {
    file(relative, content = "") {
      if (!options.workspaceDir) {
        throw new WordError("seed.file needs a fixture workspace: boot with --workspace <fixture>.");
      }
      const file = path.join(options.workspaceDir, relative);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, content);
      return file;
    },
    async chat(prompt) {
      await menuWord("File", "New Tab");
      return composer.send(prompt);
    },
  };

  /**
   * @word model.replies([...]): a stand-in model for the run that answers each agent turn with the next reply (text, or { tool, input }), set as the default model; returns what it was asked
   */
  const model = {
    async replies(replies) {
      const stub = await startModelStub(replies);
      stubs.push(stub);
      const name = "Studio drive stand-in";
      const configs = await rpc("providerConfig.list", {});
      for (const config of configs.filter((each) => each.displayName === name)) {
        await rpc("providerConfig.remove", { id: config.id });
      }
      await rpc("providerConfig.create", {
        config: { apiKey: "stand-in", baseURL: stub.baseURL, displayName: name, type: "openai-compatible" },
        skipValidation: true,
      });
      const uri = await until(
        async () => {
          const listed = await rpc("gateway.models.list", {});
          const models = Array.isArray(listed) ? listed : listed.models;
          return models.find((each) => String(each.uri).includes(stub.modelId))?.uri;
        },
        { label: "stand-in model listed", timeout: 15_000, every: 250 },
      );
      await rpc("preferences.setDefaultModelURI", { modelURI: uri });
      await settle();
      return { requests: stub.requests, uri };
    },
  };

  // --- assembled -----------------------------------------------------

  const words = {
    app,
    button,
    burst,
    cdp,
    chat,
    click,
    commandMenu,
    composer,
    control,
    dialog: dialogWord,
    drag: (from, dragOptions) => dragWord(from, dragOptions),
    dropFiles,
    errors,
    /** @word js(expression): evaluates in the app window's page and returns its JSON value */
    js: (expression) => evaluate(expression),
    expect,
    field,
    files,
    find,
    goto,
    group,
    groups,
    heading,
    item,
    keyboard,
    link,
    look,
    menu: menuWord,
    model,
    omnibar,
    page: () => pageWord(),
    paste: pasteWord,
    press: pressWord,
    row,
    rpc,
    see: seeText,
    seed,
    settings,
    settle,
    shot: shotWord,
    side,
    sidebar,
    size,
    state,
    tab,
    tabs,
    theme,
    toast,
    toggle,
    type: typeWord,
    until,
    window: windowWord,
    windows,
  };

  const begin = async () => {
    await waitForDriveHandle(cdp);
    await cdp.send("Runtime.enable");
    // A page's own file picker (an <input type=file>) is held for the run
    // too, for dialog.choose to answer.
    await cdp.send("Page.enable");
    await cdp.send("Page.setInterceptFileChooserDialog", { enabled: true });
    cdp.on((message) => {
      if (message.method === "Page.fileChooserOpened") {
        fileChooser = message.params;
      } else if (message.method === "Runtime.exceptionThrown") {
        consoleErrors.push(message.params.exceptionDetails?.exception?.description ?? message.params.exceptionDetails?.text);
      } else if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
        consoleErrors.push(message.params.args.map((each) => each.value ?? each.description ?? "").join(" "));
      }
    });
    load = await evaluate("window.__studioDrive?.load() ?? null");
  };

  const end = async () => {
    for (const { connection, made } of others) {
      await made.end();
      connection.close();
    }
    for (const stub of stubs) await stub.close();
    for (const connection of guestCdps.values()) connection.close();
  };

  return { begin, end, words };
}

/** The options of a list, by name, the selected one marked. */
function optionNames(index, list) {
  const names = [];
  const walk = (id) => {
    const node = index.byId.get(id);
    if (!node) return;
    if (node.role === "option" && !node.ignored) {
      names.push(`${node.props.selected ? "▶ " : ""}${node.name}`);
      return;
    }
    for (const child of node.children) walk(child);
  };
  walk(list.id);
  return names;
}

/** Whether a menu path names rows of the menu bar, top menu optional. */
export function findMenuPath(bar, labels) {
  const fits = (row, label) => tierMatch(row.label, label);
  const walk = (rows, rest, trail) => {
    const [first, ...more] = rest;
    for (const row of rows) {
      if (!fits(row, first)) continue;
      if (more.length === 0) return row.submenu ? undefined : [...trail, row.label];
      if (row.submenu) {
        const found = walk(row.submenu, more, [...trail, row.label]);
        if (found) return found;
      }
    }
    return undefined;
  };
  // A path may leave out the top menu: menu("Print…") finds File › Print….
  const direct = walk(bar, labels, []);
  if (direct) return direct;
  for (const top of bar) {
    const found = walk(top.submenu ?? [], labels, [top.label]);
    if (found) return found;
  }
  // And a nested row by its own name: menu("Toggle Theme").
  for (const top of bar) {
    for (const row of top.submenu ?? []) {
      const found = row.submenu && walk(row.submenu, labels, [top.label, row.label]);
      if (found) return found;
    }
  }
  return undefined;
}

/** A label that is the name asked for, once folded (ellipsis, case, shortcut). */
function tierMatch(label, wanted) {
  const tier = tierOf(label, wanted);
  return tier !== undefined && tier <= 1 ? true : wanted instanceof RegExp ? false : fold(label) === fold(wanted);
}

const FOCUSED = `(() => {
  const el = document.activeElement;
  if (!el || el === document.body) return null;
  return "value" in el ? el.value : el.innerText;
})()`;

const WRITE_DRAG_PASTEBOARD = `function run(paths) {
  ObjC.import("AppKit");
  const board = $.NSPasteboard.pasteboardWithName($.NSPasteboardNameDrag);
  board.clearContents;
  board.writeObjects($(paths.map((each) => $.NSURL.fileURLWithPath(each))));
}`;

function modifierBits(modifiers) {
  const bits = { alt: 1, control: 2, ctrl: 2, meta: 4, cmd: 4, shift: 8 };
  return [modifiers].flat().reduce((sum, each) => sum | (bits[String(each).toLowerCase()] ?? 0), 0);
}

/** A raw CDP connection to a page target, as studio-app's openCdp gives one. */
async function openSocket(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(message.error.message));
    else entry.resolve(message.result);
  });
  return {
    close: () => socket.close(),
    send: (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++nextId;
        pending.set(id, { reject, resolve });
        socket.send(JSON.stringify({ id, method, params }));
      }),
  };
}
