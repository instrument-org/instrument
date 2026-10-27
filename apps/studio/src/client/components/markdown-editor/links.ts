import { rpcClient } from "@/client/rpc/client";
import {
  getFaviconUrl,
  markIconlessThisSession,
} from "@/client/lib/favicon-url";
import {
  isWebPage,
  type OpenTarget,
  openTargetOfHref,
} from "@/client/lib/open-target";
import { commandKeyHeld } from "@/client/lib/utils";
import { type InstrumentLink, instrumentLinkOf } from "@instrument-org/shared";
import { type Mark, type Node as PMNode } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import {
  Decoration,
  DecorationSet,
  type EditorView,
} from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";

import { icon, type IconName, instrumentMark } from "./icons";

// Links in the Markdown editor. A plain click edits, as it does anywhere in
// the text; a Cmd-click (Ctrl off macOS) follows the link, and a middle click
// opens it in a tab of its own. A link written relative to the file names a
// file beside it and opens in the app's viewer; one that names nothing on
// disk is marked, so a renamed or deleted file shows where it was linked.
// A link into the app (`instrument://chat/…`) is drawn as the chip the
// app's other Markdown draws it as, its kind's glyph in front of its words,
// and a link to a web page with the site's icon in front, as there too.

/** The middle button, which asks for a place of its own wherever a link is drawn. */
const MIDDLE_BUTTON = 1;

const brokenKey = new PluginKey<number>("broken-links");

/** A web address on its own, as a paste over a selection makes a link of. */
const URL_ONLY = /^(?:https?:\/\/|mailto:)\S+$/i;

