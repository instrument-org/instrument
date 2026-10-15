import { rpcClient } from "@/client/rpc/client";
import { type OpenTarget } from "@/client/lib/open-target";
import { commandKeyHeld } from "@/client/lib/utils";
import { type Node as PMNode } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import {
  Decoration,
  DecorationSet,
  type EditorView,
} from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";

// Links in the Markdown editor. A plain click edits, as it does anywhere in
// the text; a Cmd-click (Ctrl off macOS) follows the link, and a middle click
// opens it in a tab of its own. A link written relative to the file names a
// file beside it and opens in the app's viewer; one that names nothing on
// disk is marked, so a renamed or deleted file shows where it was linked.

/** The middle button, which asks for a place of its own wherever a link is drawn. */
const MIDDLE_BUTTON = 1;

const brokenKey = new PluginKey<number>("broken-links");

/**
 * The path on this computer a link in the file names, or none for a web
 * address or a place in the file itself: a relative link is read against
 * the file's folder, as any Markdown app reads it.
 */
export function hostPathOfHref(
  href: string,
  folder: string,
): string | undefined {
  if (!href || href.startsWith("#") || href.startsWith("//")) {
    return undefined;
  }
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(href)?.[1]?.toLowerCase();
  // A Windows path's drive letter reads as a scheme of one letter.
  if (scheme && scheme !== "file" && scheme.length > 1) {
    return undefined;
  }
  try {
    const url =
      scheme === "file"
        ? new URL(href)
        : new URL(href, `file://${encodeURI(folder.replaceAll("\\", "/"))}`);
    return decodeURIComponent(url.pathname);
  } catch {
    return undefined;
  }
}

/** What a link names, as something the app can open: a file by its path, or a page. */
function targetOf(href: string, folder: string): OpenTarget {
  const path = hostPathOfHref(href, folder);
  return path === undefined
    ? { kind: "page", url: href }
    : { kind: "path", path };
}

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
      ...new Set(linkedPaths(v.state.doc, folder).map(({ path }) => path)),
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

  /** The link under a pointer event in the document, by its address. */
  const hrefAt = (event: Event) => {
    const target = event.target instanceof Element ? event.target : null;
    const anchor = target?.closest("a[href]");
    return anchor && root.contains(anchor) ? anchor.getAttribute("href") : null;
  };

  const follow = (href: string, newTab: boolean) => {
    if (href.startsWith("#")) {
      const id = decodeURIComponent(href.slice(1));
      root
        .querySelector(`[id="${CSS.escape(id)}"]`)
        ?.scrollIntoView({ block: "start" });
      return;
    }
    open(targetOf(href, folder), newTab);
  };

  return $prose(
    () =>
      new Plugin({
        key: brokenKey,
        props: {
          decorations(state) {
            const decos = linkedPaths(state.doc, folder)
              .filter(({ path }) => found.get(path) === false)
              .map(({ from, to }) =>
                Decoration.inline(from, to, { class: "md-link-broken" }),
              );
            return decos.length > 0
              ? DecorationSet.create(state.doc, decos)
              : null;
          },
          handleDOMEvents: {
            auxclick(_view, event) {
              const href = event.button === MIDDLE_BUTTON && hrefAt(event);
              if (!href) {
                return false;
              }
              event.preventDefault();
              follow(href, true);
              return true;
            },
            click(_view, event) {
              const href = commandKeyHeld(event) && hrefAt(event);
              if (!href) {
                return false;
              }
              event.preventDefault();
              follow(href, event.shiftKey);
              return true;
            },
            // Kept from starting a scroll or, on Linux, pasting the selection.
            mousedown(_view, event) {
              if (event.button === MIDDLE_BUTTON && hrefAt(event)) {
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
          schedule();
          return {
            destroy() {
              clearTimeout(checkTimer);
              window.removeEventListener("focus", onFocus);
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
  const out: { from: number; path: string; to: number }[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText) {
      return;
    }
    for (const mark of node.marks) {
      if (mark.type.name !== "link") {
        continue;
      }
      const path = hostPathOfHref(String(mark.attrs.href ?? ""), folder);
      if (path !== undefined) {
        out.push({ from: pos, path, to: pos + node.nodeSize });
      }
    }
  });
  return out;
}
