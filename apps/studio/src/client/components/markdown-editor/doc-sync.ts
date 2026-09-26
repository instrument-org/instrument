// The save and merge layer under the Markdown editor: what makes opening a
// file in it safe for the file.
//
// 1. Saves preserve untouched blocks. Every save re-derives what the person
//    touched from scratch: the latest disk text is split into top-level source
//    blocks (remark offsets), each paired with the ProseMirror node(s) it
//    parses into, and the editor's top-level nodes are aligned against those
//    disk nodes with a longest common subsequence over structural equality. A
//    disk block whose nodes all align with a run of editor nodes writes its
//    disk bytes; everything else goes through Milkdown's serializer. Nothing
//    depends on node identity or on a map built against an older disk text, so
//    agent edits landing between saves cannot desynchronize it. The stretches
//    of the spliced text that changed are reparsed, with a neighbor on either
//    side, as a check; where the result means something other than what the
//    editor shows (a serialized list fusing with a preserved neighbor), the
//    neighbors of the mismatch are re-serialized too, never the whole file.
//    Serialized blocks drop the backslash escapes their text does not need.
// 2. External changes merge as a block-level three-way merge: base = the disk
//    text the editor last synced with, ours = the editor, theirs = the new disk
//    text. Each block-level hunk the agent made is applied at the matching
//    place in the editor, narrowed to the characters that changed, out of undo
//    history. A hunk that overlaps blocks the person changed keeps theirs.
import { Fragment, type Node as PMNode } from "@milkdown/kit/prose/model";
import { type Transaction } from "@milkdown/kit/prose/state";
import { type EditorView } from "@milkdown/kit/prose/view";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified } from "unified";

export interface BodyAnalysis {
  body: string;
  context: string;
  groups: Group[];
  lead: string;
  nodes: NodeEntry[];
}

/** A disk text, analyzed: its front matter, and its body as blocks aligned with nodes. */
export interface DiskState extends BodyAnalysis {
  fm: string;
  text: string;
  version: string;
}

/** A range of the editor document an external change touched, for the highlight. */
export interface FlashRange {
  from: number;
  to: number;
}

/** One top-level source block of a body and the editor nodes it parses into. */
export interface Group {
  defs: string[];
  end: number;
  /** Index of the group's first node in the analysis' `nodes`, or -1 when none aligned. */
  first: number;
  index: number;
  parsed: null | PMNode[];
  size: number;
  start: number;
}

export interface SpliceStats {
  note: string;
  preserved: number;
  serialized: number;
}

interface MdNode {
  children?: MdNode[];
  position?: { end: MdPoint; start: MdPoint };
  type: string;
}

interface MdPoint {
  offset?: number;
}
interface NodeEntry {
  group: Group | null;
  node: PMNode;
}

// A single `$` is not math, as in Studio's static renderer: `$42,000` is money.
const remark = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath, { singleDollarTextMath: false });

const parseTree = (text: string): MdNode => remark.parse(text);
const startOf = (n: MdNode) => n.position?.start.offset ?? 0;
const endOf = (n: MdNode) => n.position?.end.offset ?? 0;

// ---------------------------------------------------------------- front matter

const FRONT_MATTER =
  /^---[ \t]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;

interface NodeJson {
  attrs?: Record<string, unknown>;
  content?: NodeJson[];
  type: string;
}

/**
 * A node's (or fragment's) children with their offsets. ProseMirror nodes are
 * not iterable, so a loop over children goes through this.
 */
export function childrenOf(
  parent: Fragment | PMNode,
): { index: number; node: PMNode; offset: number }[] {
  const out: { index: number; node: PMNode; offset: number }[] = [];
  let offset = 0;
  for (let index = 0; index < parent.childCount; index++) {
    const node = parent.child(index);
    out.push({ index, node, offset });
    offset += node.nodeSize;
  }
  return out;
}

// ---------------------------------------------------------------- node comparison

/** Milkdown's trailing plugin keeps an empty paragraph at the end; it is not content. */
export function contentNodes(pmDoc: PMNode): PMNode[] {
  const nodes: PMNode[] = [];
  for (const { node: n } of childrenOf(pmDoc)) nodes.push(n);
  while (nodes.length > 0) {
    const last = nodes.at(-1);
    if (last?.type.name === "paragraph" && last.content.size === 0) {
      nodes.pop();
    } else {
      break;
    }
  }
  return nodes;
}

export function splitFrontMatter(text: string): { body: string; fm: string } {
  const m = FRONT_MATTER.exec(text);
  return m
    ? { body: text.slice(m[0].length), fm: m[0] }
    : { body: text, fm: "" };
}

