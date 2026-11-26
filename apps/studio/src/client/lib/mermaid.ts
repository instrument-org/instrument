// Mermaid diagrams are drawn by pele, with DOMPurify checking what it draws.
// Nothing here imports either statically: `loadRenderer` is the only door, and
// it is opened by markdown that actually carries a mermaid fence. Keep it that
// way — a static import anywhere on a startup path drags both into the
// renderer's entry chunk. (`import type` is erased at build time, so the types
// below cost nothing.)
import type { Config } from "dompurify";
import type { renderToString } from "katex";
import type * as Pele from "pele/lazy";

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

/** Pele's options for every diagram the app draws. */
const MOUNT_OPTIONS = {
  // Turns a left-to-right flowchart too wide for its column vertical, where
  // scaling it down to fit would shrink its labels past reading. Pele does
  // that only in a column narrower than the breakpoint; one past the widest
  // chat column makes every chat column one.
  autoDirection: true,
  directionBreakpoint: 800,
  // The toolbar's Open diagram is how a large one is read, so pele's own pan
  // and zoom controls stay off.
  zoom: false,
} satisfies Pele.MountOptions;

// Diagram source arrives from a model, so it is untrusted input. Pele escapes
// labels and filters links itself, and DOMPurify still checks everything it
// draws before it reaches the page. A `click X "https://..."` stays a real
// anchor; where such a link is allowed to go is the window's business, not
// this module's — see `guardNavigation`. `foreignObject` is where pele puts a
// typeset `$$` label, whose MathML is checked as HTML.
const SANITIZE_CONFIG = {
  ADD_TAGS: ["foreignObject"],
  HTML_INTEGRATION_POINTS: { foreignobject: true },
  RETURN_DOM_FRAGMENT: true,
} satisfies Config;

type Renderer = { pele: typeof Pele; sanitize: (svg: string) => Node };

let rendererPromise: Promise<Renderer> | undefined;

function loadRenderer(): Promise<Renderer> {
  // Only a *resolved* import may be cached. Caching the rejection too would
  // mean one dropped chunk fetch left every fence in the session as a code
  // block, with nothing able to try again short of restarting the app. Pele
  // drops a failed diagram-type chunk from its own cache the same way.
  rendererPromise ??= Promise.all([import("pele/lazy"), import("dompurify")])
    .then(([pele, { default: purify }]) => ({
      pele,
      sanitize: (svg: string) => purify.sanitize(svg, SANITIZE_CONFIG),
    }))
    .catch((error: unknown) => {
      rendererPromise = undefined;
      throw error;
    });
  return rendererPromise;
}

/**
 * Starts fetching the renderer without waiting for it. Called as soon as a
 * fence is spotted in streaming markdown, so the download overlaps the rest of
 * the diagram arriving instead of following it.
 */
export function prefetchMermaid(): void {
  void loadRenderer().catch(() => {
    // Nothing is waiting on this one. The next render attempt starts the fetch
    // again, and that is the call that has a diagram to answer for.
  });
}

let mathPromise: Promise<Pele.MathResolver> | undefined;

function loadMath(): Promise<Pele.MathResolver> {
  mathPromise ??= import("katex")
    .then(({ default: katex }) => {
      // Pele asks again on every layout, a resize included.
      const typeset = new Map<string, Pele.MathMarkup | null>();
      return (tex: string, size: number) => {
        const key = `${size}:${tex}`;
        if (!typeset.has(key)) {
          typeset.set(key, typesetLabel(katex.renderToString, tex, size));
        }
        return typeset.get(key);
      };
    })
    .catch((error: unknown) => {
      mathPromise = undefined;
      throw error;
    });
  return mathPromise;
}

/**
 * A `$$` label, typeset by the KaTeX messages already use for math, or `null`
 * for TeX it cannot read, which pele then shows as written.
 *
 * MathML rather than KaTeX's HTML, because MathML needs no stylesheet: the
 * label ends up inside an SVG, and the large panel shows that SVG in an `img`,
 * where none of the page's CSS reaches. Measured in a probe on the body, which
 * sits outside the app's zoom, so the size is in the same units pele lays out
 * in.
 */