export function linksPlugin({
  folder,
  open,
  root,
}: {
  folder: string;
  /** Opens what a link names; `newTab` asks for a tab of its own. */
  open: (target: OpenTarget, newTab: boolean) => void;
  root: HTMLElement;
}) {
  // What each path a link names was last found to be: there or not.
  const found = new Map<string, boolean>();
  let checkTimer: ReturnType<typeof setTimeout> | undefined;
  let viewRef: EditorView | null = null;

  /** Looks up the paths the document links to, every one or only those not yet known. */
  const check = (all: boolean) => {
    const v = viewRef;
    if (!v) {
      return;
    }
    const paths = [
      ...new Set(
        linkedPaths(v.state.doc, folder).flatMap(({ places }) => places),
      ),
    ].filter((path) => all || !found.has(path));
    if (paths.length === 0) {
      return;
    }
    void rpcClient.files.missing.call({ paths }).then(
      ({ missing }) => {
        const gone = new Set(missing);
        let changed = false;
        for (const path of paths) {
          const there = !gone.has(path);
          changed ||= found.get(path) !== there;
          found.set(path, there);
        }
        if (changed && !v.isDestroyed) {
          v.dispatch(v.state.tr.setMeta(brokenKey, true));
        }
      },
      () => {
        // A look that failed leaves the links as they were drawn.
      },
    );
  };
  const schedule = () => {
    clearTimeout(checkTimer);
    checkTimer = setTimeout(() => {
      check(false);
    }, 300);
  };
  // Back from another app, where a file may have been renamed or made.
  const onFocus = () => {
    check(true);
  };

  /**
   * The link under a pointer event in the document, by its address as the
   * file has it. The anchor drawn for it carries an address only for the
   * schemes the editor deems safe, so an `instrument://` link reads as none.
   */
  const hrefAt = (view: EditorView, event: Event) => {
    const target = event.target instanceof Element ? event.target : null;
    const anchor = target?.closest("a");
    if (!anchor || !view.dom.contains(anchor)) {
      return null;
    }
    const link = view.state.doc
      .nodeAt(view.posAtDOM(anchor, 0))
      ?.marks.find((mark) => mark.type.name === "link");
    return link ? String(link.attrs.href ?? "") || null : null;
  };

  const follow = (href: string, newTab: boolean) => {
    if (href.startsWith("#")) {
      const id = decodeURIComponent(href.slice(1));
      root
        .querySelector(`[id="${CSS.escape(id)}"]`)
        ?.scrollIntoView({ block: "start" });
      return;
    }
    const there = placesOfHref(href, folder).find(
      (path) => found.get(path) === true,
    );
    const target =
      there === undefined
        ? openTargetOfHref(href, folder)
        : { kind: "path" as const, path: there };
    if (target) {
      open(target, newTab);
    }
  };

  // The link tooltip draws the address as a plain `target="_blank"` anchor
  // outside the document's view, which on its own would open a relative link
  // against the app's own page, and one whose scheme the editor deems unsafe
  // (`instrument://`) as that page itself. A click on it follows the link
  // here, by the address it shows, which is the one the file has.
  const onTooltipLink = (event: MouseEvent) => {
    if (event.type === "auxclick" && event.button !== MIDDLE_BUTTON) {
      return;
    }
    const target = event.target instanceof Element ? event.target : null;
    const anchor = target?.closest(".milkdown-link-preview a.link-display");
    if (!anchor) {
      return;
    }
    event.preventDefault();
    const href = anchor.textContent?.trim();
    if (href) {
      follow(href, event.type === "auxclick" || event.shiftKey);
    }
  };

  return $prose(
    () =>
      new Plugin({
        key: brokenKey,
        props: {
          decorations(state) {
            const decos = [
              ...linkedPaths(state.doc, folder)
                .filter(({ places }) =>
                  places.every((path) => found.get(path) === false),
                )
                .map(({ from, to }) =>
                  Decoration.inline(from, to, { class: "md-link-broken" }),
                ),
              ...linkRanges(state.doc).flatMap(({ from, href, mark, to }) => {
                const link = instrumentLinkOf(href);
                if (link) {
                  return [
                    Decoration.inline(from, to, { class: "md-app-chip" }),
                    Decoration.widget(from, () => appChipIcon(link), {
                      ignoreSelection: true,
                      key: `app-chip-${link.kind}-${link.name}`,
                      marks: [mark],
                      side: -1,
                    }),
                  ];
                }
                if (!isWebPage(href)) {
                  return [];
                }
                const favicon = getFaviconUrl(href);
                return [
                  Decoration.widget(from, () => siteIcon(href, favicon), {
                    ignoreSelection: true,
                    key: `site-icon-${favicon}`,
                    marks: [mark],
                    side: -1,
                  }),
                ];
              }),
            ];
            return decos.length > 0
              ? DecorationSet.create(state.doc, decos)
              : null;
          },
          handleDOMEvents: {
            auxclick(view, event) {
              const href =
                event.button === MIDDLE_BUTTON && hrefAt(view, event);
              if (!href) {
                return false;
              }
              event.preventDefault();
              follow(href, true);
              return true;
            },
            click(view, event) {
              const href = commandKeyHeld(event) && hrefAt(view, event);
              if (!href) {
                return false;
              }
              event.preventDefault();
              follow(href, event.shiftKey);
              return true;
            },
            // Kept from starting a scroll or, on Linux, pasting the selection.
            mousedown(view, event) {
              if (event.button === MIDDLE_BUTTON && hrefAt(view, event)) {
                event.preventDefault();
              }
              return false;
            },
            paste(view, event) {
              const { empty, from, to, $from } = view.state.selection;
              const link = view.state.schema.marks.link;
              const text = event.clipboardData?.getData("text/plain").trim();
              if (
                empty ||
                !link ||
                !text ||
                !URL_ONLY.test(text) ||
                $from.parent.type.spec.code ||
                (event.clipboardData?.files.length ?? 0) > 0
              ) {
                return false;
              }
              event.preventDefault();
              view.dispatch(
                view.state.tr.addMark(from, to, link.create({ href: text })),
              );
              return true;
            },
          },
        },
        view(v) {
          viewRef = v;
          window.addEventListener("focus", onFocus);
          root.addEventListener("click", onTooltipLink, true);
          root.addEventListener("auxclick", onTooltipLink, true);
          schedule();
          return {
            destroy() {
              clearTimeout(checkTimer);
              window.removeEventListener("focus", onFocus);
              root.removeEventListener("click", onTooltipLink, true);
              root.removeEventListener("auxclick", onTooltipLink, true);
              viewRef = null;
            },
            update(next, prev) {
              if (next.state.doc !== prev.doc) {
                schedule();
              }
            },
          };
        },
      }),
  );
}