/**
 * Structural identity of a node, ignoring heading ids (Milkdown fills those
 * in after parsing; they are not in the Markdown). Nodes are immutable, so the
 * key is cached per node object.
 */
const keyCache = new WeakMap<PMNode, string>();
export function keyOf(node: PMNode): string {
  let k = keyCache.get(node);
  if (k === undefined) {
    const strip = (j: NodeJson): NodeJson => {
      if (j.type === "heading" && j.attrs) {
        j.attrs = { ...j.attrs, id: "" };
      }
      j.content?.forEach(strip);
      return j;
    };
    // `toJSON` is typed loosely by ProseMirror; its shape is NodeJson.
    k = JSON.stringify(strip(node.toJSON() as NodeJson));
    keyCache.set(node, k);
  }
  return k;
}

/** A copy with heading ids blanked, so position diffs ignore them. */
function stripIds(node: PMNode): PMNode {
  if (node.isText || node.isLeaf) {
    return node;
  }
  const kids: PMNode[] = [];
  for (const { node: c } of childrenOf(node)) kids.push(stripIds(c));
  const attrs =
    node.type.name === "heading" && node.attrs.id
      ? { ...node.attrs, id: "" }
      : node.attrs;
  return node.type.create(attrs, kids, node.marks);
}

export const sameKeys = (a: readonly PMNode[], b: readonly PMNode[]) =>
  a.length === b.length && a.every((n, i) => b[i] && keyOf(n) === keyOf(b[i]));

