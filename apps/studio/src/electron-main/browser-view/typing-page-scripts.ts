// The scripts focus-free typing runs inside a guest page, kept free of imports
// so a real-browser test can run them against a real DOM.

/**
 * Runs in the guest's main frame, in the typing world: finds where typing goes
 * (through open shadow roots and same-origin frames) and, when it can be
 * carried there, starts listening on that document's window for what the
 * caller is about to send. Answers "frame" when focus is in a cross-origin
 * frame, whose document this world cannot reach; "none" when text has no field
 * to go into; "armed" once listening.
 *
 * Called as `(mode, last, grace, limit)`: `mode` is "text" or "key", `last` the
 * key's last DOM event (`lastKeyEvent`), `grace` how long a keydown waits for
 * the keypress it may bring, `limit` how long `handled()` waits at most. Armed,
 * it leaves `globalThis.__instrumentTyping` with `seen()` (the trusted events
 * fired since, and stops listening), `handled()` (resolves with the event that
 * ended the key, or "timeout") and `stop()`.
 */
export const ARM_SOURCE = `(mode, last, grace, limit) => {
  const TEXT_TYPES = ["", "email", "number", "password", "search", "tel", "text", "url"];
  let doc = document;
  let el = doc.activeElement;
  for (;;) {
    while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
    if (!el || (el.localName !== "iframe" && el.localName !== "frame")) break;
    let inner = null;
    try { inner = el.contentDocument; } catch {}
    if (!inner) return "frame";
    doc = inner;
    el = inner.activeElement;
  }
  const field = !!el && (el.isContentEditable ||
    ((el.localName === "textarea" || (el.localName === "input" && TEXT_TYPES.includes(el.type))) && !el.readOnly && !el.disabled));
  if (mode === "text" && !field) return "none";
  const win = doc.defaultView;
  if (globalThis.__instrumentTyping) globalThis.__instrumentTyping.stop();
  const types = mode === "text" ? ["beforeinput", "input"] : ["keydown", "keypress", "keyup"];
  let seen = 0;
  let settle;
  let timer;
  const handled = new Promise((resolve) => { settle = resolve; });
  const finish = (how) => {
    clearTimeout(timer);
    // Answered after the task the event is in, so its default action has run.
    setTimeout(() => settle(how), 0);
  };
  const on = (event) => {
    if (!event.isTrusted) return;
    seen += 1;
    if (mode !== "key") return;
    if (event.type === last) finish(event.type);
    else if (event.type === "keydown" && last === "keypress") {
      clearTimeout(timer);
      timer = setTimeout(() => finish("keydown"), grace);
    }
  };
  for (const type of types) win.addEventListener(type, on, true);
  const stop = () => {
    clearTimeout(timer);
    for (const type of types) win.removeEventListener(type, on, true);
    if (globalThis.__instrumentTyping === state) globalThis.__instrumentTyping = undefined;
  };
  const state = {
    stop,
    seen: () => { stop(); return seen; },
    handled: () => {
      timer = setTimeout(() => finish("timeout"), limit);
      return handled.then((how) => { stop(); return how; });
    },
  };
  globalThis.__instrumentTyping = state;
  return "armed";
}`;

/**
 * The page's main world, run through the debugger: the owner element of the
 * cross-origin frame focus is in, reached the way the arm check walks, or null
 * when focus is not in one.
 */
export const FOCUSED_FRAME_OWNER = `(() => {
  let el = document.activeElement;
  for (;;) {
    while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
    if (!el || (el.localName !== "iframe" && el.localName !== "frame")) return null;
    let inner = null;
    try { inner = el.contentDocument; } catch {}
    if (!inner) return el;
    el = inner.activeElement;
  }
})()`;
