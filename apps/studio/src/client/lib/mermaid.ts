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
  // Runs the generated SVG through DOMPurify and refuses click bindings and
  // raw HTML in node labels. Diagram source arrives from a model, so it is
  // untrusted input.
  securityLevel: "strict",
  startOnLoad: false,
} as const;

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
      theme: theme === "dark" ? "dark" : "default",
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
  const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = parsed.documentElement;
  if (root.nodeName.toLowerCase() !== "svg") {
    return undefined;
  }

  root.style.backgroundColor = background;
  root.style.maxWidth = "none";

  const serialized = new XMLSerializer().serializeToString(root);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialized)}`;
}
