/**
 * When the page's styles have caught up with a class or theme change. The
 * page compiles its Tailwind in the browser (`@tailwindcss/browser`): it
 * watches the document's classes and its `text/tailwindcss` blocks, and on a
 * class it has not seen or a changed theme it rewrites the one `<style>` it
 * appended to <head>, in a single step that reads the classes it compiles at
 * the same moment. So a write to that sheet after a change is the change
 * compiled, and a class whose rule is already generated needs no write.
 */

/** How long a change waits for the page's compiler, should it never write (no script, an unknown class). */
const RESTYLE_CAP_MS = 3000;

/** The page's compiled floor, which ships with the file and never runs the compiler. */
const FLOOR = 'style[data-tailwind="compiled"]';

/** A `<style>` the page's compiler writes: not the editor's own, the floor, or a source block it reads. */
function isGenerated(node: Node) {
  const el = node instanceof Text ? node.parentElement : node;
  return (
    el instanceof HTMLStyleElement &&
    !el.hasAttribute("data-editor-guest") &&
    !el.matches(FLOOR) &&
    el.getAttribute("type") !== "text/tailwindcss"
  );
}

/** The text of the rule for exactly `selector`, searching nested rules too. */
function findRule(list: CSSRuleList, selector: string): null | string {
  for (const r of list) {
    if (r instanceof CSSStyleRule && r.selectorText === selector) {
      return r.cssText;
    }
    if (r instanceof CSSGroupingRule || r instanceof CSSStyleRule) {
      const f = findRule(r.cssRules, selector);
      if (f) {
        return f;
      }
    }
  }
  return null;
}

/** The rule the page generated for class `c`, outside its compiled floor. */
export function generatedRule(c: string): null | string {
  const selector = `.${CSS.escape(c)}`;
  for (const sheet of document.styleSheets) {
    const owner = sheet.ownerNode;
    if (owner instanceof Element && owner.matches(FLOOR)) {
      continue;
    }
    let hit = null;
    try {
      hit = findRule(sheet.cssRules, selector);
    } catch {
      // A cross-origin sheet's rules cannot be read.
    }
    if (hit) {
      return hit;
    }
  }
  return null;
}

/** Calls `fn` on each write to a sheet the page's compiler writes; returns the stop. */
export function onRestyle(fn: () => void): () => void {
  const mo = new MutationObserver((records) => {
    if (records.some((r) => isGenerated(r.target))) {
      fn();
    }
  });
  mo.observe(document.head, {
    characterData: true,
    childList: true,
    subtree: true,
  });
  return () => {
    mo.disconnect();
  };
}

/**
 * `done()` once the classes `added` (already on the page) are compiled: at
 * once when it already holds or every one has a generated rule, otherwise at
 * the compiler's next write, or at `cap` should none come.
 */
export function untilRestyled(
  added: string[],
  done: () => boolean,
  cap = RESTYLE_CAP_MS,
): Promise<boolean> {
  if (done() || added.every((c) => generatedRule(c) !== null)) {
    return Promise.resolve(done());
  }
  return new Promise((resolve) => {
    const finish = () => {
      stop();
      clearTimeout(timer);
      resolve(done());
    };
    const stop = onRestyle(finish);
    const timer = setTimeout(finish, cap);
  });
}