function typesetLabel(
  typeset: typeof renderToString,
  tex: string,
  size: number,
): Pele.MathMarkup | null {
  const probe = document.createElement("div");
  probe.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;font-size:${size}px`;
  try {
    probe.innerHTML = typeset(tex, {
      displayMode: true,
      output: "mathml",
      throwOnError: true,
    });
    document.body.append(probe);
    const math = probe.querySelector("math");
    if (!math) {
      return null;
    }
    // The TeX source again, which reads as a second copy of the label.
    math.querySelector("annotation")?.remove();
    const { height, width } = math.getBoundingClientRect();
    return { height, html: math.outerHTML, width };
  } catch {
    return null;
  } finally {
    probe.remove();
  }
}

/** Draws a diagram into an element; see `loadDiagram`. */
export type DrawDiagram = (
  host: HTMLElement,
  callbacks: Pick<Pele.MountOptions, "onError" | "onRender">,
) => Pele.Mounted;

/**
 * Loads what drawing `source` takes (pele, the chunk for its diagram type, and
 * KaTeX when a label has `$$` math) and resolves a function that draws it, or
 * `undefined` when the source does not parse. Rejects when a chunk fails to
 * load.
 *
 * Half-written input is the normal case, not the exception: assistant markdown
 * streams a token at a time, so a graph is unparsable for most of the time it
 * is on screen. The parse is therefore a gate rather than an error path. Pele
 * draws its own red error, in its parser's terms, into an element it is handed
 * source it cannot read; checking first is what lets the caller hold whatever
 * it is already showing instead.
 */
export async function loadDiagram(
  source: string,
): Promise<DrawDiagram | undefined> {
  const [{ pele, sanitize }, math] = await Promise.all([
    loadRenderer(),
    source.includes("$$") ? loadMath() : undefined,
  ]);

  let type: null | Pele.DiagramType = null;
  try {
    type = pele.detectType(source);
  } catch {
    // Unreadable front matter or directives, which the parse below reports.
  }
  // Fetches the one chunk that parses and lays out this diagram type.
  await pele.load(type);

  try {
    // Pele parses again to draw. A parse is cheap next to the layout, and
    // drawing straight away would put its error on screen.
    pele.parse(source);
  } catch {
    return undefined;
  }

  return (host, callbacks) =>
    pele.mount(host, source, {
      ...MOUNT_OPTIONS,
      ...callbacks,
      ...(math && { math }),
      sanitize,
    });
}

// Every variable pele colors and sets a diagram's type from.
const PELE_VARIABLES = [
  "--pele-bg",
  "--pele-fg",
  "--pele-muted",
  "--pele-line",
  "--pele-surface",
  "--pele-surface-alt",
  "--pele-border",
  "--pele-accent",
  "--pele-critical",
  "--pele-font",
  "--pele-font-mono",
  ...Array.from({ length: 8 }, (_, index) => `--pele-series-${index + 1}`),
];

/**
 * Packs a drawn diagram into a data URL for the file-preview modal, which shows
 * it in an `<img>`.
 *
 * An `<img>` carries none of the page's CSS, and pele draws from CSS
 * variables, so a dark-theme diagram would arrive in pele's own light palette
 * on nothing. The values in effect where the diagram is drawn go onto the copy
 * instead, with the surface as its background, and the width cap that fitted
 * it to the chat column comes off, since the modal has the whole window to
 * spend.
 */
export function toDiagramImageUrl(svg: SVGSVGElement): string | undefined {
  const styles = globalThis.getComputedStyle(svg);
  const image = svg.cloneNode(true);
  if (!(image instanceof SVGSVGElement)) {
    return undefined;
  }

  for (const name of PELE_VARIABLES) {
    const value = styles.getPropertyValue(name).trim();
    if (value) {
      image.style.setProperty(name, value);
    }
  }
  image.style.backgroundColor = "var(--pele-bg)";
  image.style.maxWidth = "none";

  const serialized = new XMLSerializer().serializeToString(image);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialized)}`;
}
