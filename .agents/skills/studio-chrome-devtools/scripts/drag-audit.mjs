// Find the controls a press cannot reach because the window takes it as a
// move: a button, link or field whose middle lies in the window's drag area.
//
//   node studio-drive.mjs run <this file>                         # the screen up now
//   node studio-drive.mjs run <this file> --args '{"setup":true}' # each setup step from here on, answering each
//
// The drag area is worked out the way Electron does: every box whose computed
// app-region is `drag` or `no-drag`, in document order, each `drag` added and
// each `no-drag` taken away, at its full box. What lies on top, `inert`,
// `pointer-events` and clipping play no part, so a drag area mounted under a
// screen drawn over it (setup over the app window) still takes the press.
// Nothing about this shows in a screenshot or to `click`, which dispatches
// past it, so only a pass like this one finds it.
//
// A control under something else at its middle is left out: a press would not
// reach it either way, and that is `click`'s finding to make.

const AUDIT = `(() => {
  const regions = [];
  for (const element of document.querySelectorAll("*")) {
    const style = getComputedStyle(element);
    const value = style.getPropertyValue("app-region") || style.getPropertyValue("-webkit-app-region");
    if (value !== "drag" && value !== "no-drag") continue;
    const box = element.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) continue;
    const classes = typeof element.className === "string" ? element.className.trim().split(/\\s+/).slice(0, 4).join(".") : "";
    regions.push({ box, drags: value === "drag", name: element.tagName.toLowerCase() + (element.id ? "#" + element.id : "") + (classes ? "." + classes : ""), inert: element.closest("[inert]") !== null });
  }
  const dragAt = (x, y) => {
    let by = null;
    for (const region of regions) {
      const { box } = region;
      if (x >= box.left && x < box.right && y >= box.top && y < box.bottom) by = region.drags ? region : null;
    }
    return by;
  };
  const blocked = [];
  for (const control of document.querySelectorAll('button, a[href], input, textarea, select, [role=button], [role=tab], [role=menuitem], [contenteditable=true]')) {
    if (control.closest("[inert]")) continue;
    const box = control.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) continue;
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    const top = document.elementFromPoint(x, y);
    if (top && !control.contains(top) && !top.contains(control)) continue;
    const by = dragAt(x, y);
    if (by) blocked.push({ control: (control.getAttribute("aria-label") || control.innerText || control.tagName).trim().replaceAll(/\\s+/g, " ").slice(0, 60), at: [Math.round(x), Math.round(y)], dragArea: by.name.slice(0, 160), dragAreaInert: by.inert });
  }
  return blocked;
})()`;

const SETUP_STEP =
  '(async () => { const it = await window.__studioDebug.rpc("setup.live.state"); const { value } = await it.next(); await it.return?.(); return value?.step ?? null; })()';

/** The controls on screen now that sit in the window's drag area; none is the answer wanted. */
export function blockedByWindowDrag(app) {
  return app.eval(AUDIT);
}

export default async (app, args = {}) => {
  if (!args.setup) {
    const blocked = await blockedByWindowDrag(app);
    return { clean: blocked.length === 0, blocked };
  }
  const steps = [];
  for (;;) {
    const step = await app.eval(SETUP_STEP);
    // Past a page's slide in, so its footer is where it stays, or past
    // setup's fade out once it is done.
    await app.waitFor(
      step === null
        ? 'document.querySelector("[data-testid=setup]") === null'
        : '!document.querySelector("[data-page-motion]") && document.querySelector("[data-setup-footer]") !== null',
    );
    steps.push({ step, blocked: await blockedByWindowDrag(app) });
    if (step === null) {
      break;
    }
    await app.rpc("setup.answer", { step });
    await app.waitFor(`(${SETUP_STEP}).then((now) => now !== ${JSON.stringify(step)})`);
  }
  return {
    clean: steps.every(({ blocked }) => blocked.length === 0),
    steps,
  };
};