/** LCS over two key arrays; returns, for each index of `a`, the matched index in `b` or -1. */
function lcsMatch(a: readonly string[], b: readonly string[]): number[] {
  const n = a.length;
  const m = b.length;
  // Trim the common prefix and suffix first: agent edits and typing touch few blocks.
  let lo = 0;
  while (lo < n && lo < m && a[lo] === b[lo]) {
    lo++;
  }
  let hi = 0;
  while (hi < n - lo && hi < m - lo && a[n - 1 - hi] === b[m - 1 - hi]) {
    hi++;
  }
  const out = Array.from({ length: n }, () => -1);
  for (let i = 0; i < lo; i++) {
    out[i] = i;
  }
  for (let i = 0; i < hi; i++) {
    out[n - 1 - i] = m - 1 - i;
  }
  const A = a.slice(lo, n - hi);
  const B = b.slice(lo, m - hi);
  const dp = Array.from(
    { length: A.length + 1 },
    () => new Uint32Array(B.length + 1),
  );
  const at = (i: number, j: number) => dp[i]?.[j] ?? 0;
  for (let i = A.length - 1; i >= 0; i--) {
    const row = dp[i];
    if (!row) {
      continue;
    }
    for (let j = B.length - 1; j >= 0; j--) {
      row[j] =
        A[i] === B[j]
          ? at(i + 1, j + 1) + 1
          : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }
  for (let i = 0, j = 0; i < A.length && j < B.length;) {
    if (A[i] === B[j]) {
      out[lo + i] = lo + j;
      i++;
      j++;
    } else if (at(i + 1, j) >= at(i, j + 1)) {
      i++;
    } else {
      j++;
    }
  }
  return out;
}

const isDefinition = (type: string) =>
  type === "definition" || type === "footnoteDefinition";
const isEmptyParagraph = (n: PMNode) =>
  n.type.name === "paragraph" && n.content.size === 0;

export type DocSync = ReturnType<typeof createDocSync>;
export interface DocSyncDeps {
  /** Milkdown's parser: Markdown to a document node. Throws on some input. */
  parse: (markdown: string) => PMNode;
  /** Milkdown's serializer: a document node to Markdown. */
  serialize: (doc: PMNode) => string;
  view: () => EditorView;
}

/**
 * Where two texts differ, as [{ os, oe, ns, ne }] ranges of `a` and `b`: the
 * common prefix and suffix trimmed, and a long remainder split at a paragraph
 * both hold exactly once, so edits far apart stay separate hunks.
 */
interface Hunk {
  ne: number;
  ns: number;
  oe: number;
  os: number;
}

/**
 * The analysis and splice machinery bound to one editor. Holds no disk state
 * of its own beyond caches; the caller keeps the `DiskState` it last synced
 * with and passes it in.
 */
export function createDocSync({ parse, serialize, view }: DocSyncDeps) {
  const parseCache = new Map<string, null | PMNode[]>();
  // context text -> how many top-level nodes it parses into
  const contextSize = new Map<string, number>();
  let lastSplice: SpliceStats = { note: "", preserved: 0, serialized: 0 };
  // The analysis of the last spliced body, built from disk analysis `base`.
  let splicedDisk: null | { base: DiskState; next: BodyAnalysis | null } = null;

  /** The top-level nodes one source block parses into. Definitions ride along as context so footnote references resolve. */
  function nodesForSlice(
    slice: string,
    context: string,
    cache = true,
  ): null | PMNode[] {
    const key = `${slice}\u0000${context}`;
    if (cache && parseCache.has(key)) {
      return parseCache.get(key) ?? null;
    }
    let nodes: null | PMNode[];
    try {
      if (context) {
        const withCtx = contentNodes(parse(`${slice}\n\n${context}`));
        let size = contextSize.get(context);
        if (size === undefined) {
          if (contextSize.size > 20) {
            contextSize.clear();
          }
          size = contentNodes(parse(context)).length;
          contextSize.set(context, size);
        }
        nodes = withCtx.slice(0, withCtx.length - size);
      } else {
        nodes = contentNodes(parse(slice));
      }
    } catch {
      // Milkdown's parser throws on some input; treat the block as unmappable.
      nodes = null;
    }
    if (!cache) {
      return nodes;
    }
    if (parseCache.size > 2000) {
      parseCache.clear();
    }
    parseCache.set(key, nodes);
    return nodes;
  }

  /**
   * The source blocks of `text`, a stretch of the body starting at body
   * offset `at`, paired with `children`, the nodes the stretch parses into.
   * Blocks that parse to nothing (link definitions) fold into the previous
   * block so their bytes travel with it; each group lists its definitions.
   */
  function analyze(
    text: string,
    at: number,
    children: PMNode[],
    context: string,
    tree: MdNode = parseTree(text),
  ) {
    const groups: Group[] = [];
    for (const n of tree.children ?? []) {
      const start = startOf(n);
      const end = endOf(n);
      const slice = text.slice(start, end);
      const def = isDefinition(n.type) ? [slice] : [];
      const parsed = nodesForSlice(slice, context);
      const previous = groups.at(-1);
      if (parsed?.length === 0 && previous) {
        previous.end = at + end;
        previous.defs.push(...def);
        continue;
      }
      groups.push({
        defs: def,
        end: at + end,
        first: -1,
        index: 0,
        parsed,
        size: 0,
        start: at + start,
      });
    }
    const nodes: NodeEntry[] = children.map((node) => ({ group: null, node }));
    let j = 0;
    for (const g of groups) {
      const parsed = g.parsed;
      if (!parsed?.length) {
        continue;
      }
      const fits = (k: number) =>
        parsed.every((n, m) => {
          const c = children[k + m];
          return c !== undefined && keyOf(c) === keyOf(n);
        });
      for (let k = j; k + parsed.length <= children.length; k++) {
        if (fits(k)) {
          g.first = k;
          g.size = parsed.length;
          for (let m = 0; m < g.size; m++) {
            const entry = nodes[k + m];
            if (entry) {
              entry.group = g;
            }
          }
          j = k + g.size;
          break;
        }
      }
    }
    return { groups, nodes };
  }

  /**
   * Analyze a whole body: its nodes, and the source block (byte range) each
   * node came from. `context` is the body's link and footnote definitions,
   * which every block is parsed with. Throws when Milkdown cannot parse it.
   */
  function analyzeBody(body: string): BodyAnalysis {
    const tree = parseTree(body);
    const context = (tree.children ?? [])
      .filter((n) => isDefinition(n.type))
      .map((n) => body.slice(startOf(n), endOf(n)))
      .join("\n\n");
    const { groups, nodes } = analyze(
      body,
      0,
      contentNodes(parse(body)),
      context,
      tree,
    );
    for (const [i, g] of groups.entries()) {
      g.index = i;
    }
    return { body, context, groups, lead: /^\s*/.exec(body)?.[0] ?? "", nodes };
  }

  /** Analyze a disk text: front matter, then the body as analyzeBody does. */
  function loadDisk(text: string, version: string): DiskState {
    const { body, fm } = splitFrontMatter(text);
    return { fm, text, version, ...analyzeBody(body) };
  }

  /**
   * analyzeBody(body) for a body that differs from the analyzed `d.body` in a
   * few places, without reparsing the rest: blocks outside the changed
   * stretches keep their analysis (offsets shifted), and each stretch is
   * reparsed with one unchanged block on either side. Those neighbors must
   * come back exactly as they were, so a change that reaches past them (an
   * unclosed fence, a list that fuses with the next one) is caught. Returns
   * null where the result could differ from a full analysis.
   */
  function patchBody(d: BodyAnalysis, body: string): BodyAnalysis | null {
    const G = d.groups;
    const n = G.length;
    const mapped = (i: number) => (G[i]?.first ?? -1) >= 0;
    const regions: { delta: number; hi: number; lo: number }[] = [];
    for (const h of diffHunks(d.body, body)) {
      let lo = G.findLastIndex((g) => g.end <= h.os);
      while (lo > 0 && !(mapped(lo) && mapped(lo - 1))) {
        lo--;
      }
      let hi = G.findIndex((g) => g.start >= h.oe);
      if (hi < 0) {
        hi = n - 1;
      }
      while (hi >= 0 && hi < n - 1 && !(mapped(hi) && mapped(hi + 1))) {
        hi++;
      }
      lo = Math.max(lo, 0);
      const delta = h.ne - h.ns - (h.oe - h.os);
      const last = regions.at(-1);
      if (last && lo <= last.hi + 1) {
        last.hi = Math.max(last.hi, hi);
        last.delta += delta;
      } else {
        regions.push({ delta, hi, lo });
      }
    }

    const groups: Group[] = [];
    const nodes: NodeEntry[] = [];
    const moved = new Map<Group, Group>(); // old group -> its copy
    let g0 = 0; // next old group to keep
    let n0 = 0; // next old node to keep
    let shift = 0;
    const keep = (gTo: number, nTo: number) => {
      const nodeShift = nodes.length - n0;
      for (; g0 < gTo; g0++) {
        const g = G[g0];
        if (!g) {
          continue;
        }
        const copy = {
          ...g,
          end: g.end + shift,
          first: g.first >= 0 ? g.first + nodeShift : -1,
          start: g.start + shift,
        };
        moved.set(g, copy);
        groups.push(copy);
      }
      for (; n0 < nTo; n0++) {
        const entry = d.nodes[n0];
        if (entry) {
          nodes.push({
            group: entry.group ? (moved.get(entry.group) ?? null) : null,
            node: entry.node,
          });
        }
      }
    };
    const oldNodes = (g: Group | undefined) =>
      g ? d.nodes.slice(g.first, g.first + g.size).map((x) => x.node) : [];

    for (const { delta, hi, lo } of regions) {
      if (hi < lo) {
        return null;
      }
      const before = G[lo - 1];
      const after = G[hi + 1];
      const oStart = lo > 0 && before ? before.end : 0;
      const oEnd = hi < n - 1 && after ? after.start : d.body.length;
      keep(lo, lo > 0 && before ? before.first + before.size : 0);
      const start = oStart + shift;
      const end = oEnd + shift + delta;
      const text = body.slice(start, end);
      const children = nodesForSlice(text, d.context, false);
      if (!children) {
        return null;
      }
      const r = analyze(text, start, children, d.context);
      const oldDefs = G.slice(lo, hi + 1).flatMap((g) => g.defs);
      const newDefs = r.groups.flatMap((g) => g.defs);
      if (oldDefs.join("\n\n") !== newDefs.join("\n\n")) {
        return null;
      }
      const gLo = G[lo];
      if (lo > 0 && gLo) {
        const first = r.groups[0];
        if (
          !first ||
          first.start !== gLo.start + shift ||
          first.end !== gLo.end + shift ||
          first.first !== 0 ||
          !sameKeys(children.slice(0, first.size), oldNodes(gLo))
        ) {
          return null;
        }
      }
      const gHi = G[hi];
      if (hi < n - 1 && gHi) {
        const last = r.groups.at(-1);
        const s = shift + delta;
        if (
          !last ||
          last.start !== gHi.start + s ||
          last.end !== gHi.end + s ||
          last.first < 0 ||
          last.first + last.size !== children.length ||
          !sameKeys(children.slice(last.first), oldNodes(gHi))
        ) {
          return null;
        }
      }
      const base = nodes.length;
      for (const g of r.groups) {
        if (g.first >= 0) {
          g.first += base;
        }
        groups.push(g);
      }
      nodes.push(...r.nodes);
      g0 = hi + 1;
      n0 = hi < n - 1 && after ? after.first : d.nodes.length;
      shift += delta;
    }
    keep(n, d.nodes.length);
    for (const [i, g] of groups.entries()) {
      g.index = i;
    }
    return {
      body,
      context: d.context,
      groups,
      lead: /^\s*/.exec(body)?.[0] ?? "",
      nodes,
    };
  }

  /** loadDisk(text, version), reusing the analysis of `d` wherever the text did not change. */
  function patchDisk(d: DiskState, text: string, version: string): DiskState {
    const { body, fm } = splitFrontMatter(text);
    const next = body === d.body ? d : patchBody(d, body);
    return next
      ? {
          body,
          context: next.context,
          fm,
          groups: next.groups,
          lead: next.lead,
          nodes: next.nodes,
          text,
          version,
        }
      : loadDisk(text, version);
  }

  /**
   * Backslash escapes the serializer wrote inside text (not in code, HTML or
   * math, where a backslash is content): offsets of each `\` that escapes an
   * ASCII punctuation character other than a backslash.
   */
  function escapeSites(md: string): number[] {
    const sites: number[] = [];
    const visit = (n: MdNode) => {
      if (n.type === "text" && n.position) {
        const s = n.position.start.offset ?? 0;
        const e = n.position.end.offset ?? 0;
        for (let i = s; i < e - 1; i++) {
          if (md[i] === "\\") {
            if (/[!-/:-@[\]-`{-~]/.test(md[i + 1] ?? "")) {
              sites.push(i);
            }
            i++;
          }
        }
      }
      n.children?.forEach(visit);
    };
    visit(parseTree(md));
    return sites;
  }

  /**
   * Serialized Markdown for `nodes` with every backslash escape removed that
   * the text does not need: the result must parse, with the document's link
   * and footnote definitions as `context`, to exactly what `md` parses to.
   * Escapes are dropped all at once, and where that changes the meaning, the
   * set is halved until the ones that matter are isolated.
   */
  function minimizeEscapes(
    md: string,
    nodes: PMNode[],
    context: string,
  ): string {
    const sites = escapeSites(md);
    if (sites.length === 0) {
      return md;
    }
    const without = (drop: number[]) => {
      const set = new Set(drop);
      let out = "";
      let last = 0;
      for (const i of sites) {
        if (set.has(i)) {
          out += md.slice(last, i);
          last = i + 1;
        }
      }
      return out + md.slice(last);
    };
    // What the escaped text means; where the serializer cannot round-trip the
    // block exactly, that meaning, not the editor's nodes, is what dropping an
    // escape must keep.
    const target = nodesForSlice(md, context) ?? nodes;
    let budget = 48;
    const ok = (drop: number[]) => {
      budget--;
      const re = nodesForSlice(without(drop), context);
      return !!re && sameKeys(re, target);
    };
    const dropped: number[] = [];
    const tryGroup = (group: number[]) => {
      if (group.length === 0 || budget <= 0) {
        return;
      }
      if (ok([...dropped, ...group])) {
        dropped.push(...group);
        return;
      }
      if (group.length === 1) {
        return;
      }
      tryGroup(group.slice(0, group.length >> 1));
      tryGroup(group.slice(group.length >> 1));
    };
    tryGroup(sites);
    return dropped.length > 0 ? without(dropped) : md;
  }

  /** Disk bytes for every block the editor still has unchanged, serializer output for the rest. */
  function splicedBody(pmDoc: PMNode, d: DiskState): string {
    // Empty paragraphs (Enter pressed twice) are not written; Milkdown would
    // serialize each as a `<br />` paragraph nobody typed.
    const E = contentNodes(pmDoc).filter((n) => !isEmptyParagraph(n));
    if (
      sameKeys(
        E,
        d.nodes.map((x) => x.node),
      )
    ) {
      lastSplice = { note: "", preserved: d.groups.length, serialized: 0 };
      return d.body;
    }
    const match = lcsMatch(
      E.map(keyOf),
      d.nodes.map((x) => keyOf(x.node)),
    );
    const demoted = new Set<Group>();
    // The previous attempt, while widening.
    let prev: null | {
      bad: number;
      next: BodyAnalysis | null;
      stats: { preserved: number; serialized: number };
      text: string;
    } = null;
    const schema = pmDoc.type.schema;
    let note = "";
    const groupAt = (i: number) => {
      const m = match[i] ?? -1;
      return m >= 0 ? (d.nodes[m]?.group ?? null) : null;
    };

    for (let attempt = 0; ; attempt++) {
      // Walk the editor's nodes; a disk group is intact when all of its nodes
      // align, in order, with consecutive editor nodes.
      type Item =
        | { from: number; group: Group; nodes?: undefined }
        | { from: number; group?: undefined; nodes: PMNode[] };
      const items: Item[] = [];
      for (let i = 0; i < E.length;) {
        const g = groupAt(i);
        const intact =
          g !== null &&
          !demoted.has(g) &&
          match[i] === g.first &&
          Array.from(
            { length: g.size },
            (_, m) => match[i + m] === g.first + m,
          ).every(Boolean);
        if (intact) {
          items.push({ from: i, group: g });
          i += g.size;
        } else {
          const last = items.at(-1);
          const node = E[i];
          if (node) {
            if (last?.nodes) {
              last.nodes.push(node);
            } else {
              items.push({ from: i, nodes: [node] });
            }
          }
          i++;
        }
      }

      let text = d.lead;
      let preserved = 0;
      let serialized = 0;
      for (const [k, it] of items.entries()) {
        const before = items[k - 1];
        if (before) {
          text +=
            it.group && before.group?.index === it.group.index - 1
              ? d.body.slice(before.group.end, it.group.start)
              : "\n\n";
        }
        if (it.group) {
          text += d.body.slice(it.group.start, it.group.end);
          preserved++;
        } else {
          const md = serialize(
            schema.topNodeType.create(null, it.nodes),
          ).replaceAll(/^\n+|\n+$/g, "");
          text += minimizeEscapes(md, it.nodes, d.context);
          serialized += it.nodes.length;
        }
      }
      const last = items.at(-1);
      text +=
        last?.group && last.group.index === d.groups.length - 1
          ? d.body.slice(last.group.end)
          : items.length > 0
            ? "\n"
            : "";

      // Check: the spliced file must mean what the editor shows. Where it does
      // not, re-serialize the preserved neighbors of the first mismatch. The
      // analysis of the spliced text is kept: after the save it is the disk's.
      let bad = -1;
      let next: BodyAnalysis | null = null;
      try {
        next = patchBody(d, text) ?? analyzeBody(text);
        const R = next.nodes
          .map((x) => x.node)
          .filter((n) => !isEmptyParagraph(n));
        const count = Math.max(R.length, E.length);
        for (let i = 0; i < count; i++) {
          const r = R[i];
          const e = E[i];
          if (!r || !e || keyOf(r) !== keyOf(e)) {
            bad = i;
            break;
          }
        }
      } catch (error) {
        bad = 0;
        note = `spliced text failed to parse (${error instanceof Error ? error.message : "unknown"})`;
      }
      if (bad < 0) {
        lastSplice = { note, preserved, serialized };
        splicedDisk = { base: d, next };
        return text;
      }
      // A mismatch that survives re-serializing its neighbors is the
      // serializer's own round-trip limit (trailing spaces mid-typing, say),
      // not a fusion with a neighbor; widening further would only rewrite more
      // of the file, so settle for the text from before that last widening.
      if (prev !== null && prev.bad === bad) {
        lastSplice = {
          ...prev.stats,
          note:
            note ||
            `block ${bad + 1} does not round-trip exactly through the serializer`,
        };
        splicedDisk = { base: d, next: prev.next };
        return prev.text;
      }
      let k = items.findLastIndex((it) => it.from <= bad);
      if (k < 0) {
        k = 0;
      }
      let grew = false;
      for (const it of [items[k - 1], items[k], items[k + 1]]) {
        if (it?.group && !demoted.has(it.group)) {
          demoted.add(it.group);
          grew = true;
        }
      }
      if (!grew || attempt > 8) {
        lastSplice = {
          note:
            note ||
            `block ${bad + 1} does not round-trip exactly through the serializer`,
          preserved,
          serialized,
        };
        splicedDisk = { base: d, next };
        return text;
      }
      prev = { bad, next, stats: { preserved, serialized }, text };
    }
  }

  /**
   * The disk state after a save of `text` over `d` landed as `version`: the
   * splice's own analysis when it was made from this very disk state, else a
   * patch of `d`.
   */
  function diskAfterSave(
    d: DiskState,
    text: string,
    version: string,
  ): DiskState {
    const { body, fm } = splitFrontMatter(text);
    const next =
      splicedDisk?.base === d && splicedDisk.next?.body === body
        ? splicedDisk.next
        : null;
    return next ? { ...next, fm, text, version } : patchDisk(d, text, version);
  }

  /**
   * Bring new disk text into the editor as the minimal edits the change made.
   * Returns the new disk state, a short description, whether the person's
   * version of some block was kept over the agent's, and the ranges touched.
   */
  function merge(
    disk: DiskState,
    content: string,
    version: string,
    tag: (tr: Transaction, flashes: FlashRange[]) => void,
  ): {
    conflicts: number;
    flashes: FlashRange[];
    next: DiskState;
    result: string;
  } {
    const next = patchDisk(disk, content, version);
    const v = view();
    // Typing reaches ProseMirror through a DOM observer that flushes on its
    // own schedule; read any pending input into the state first, or redrawing
    // the merged doc can drop keystrokes the state has not seen yet.
    flushDomObserver(v);
    const cur = v.state.doc;
    const O = contentNodes(cur);
    const B = disk.nodes.map((x) => x.node);
    const T = next.nodes.map((x) => x.node);
    const userEdited = !sameKeys(O, B);
    const { conflicts, ops } = planMerge(
      B.map(keyOf),
      O.map(keyOf),
      T.map(keyOf),
    );

    // Top-level index -> doc position.
    const pos = [0];
    for (const [i, n] of O.entries()) pos.push((pos[i] ?? 0) + n.nodeSize);
    const schema = cur.type.schema;
    const tr = v.state.tr;
    const marks: { from: number; step: number; to: number }[] = [];
    // Apply back to front so earlier positions stay valid; at one position,
    // the replacement goes before an insertion, and later hunks before earlier.
    const ordered = ops
      .map((op, i) => ({ ...op, i }))
      .sort((a, b) => b.from - a.from || b.to - a.to || b.i - a.i);
    for (const op of ordered) {
      const from = pos[op.from] ?? 0;
      const nodes = T.slice(op.nodes[0], op.nodes[1]);
      // Narrow to the characters that changed so the caret and the person's
      // untouched structure are left alone.
      const oldFrag = Fragment.fromArray(O.slice(op.from, op.to).map(stripIds));
      const newFrag = Fragment.fromArray(nodes.map(stripIds));
      const start = oldFrag.findDiffStart(newFrag);
      if (start == null) {
        continue;
      }
      const end = oldFrag.findDiffEnd(newFrag);
      let endA = end?.a ?? oldFrag.size;
      let endB = end?.b ?? newFrag.size;
      const over = start - Math.min(endA, endB);
      if (over > 0) {
        endA += over;
        endB += over;
      }
      const tmp = schema.topNodeType.create(null, Fragment.fromArray(nodes));
      tr.replace(from + start, from + endA, tmp.slice(start, endB));
      marks.push({
        from: from + start,
        step: tr.steps.length,
        to: from + endB,
      });
    }

    const flashes: FlashRange[] = marks.map((f) => ({
      from: tr.mapping.slice(f.step).map(f.from, -1),
      to: tr.mapping.slice(f.step).map(f.to, 1),
    }));
    if (tr.docChanged) {
      tr.setMeta("addToHistory", false);
      tag(tr, flashes);
      v.dispatch(tr);
    }
    if (!userEdited && !sameKeys(contentNodes(v.state.doc), T)) {
      // Should not happen; keep the editor honest if it does.
      const all = v.state.tr
        .replaceWith(0, v.state.doc.content.size, Fragment.fromArray(T))
        .setMeta("addToHistory", false);
      tag(all, []);
      v.dispatch(all);
      console.warn("markdown editor: merge fell back to a full replace");
    }
    let result =
      !tr.docChanged && next.fm === disk.fm
        ? "file changed on disk, nothing visible changed"
        : userEdited
          ? "merged the agent edit around your unsaved edits"
          : "merged the agent edit";
    if (conflicts > 0) {
      result = `the agent edited ${conflicts === 1 ? "a block" : `${conflicts} blocks`} you are also editing, so your version was kept`;
    }
    return { conflicts, flashes, next, result };
  }

  /**
   * The lines of the file on disk a stretch of the editor comes from, 1-based
   * and inclusive: the blocks holding `from` and `to`, narrowed to the lines
   * holding the first and last words of `quote` where those can be found in
   * the blocks' source. Undefined where the blocks have no source on disk yet
   * (typed and not saved).
   */
  function sourceLines(
    pmDoc: PMNode,
    disk: DiskState,
    from: number,
    to: number,
    quote: string,
  ): [number, number] | undefined {
    const E = contentNodes(pmDoc);
    const match = lcsMatch(
      E.map(keyOf),
      disk.nodes.map((x) => keyOf(x.node)),
    );
    const indexAt = (pos: number) => {
      let at = 0;
      for (const [i, element] of E.entries()) {
        const size = element.nodeSize;
        if (pos < at + size) {
          return i;
        }
        at += size;
      }
      return E.length - 1;
    };
    const groupOf = (i: number) => {
      const m = match[i] ?? -1;
      return m >= 0 ? (disk.nodes[m]?.group ?? null) : null;
    };
    const first = groupOf(indexAt(from));
    // A selection dragged to the end of a line often ends at the very start
    // of the next block; the last block is the last one it holds words of.
    const firstIndex = indexAt(from);
    let lastIndex = indexAt(Math.max(from, to - 1));
    let blockStart = E.slice(0, lastIndex).reduce(
      (sum, n) => sum + n.nodeSize,
      0,
    );
    while (lastIndex > firstIndex) {
      const size = E[lastIndex]?.nodeSize ?? 0;
      const held = pmDoc.textBetween(
        Math.max(from, blockStart),
        Math.min(to, blockStart + size),
      );
      if (held.trim()) {
        break;
      }
      lastIndex--;
      blockStart -= E[lastIndex]?.nodeSize ?? 0;
    }
    const last = groupOf(lastIndex);
    if (!first || !last) {
      return undefined;
    }
    const lineAt = (bodyOffset: number) =>
      (disk.fm + disk.body.slice(0, bodyOffset)).split("\n").length;
    // A few words of the quote's first and last lines, found in the block's
    // source, pin the lines down inside a long block. Markup inside those
    // words (emphasis, a link) keeps them from matching, and the block's own
    // edge stands instead.
    const words = quote
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const head = (words[0] ?? "").slice(0, 24);
    const tail = (words.at(-1) ?? "").slice(-24);
    const inFirst = head
      ? disk.body.slice(first.start, first.end).indexOf(head)
      : -1;
    const inLast = tail
      ? disk.body.slice(last.start, last.end).lastIndexOf(tail)
      : -1;
    const start = lineAt(inFirst >= 0 ? first.start + inFirst : first.start);
    const end = lineAt(
      inLast >= 0 ? last.start + inLast : Math.max(last.start, last.end - 1),
    );
    return [start, Math.max(start, end)];
  }

  return {
    analyzeBody,
    diskAfterSave,
    lastSplice: () => lastSplice,
    loadDisk,
    merge,
    minimizeEscapes,
    patchBody,
    patchDisk,
    sourceLines,
    splicedBody,
  };
}

/** ProseMirror's DOM observer is internal; flushing it reads pending keystrokes into the state. */
export function flushDomObserver(v: EditorView) {
  // `domObserver` is not in ProseMirror's public types.
  const observer = (v as unknown as { domObserver?: { flush?: () => void } })
    .domObserver;
  observer?.flush?.();
}

function diffHunks(
  a: string,
  b: string,
  as0 = 0,
  ae0 = a.length,
  bs0 = 0,
  be0 = b.length,
  out: Hunk[] = [],
): Hunk[] {
  let as = as0;
  let ae = ae0;
  let bs = bs0;
  let be = be0;
  while (as < ae && bs < be && a.charCodeAt(as) === b.charCodeAt(bs)) {
    as++;
    bs++;
  }
  while (ae > as && be > bs && a.charCodeAt(ae - 1) === b.charCodeAt(be - 1)) {
    ae--;
    be--;
  }
  if (as === ae && bs === be) {
    return out;
  }
  if (ae - as > 20_000 && be - bs > 20_000) {
    const from = a.indexOf("\n\n", (as + ae) >> 1);
    const to = from === -1 ? -1 : a.indexOf("\n\n", from + 2);
    const anchor = to > 0 && to + 2 <= ae ? a.slice(from, to + 2) : "";
    const once = (s: string, lo: number, hi: number) => {
      const i = s.indexOf(anchor, lo);
      if (i === -1 || i + anchor.length > hi) {
        return -1;
      }
      const again = s.indexOf(anchor, i + 1);
      return again === -1 || again + anchor.length > hi ? i : -1;
    };
    const at =
      anchor.length > 24 && once(a, as, ae) === from ? once(b, bs, be) : -1;
    if (at >= 0) {
      diffHunks(a, b, as, from, bs, at, out);
      return diffHunks(
        a,
        b,
        from + anchor.length,
        ae,
        at + anchor.length,
        be,
        out,
      );
    }
  }
  out.push({ ne: be, ns: bs, oe: ae, os: as });
  return out;
}

/**
 * Block-level three-way merge plan. Arguments are key arrays; returns ops on
 * `ours` indices ({ from, to, nodes: theirs [start, end) }) and a conflict count.
 */
function planMerge(
  base: readonly string[],
  ours: readonly string[],
  theirs: readonly string[],
) {
  const bo = lcsMatch(base, ours);
  const bt = lcsMatch(base, theirs);
  const pairs: [number, number][] = [[-1, -1]];
  for (const [b, tIdx] of bt.entries()) {
    if (tIdx >= 0) {
      pairs.push([b, tIdx]);
    }
  }
  pairs.push([base.length, theirs.length]);
  const ops: { from: number; nodes: [number, number]; to: number }[] = [];
  let conflicts = 0;
  for (let k = 1; k < pairs.length; k++) {
    const [pb, pt] = pairs[k - 1] ?? [-1, -1];
    const [nb, nt] = pairs[k] ?? [base.length, theirs.length];
    if (nb === pb + 1 && nt === pt + 1) {
      continue;
    }
    const bFrom = pb + 1;
    const tNodes: [number, number] = [pt + 1, nt];
    if (bFrom === nb) {
      // Pure insertion: before the editor's copy of the next base block the person kept.
      let at = ours.length;
      for (let b = nb; b < base.length; b++) {
        const o = bo[b] ?? -1;
        if (o >= 0) {
          at = o;
          break;
        }
      }
      ops.push({ from: at, nodes: tNodes, to: at });
      continue;
    }
    const idx: number[] = [];
    for (let b = bFrom; b < nb; b++) {
      idx.push(bo[b] ?? -1);
    }
    const first = idx[0] ?? -1;
    if (idx.every((x, m) => x >= 0 && x === first + m)) {
      ops.push({ from: first, nodes: tNodes, to: first + idx.length });
    } else {
      conflicts++;
    }
  }
  return { conflicts, ops };
}
