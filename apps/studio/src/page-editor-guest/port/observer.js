// Runs in the guest's isolated world from the preload, before the page's own
// first script, so it sees every node the parser and the page's scripts add.
//
// It records which elements scripts touch, so the host can tell static markup
// (editable) from script output (routed to the agent):
// - an element a script added (it has no data-src-id: the host stamps those on
//   every element in the source) taints its parent;
// - a childList change that removes nodes, or any change once the parser has
//   finished, taints its target;
// - characterData changes after parsing taint the text node's parent.
// Taint also marks every ancestor as "tainted within", so a paragraph with a
// script-updated count inside it is not editable either. A class attribute a
// script sets after parsing marks the element "class touched": its look is the
// script's, so style edits there go to the agent.
export function installObserver() {
  const G = {
    taintSelf: new WeakSet(),
    taintWithin: new WeakSet(),
    classTouched: new WeakSet(),
    editing: null,
    applying: false,
    parsed: false,
    records: 0,
    isTainted: (el) => G.taintSelf.has(el) || G.taintWithin.has(el),
    flush: () => handle(observer.takeRecords()),
  };
  window.__srcEdit = G;

  const mark = (node) => {
    const el = node.nodeType === 1 ? node : node.parentElement;
    if (!el) return;
    G.taintSelf.add(el);
    for (let p = el.parentElement; p; p = p.parentElement) {
      if (G.taintWithin.has(p)) break;
      G.taintWithin.add(p);
    }
  };
  const ours = (n) => n.nodeType === 1 && n.hasAttribute("data-editor-guest");
  const inEditor = (n) =>
    G.editing && (G.editing === n || G.editing.contains(n));

  function handle(list) {
    for (const r of list) {
      if (inEditor(r.target)) continue;
      G.records++;
      if (r.type === "attributes") {
        if (G.parsed && !G.applying && !ours(r.target))
          G.classTouched.add(r.target);
        continue;
      }
      if (r.type === "characterData") {
        if (G.parsed) mark(r.target);
        continue;
      }
      const added = [...r.addedNodes].filter((n) => !ours(n));
      const removed = [...r.removedNodes].filter((n) => !ours(n));
      if (!added.length && !removed.length) continue;
      // Anything a script built carries no source id; mark it and its parent.
      let scripted = removed.length > 0 || G.parsed;
      for (const n of added) {
        if (n.nodeType === 1 && !n.hasAttribute("data-src-id")) {
          scripted = true;
          mark(n);
        }
      }
      if (scripted) mark(r.target);
    }
  }

  const observer = new MutationObserver(handle);
  observer.observe(document, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["class"],
  });

  // The parser is done when readyState turns "interactive", before deferred and
  // module scripts run. Records queued until then describe parser insertions.
  document.addEventListener("readystatechange", () => {
    if (document.readyState !== "interactive" || G.parsed) return;
    handle(observer.takeRecords());
    G.parsed = true;
  });

  return G;
}
