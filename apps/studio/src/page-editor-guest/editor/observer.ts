/**
 * The page watch: which of the page's elements its scripts touch, so static
 * markup (editable) is told apart from script output (routed to the agent).
 *
 * Installed by the preload in the guest's isolated world before the page's
 * own first script, so it sees every node the parser and the page's scripts
 * add. The editor bundle, evaluated later in the same world, reads it back
 * through `pageWatch()`.
 *
 * - An element a script added (it has no `data-src-id`: the host stamps those
 *   on every element in the source) taints its parent.
 * - A childList change that removes nodes, or any change once the parser has
 *   finished, taints its target.
 * - characterData changes after parsing taint the text node's parent.
 *
 * Taint also marks every ancestor as "tainted within", so a paragraph with a
 * script-updated count inside it is not editable either. A class attribute a
 * script sets after parsing marks the element "class touched": its look is
 * the script's, so style edits there go to the agent.
 */

export interface PageWatch {
  /** Set while the editor changes a class or attribute, so the change is not counted as a script's. */
  applying: boolean;
  /** Elements whose class attribute a script set after parsing. */
  classTouched: WeakSet<Node>;
  /** What the editor is changing itself, whose mutations are not the page's. */
  editing: Node | null;
  /** Commit the records queued so far before the editor reads the watch. */
  flush: () => void;
  isTainted: (el: Element) => boolean;
  /** Whether the parser has finished, after which every change is a script's. */
  parsed: boolean;
  taintSelf: WeakSet<Element>;
  taintWithin: WeakSet<Element>;
}

declare global {
  interface Window {
    __srcEdit?: PageWatch;
  }
}

export function installObserver(): PageWatch {
  const taintSelf = new WeakSet<Element>();
  const taintWithin = new WeakSet<Element>();
  const observer = new MutationObserver((list) => {
    handle(list);
  });
  const watch: PageWatch = {
    applying: false,
    classTouched: new WeakSet(),
    editing: null,
    flush: () => {
      handle(observer.takeRecords());
    },
    isTainted: (el) => taintSelf.has(el) || taintWithin.has(el),
    parsed: false,
    taintSelf,
    taintWithin,
  };
  window.__srcEdit = watch;

  function mark(node: Node) {
    const el = node instanceof Element ? node : node.parentElement;
    if (!el) {
      return;
    }
    taintSelf.add(el);
    for (let p = el.parentElement; p; p = p.parentElement) {
      if (taintWithin.has(p)) {
        break;
      }
      taintWithin.add(p);
    }
  }
  function ours(n: Node) {
    return n instanceof Element && n.hasAttribute("data-editor-guest");
  }
  function inEditor(n: Node) {
    return (
      watch.editing !== null &&
      (watch.editing === n || watch.editing.contains(n))
    );
  }

  function handle(list: MutationRecord[]) {
    for (const r of list) {
      if (inEditor(r.target)) {
        continue;
      }
      if (r.type === "attributes") {
        if (watch.parsed && !watch.applying && !ours(r.target)) {
          watch.classTouched.add(r.target);
        }
        continue;
      }
      if (r.type === "characterData") {
        if (watch.parsed) {
          mark(r.target);
        }
        continue;
      }
      const added = [...r.addedNodes].filter((n) => !ours(n));
      const removed = [...r.removedNodes].filter((n) => !ours(n));
      if (added.length === 0 && removed.length === 0) {
        continue;
      }
      // Anything a script built carries no source id; mark it and its parent.
      let scripted = removed.length > 0 || watch.parsed;
      for (const n of added) {
        if (n instanceof Element && !n.hasAttribute("data-src-id")) {
          scripted = true;
          mark(n);
        }
      }
      if (scripted) {
        mark(r.target);
      }
    }
  }

  observer.observe(document, {
    attributeFilter: ["class"],
    attributes: true,
    characterData: true,
    childList: true,
    subtree: true,
  });

  // The parser is done when readyState turns "interactive", before deferred
  // and module scripts run. Records queued until then describe parser
  // insertions.
  document.addEventListener("readystatechange", () => {
    if (document.readyState !== "interactive" || watch.parsed) {
      return;
    }
    handle(observer.takeRecords());
    watch.parsed = true;
  });

  return watch;
}

/** The watch the preload installed in this world, if it did. */
export function pageWatch(): PageWatch | undefined {
  return window.__srcEdit;
}
