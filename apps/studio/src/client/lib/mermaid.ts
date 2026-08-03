// Mermaid is several megabytes once d3 and dompurify come with it, so nothing
// here imports it statically: `loadMermaid` is the only door, and it is opened
// by markdown that actually carries a mermaid fence. Keep it that way — a
// static import anywhere on a startup path drags the whole thing into the
// renderer's entry chunk. (`import type` is erased at build time, so the type
// below costs nothing.)
import type { Mermaid } from "mermaid";

// A fence whose info string starts with `mermaid`. Deliberately permissive
// about leading whitespace: a fence nested in a list item carries more
// indentation than CommonMark's three-space limit for a top-level one, and this
// only decides whether to start fetching the chunk early. A false positive
// costs one prefetch; a false negative costs the reader a slower first diagram.
const MERMAID_FENCE = /^[\t ]*(?:`{3,}|~{3,})[\t ]*mermaid(?![\w-])/im;

export function containsMermaidFence(markdown: string): boolean {
  return MERMAID_FENCE.test(markdown);
}

/**
 * Whether a fence's language (as `markdownCode` pulls it out of
 * `language-<name>`) asks for a diagram.
 */
export function isMermaidLanguage(language: string | undefined): boolean {
  return language?.toLowerCase() === "mermaid";
}

const BASE_CONFIG = {
  // Mermaid's default failure mode is to inject its own error SVG into the
  // document — a graphic that is not ours and reads as a crash in the middle of
  // a message. We decide what a failure looks like, so it renders nothing.
  suppressErrorRendering: true,
  // Runs the generated SVG through DOMPurify and refuses the `click ... call`
  // form that would run a function. Diagram source arrives from a model, so it
  // is untrusted input. A `click X "https://..."` still renders as a real
  // anchor; where such a link is allowed to go is the window's business, not
  // this module's — see `guardNavigation`.
  securityLevel: "strict",
  startOnLoad: false,
  // Mermaid's own "dark" theme fills nodes with a near-black barely separable
  // from the surface we draw it on, and greys the text. "base" is the one
  // theme it will let us drive entirely, so both palettes below are ours.
  theme: "base",
} as const;

/**
 * The app's colors, in the variables mermaid draws a diagram from.
 *
 * A diagram is a card on a surface, the same as everything else in the app: a
 * node takes the card fill and the surface takes the background, which is what
 * gives a shape its edge. Mermaid derives the rest of its palette from these,
 * so only opaque tokens are used — the semantic border and muted-foreground
 * tokens are translucent white in dark mode, and mermaid's color math reads
 * them as the color underneath rather than the color you see.
 */
function themeVariables(theme: "dark" | "light") {
  // Read off the document, since this is the app's palette rather than a
  // second copy of it kept in sync by hand.
  const styles = globalThis.getComputedStyle(document.documentElement);
  const token = (name: string) => styles.getPropertyValue(name).trim();

  // A node's outline is chrome and takes card-border weight, but the edges
  // between nodes are the diagram's content — at the same weight a flowchart
  // reads as a set of boxes with the arrows between them nearly gone.
  const border = token(theme === "dark" ? "--gray-700" : "--gray-300");
  const line = token(theme === "dark" ? "--gray-400" : "--gray-500");
  const surface = token("--background");
  const text = token("--foreground");

  return {
    background: surface,
    // Tells mermaid's own derivations which way to move a color it is asked to
    // shade, so the ones we do not name here land on the right side.
    darkMode: theme === "dark",
    // Sits flush with the surface rather than in a chip of its own, which in
    // dark mode reads as a smudge over the edge it labels.
    edgeLabelBackground: surface,
    fontFamily: token("--font-sans"),
    lineColor: line,
    mainBkg: token("--card"),
    primaryBorderColor: border,
    primaryColor: token("--card"),
    primaryTextColor: text,
    // Alternate fills: subgraphs, notes, and the shaded bands in a sequence
    // diagram. One step further from the surface than a node, so nesting still
    // reads without inventing a color the app does not have.
    secondaryColor: token(theme === "dark" ? "--gray-700" : "--gray-100"),
    tertiaryColor: surface,
    textColor: text,
  };
}

let mermaidPromise: Promise<Mermaid> | undefined;

/**
 * Starts fetching the mermaid chunk without waiting for it. Called as soon as a
 * fence is spotted in streaming markdown, so the multi-megabyte download
 * overlaps the rest of the diagram arriving instead of following it.
 */
export function prefetchMermaid(): void {
  void loadMermaid().catch(() => {
    // Nothing is waiting on this one. The next render attempt starts the fetch
    // again, and that is the call that has a diagram to answer for.
  });
}

async function loadMermaid(): Promise<Mermaid> {
  // Only a *resolved* import may be cached. Caching the rejection too would
  // mean one dropped chunk fetch left every fence in the session as a code
  // block, with nothing able to try again short of restarting the app.
  mermaidPromise ??= import("mermaid")
    .then((module) => module.default)
    .catch((error: unknown) => {
      mermaidPromise = undefined;
      throw error;
    });
  return mermaidPromise;
}

// Mermaid's config is global and its renderer keeps module-level state, so two
// diagrams rendering at once can read each other's theme. Diagrams are cheap
// enough to serialize and there are rarely more than a handful on screen.
let renderQueue: Promise<unknown> = Promise.resolve();
let diagramCount = 0;

/**
 * Renders mermaid source to an SVG string, or resolves `undefined` when the
 * source does not parse.
 *
 * Half-written input is the normal case, not the exception: assistant markdown
 * streams a token at a time, so a graph is unparseable for most of the time it
 * is on screen. The parse is therefore a gate rather than an error path, and
 * callers are expected to hold whatever they are already showing when it fails.
 */
export async function renderMermaid({
  code,
  theme,
}: {
  code: string;
  theme: "dark" | "light";
}): Promise<string | undefined> {
  const mermaid = await loadMermaid();

  const run = renderQueue.then(async () => {
    // `initialize` writes the global config, which is also how a theme switch
    // reaches diagrams that are already mounted: they re-run this.
    mermaid.initialize({
      ...BASE_CONFIG,
      themeVariables: themeVariables(theme),
    });

    const parsed = await mermaid.parse(code, { suppressErrors: true });
    if (!parsed) {
      return;
    }

    diagramCount += 1;
    const { svg } = await mermaid.render(
      `mermaid-diagram-${diagramCount}`,
      code,
    );
    return svg;
  });

  // One diagram's failure must not wedge the queue for every diagram after it.
  renderQueue = run.catch(() => {
    // The queue only sequences renders; the caller owns the failure.
  });

  return run;
}

/**
 * Packs a rendered diagram into a data URL for the file-preview modal, which
 * shows it in an `<img>`.
 *
 * An `<img>` carries none of the page's CSS. Mermaid inlines its own `<style>`
 * inside the SVG so the diagram itself survives the trip, but the surface it
 * was drawn against does not — a dark-theme diagram would arrive as light
 * strokes on nothing. The caller passes the resolved background it is currently
 * sitting on, and the width cap mermaid fitted to the chat column comes off,
 * since the modal has the whole window to spend.
 */
export function toDiagramImageUrl({
  background,
  svg,
}: {
  background: string;
  svg: string;
}): string | undefined {
  const root = parseSvg(svg);
  if (!root) {
    return undefined;
  }

  root.style.backgroundColor = background;
  root.style.maxWidth = "none";

  const serialized = new XMLSerializer().serializeToString(root);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialized)}`;
}

/**
 * Reads mermaid's output back into a DOM.
 *
 * Parsed as HTML rather than as XML because mermaid writes `xlink:href`
 * without ever declaring that namespace, which leaves its own output not
 * well-formed XML the moment a diagram declares a link. A strict parse of that
 * yields a parser-error document instead of a diagram, so the caller below
 * concludes there is nothing to show and the reader gets a button that does
 * nothing. The HTML parser is lenient about exactly this, and still puts SVG
 * elements in the SVG namespace, so the tree that comes back is the same one.
 */
function parseSvg(svg: string): null | SVGSVGElement {
  const template = document.createElement("template");
  template.innerHTML = svg;
  const root = template.content.firstElementChild;
  return root instanceof SVGSVGElement ? root : null;
}
