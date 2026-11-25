// The window's accessibility tree, as the words read it: what each control
// is (its role), what it is called (its accessible name), and where it sits.
// Pure over the nodes `Accessibility.getFullAXTree` returns, so it is tested
// without an instance (ax.test.mjs).
//
// The tree already leaves out what a person cannot reach: a tab group that
// is not up is `inert` and invisible, and a modal hides the rest of the
// window, so its nodes come back ignored. A name matched here is a name on
// screen.

import { bestMatches } from "./names.mjs";

/** Roles that carry nothing a script names. */
const PLAIN = new Set([
  "generic",
  "InlineTextBox",
  "LineBreak",
  "none",
  "presentation",
  "RootWebArea",
  "StaticText",
]);

/** Roles that name where something is, for a failure or an ambiguity. */
const PLACES = new Set([
  "alertdialog",
  "dialog",
  "form",
  "listbox",
  "main",
  "menu",
  "navigation",
  "region",
  "tablist",
  "toolbar",
  "tree",
]);

/** What each word looks for. */
export const ROLES = {
  button: ["button", "menuitem", "menuitemcheckbox", "menuitemradio", "link"],
  control: [
    "button",
    "checkbox",
    "combobox",
    "link",
    "menuitem",
    "menuitemcheckbox",
    "menuitemradio",
    "option",
    "radio",
    "row",
    "searchbox",
    "slider",
    "switch",
    "tab",
    "textbox",
    "treeitem",
  ],
  field: ["combobox", "searchbox", "spinbutton", "textbox"],
  heading: ["heading"],
  item: ["menuitem", "menuitemcheckbox", "menuitemradio", "option"],
  link: ["link"],
  row: ["listitem", "option", "row", "treeitem", "gridcell", "cell"],
  tab: ["tab"],
  toggle: ["checkbox", "menuitemcheckbox", "radio", "switch"],
};

const PROPERTY_NAMES = new Set([
  "checked",
  "disabled",
  "expanded",
  "focused",
  "pressed",
  "selected",
  "url",
  "valuetext",
]);

/** Indexes the raw nodes by id and by DOM node, with what each one says of itself. */
export function indexTree(raw) {
  const byId = new Map();
  const byBackend = new Map();
  for (const node of raw) {
    const props = {};
    for (const { name, value } of node.properties ?? []) {
      if (PROPERTY_NAMES.has(name)) {
        props[name] = value?.value;
      }
    }
    const entry = {
      backend: node.backendDOMNodeId,
      children: node.childIds ?? [],
      id: node.nodeId,
      ignored: Boolean(node.ignored),
      name: String(node.name?.value ?? "").trim(),
      parent: node.parentId,
      props,
      role: String(node.role?.value ?? ""),
      value: node.value?.value,
    };
    byId.set(entry.id, entry);
    if (entry.backend !== undefined) {
      byBackend.set(entry.backend, entry);
    }
  }
  // Older trees give children only; the parent links follow from them.
  for (const entry of byId.values()) {
    for (const child of entry.children) {
      const node = byId.get(child);
      if (node && node.parent === undefined) {
        node.parent = entry.id;
      }
    }
  }
  return { byBackend, byId };
}

function* ancestors(index, id) {
  let at = index.byId.get(id)?.parent;
  while (at !== undefined) {
    const node = index.byId.get(at);
    if (!node) {
      return;
    }
    yield node;
    at = node.parent;
  }
}

/** Whether `id` sits inside any of `roots` (ids), or is one. */
export function isWithin(index, id, roots) {
  if (roots.has(id)) {
    return true;
  }
  for (const node of ancestors(index, id)) {
    if (roots.has(node.id)) {
      return true;
    }
  }
  return false;
}

/** The nearest named place around a node: `region "Right side"`. */
export function placeOf(index, id) {
  for (const node of ancestors(index, id)) {
    if (PLACES.has(node.role) && node.name) {
      return `${node.role} "${node.name}"`;
    }
  }
  return undefined;
}