/** Every stretch of linked text in `doc` that names a path on this computer, with the path. */
function linkedPaths(doc: PMNode, folder: string) {
  const out: { from: number; places: string[]; to: number }[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText) {
      return;
    }
    for (const mark of node.marks) {
      if (mark.type.name !== "link") {
        continue;
      }
      const places = placesOfHref(String(mark.attrs.href ?? ""), folder);
      if (places.length > 0) {
        out.push({ from: pos, places, to: pos + node.nodeSize });
      }
    }
  });
  return out;
}

/**
 * The paths on this computer a link from `folder` may name, the likeliest
 * first. A link starting with one `/` is rooted wherever its author's tool
 * roots it: at the disk, or at a folder above the file, as GitHub reads
 * `/docs/a.md` from the repository's top and a notes app from its vault's.
 * So it names the disk's path first, then the same path under each folder
 * above the file, nearest first.
 */
function placesOfHref(href: string, folder: string): string[] {
  const target = openTargetOfHref(href, folder);
  if (target?.kind !== "path") {
    return [];
  }
  if (!/^\/(?!\/)/.test(href)) {
    return [target.path];
  }
  let rooted: string;
  try {
    rooted = decodeURIComponent(new URL(href, "file:///").pathname);
  } catch {
    return [target.path];
  }
  const separator = folder.includes("\\") ? "\\" : "/";
  const parts = folder.split(/[\\/]/);
  const places = [target.path];
  for (let end = parts.length; end > 0; end--) {
    const above = parts.slice(0, end).join(separator);
    if (above) {
      places.push(`${above}${rooted.replaceAll("/", separator)}`);
    }
  }
  return [...new Set(places)];
}

/** Every link in `doc`, by its address and the stretch of text it covers. */
function linkRanges(doc: PMNode) {
  const out: { from: number; href: string; mark: Mark; to: number }[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText) {
      return;
    }
    const mark = node.marks.find((m) => m.type.name === "link");
    if (!mark) {
      return;
    }
    // A link whose words are partly bold is several text nodes under one mark.
    const last = out.at(-1);
    if (last?.to === pos && last.mark.eq(mark)) {
      last.to = pos + node.nodeSize;
      return;
    }
    const href = String(mark.attrs.href ?? "");
    out.push({ from: pos, href, mark, to: pos + node.nodeSize });
  });
  return out;
}

/**
 * A site's icon at the front of a link to it, drawn once it has loaded, so a
 * site with none, or one still being looked up, leaves no gap in the line.
 */
function siteIcon(href: string, src: string) {
  const img = document.createElement("img");
  img.className = "md-site-icon";
  img.alt = "";
  img.draggable = false;
  img.hidden = true;
  img.addEventListener("load", () => {
    img.hidden = false;
  });
  img.addEventListener("error", () => {
    markIconlessThisSession(href);
  });
  img.src = src;
  return img;
}

/** The glyph for each kind of thing a link into the app names, as the viewer's chips draw them. */
const APP_CHIP_ICONS: Record<
  Exclude<InstrumentLink["kind"], "task">,
  IconName
> = {
  app: "appWindow",
  chat: "chatTeardropText",
  memory: "fingerprint",
  screen: "appWindow",
  settings: "fadersHorizontal",
  skill: "cube",
};

/** The glyph at the front of a link into the app; a task wears the app's own mark. */
function appChipIcon(link: InstrumentLink) {
  const dom = document.createElement("span");
  dom.className = `md-app-chip-icon${link.kind === "task" ? " is-task" : ""}`;
  dom.contentEditable = "false";
  dom.innerHTML =
    link.kind === "task"
      ? instrumentMark(12)
      : icon(
          link.kind === "screen" && link.name === "shortcuts"
            ? "keyboard"
            : APP_CHIP_ICONS[link.kind],
          12,
        );
  return dom;
}