/** A node as a failure names it: `button "Send" in region "Right side"`. */
export function describeNode(index, node) {
  const place = placeOf(index, node.id);
  const states = statesOf(node).filter((state) => state !== "focused");
  return `${node.role} ${JSON.stringify(node.name)}${states.length ? ` [${states.join(", ")}]` : ""}${place ? ` in ${place}` : ""}`;
}

/** Whether a node shows: not ignored by the tree, and none of its places is. */
export function isShown(index, node) {
  return !node.ignored;
}

/**
 * The nodes a word asks for: shown, of one of `roles`, inside `within` (a set
 * of ids) when given, at the best tier of `name`. Every node of those roles
 * in scope comes back too, as `pool`, for a failure to offer the nearest.
 */
export function findNodes(index, { name, nameOf, roles, selected, within }) {
  const wanted = new Set(roles);
  const pool = [];
  for (const node of index.byId.values()) {
    if (
      !isShown(index, node) ||
      !wanted.has(node.role) ||
      (within && !isWithin(index, node.id, within)) ||
      (selected && !node.props.selected)
    ) {
      continue;
    }
    pool.push(node);
  }
  return {
    matches: bestMatches(pool, name, nameOf ?? ((node) => node.name)),
    pool,
  };
}

/** A node's state as a line shows it: `[checked, selected]`. */
function statesOf(node) {
  const states = [];
  const { props } = node;
  if (props.checked === "true" || props.checked === true) {
    states.push("on");
  } else if (props.checked === "false" || props.checked === false) {
    states.push("off");
  }
  if (props.selected) {
    states.push("selected");
  }
  if (props.pressed === "true" || props.pressed === true) {
    states.push("pressed");
  }
  if (props.expanded === true) {
    states.push("open");
  }
  if (props.disabled) {
    states.push("disabled");
  }
  if (props.focused) {
    states.push("focused");
  }
  return states;
}

/**
 * The tree under `from` (the root when left out) as indented lines, one per
 * thing a script can name: `button "Send"`, `textbox "Talk to Instrument":
 * "hello" [focused]`. Plain wrappers are folded into their children; text
 * shows as a quoted line where no control around it names it already.
 */
export function outline(index, { depth = 40, from, maxLines = 400 } = {}) {
  const root =
    from === undefined
      ? [...index.byId.values()].find((node) => node.parent === undefined)
      : index.byId.get(from);
  if (!root) {
    return "";
  }
  const lines = [];
  const walk = (node, level, namedAbove) => {
    if (lines.length >= maxLines || level > depth) {
      return;
    }
    let next = level;
    let named = namedAbove;
    if (!node.ignored) {
      if (node.role === "StaticText") {
        const text = node.name.trim();
        if (text && ![...namedAbove].some((name) => name.includes(text))) {
          lines.push(`${"  ".repeat(level)}${JSON.stringify(node.name)}`);
        }
        return;
      }
      if (!PLAIN.has(node.role)) {
        const states = statesOf(node);
        const value =
          typeof node.value === "string" && node.value.trim() && node.value !== node.name
            ? `: ${JSON.stringify(node.value.slice(0, 80))}`
            : "";
        lines.push(
          `${"  ".repeat(level)}${node.role}${node.name ? ` ${JSON.stringify(node.name)}` : ""}${value}${states.length ? ` [${states.join(", ")}]` : ""}`,
        );
        next = level + 1;
        if (node.name) {
          named = new Set([...namedAbove, node.name]);
        }
      }
    }
    for (const child of node.children) {
      const childNode = index.byId.get(child);
      if (childNode) {
        walk(childNode, next, named);
      }
    }
  };
  walk(root, 0, new Set());
  if (lines.length >= maxLines) {
    lines.push("…");
  }
  return lines.join("\n");
}
