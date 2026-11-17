// Snapshots: frames drawn from Studio as it runs, not redrawn. snap/capture.mjs keeps
// the app's own page in each state a round may start from, and snap() draws a frame
// from one through the wireframe skill's snapshot frames ("Frames from a snapshot" in
// its SKILL.md and patterns.md): the snapshot in an iframe at true size, edited by name.
// Edits mark nothing; .note() and .fresh() mark what to look at. build.mjs puts the library
// states a part names, and the skill's frames script, into the page. SNAPSHOTS.md is
// how to use it; snap/library.mjs writes the library's INDEX.md.

// The skill's snap(), taken as the kit loads: in a page built from a part of frames this
// file's snap() then takes its global name.
const skillSnap = typeof window === "undefined" ? undefined : window.snap;

/**
 * A frame from the library state `state` (INDEX.md lists them; `<name>.dark` for dark),
 * edited by `edit($)` as the skill's snap() does, with the window's lights drawn over
 * it, since macOS draws them over the web contents and a capture has none. In Node,
 * where build.mjs checks a part, it only names the state for the build to add.
 * @param {string} state
 * @param {(($: any) => void)} [edit]
 */
function snap(state, edit) {
  if (typeof __snapHost !== "undefined") {
    const s = __snapHost.use(state);
    return `<div class="snap" data-snap="${state}" style="width:${s.w}px;height:${s.h}px"></div>`;
  }
  const lights = `<div aria-hidden="true" style="position:absolute;left:0;top:0;height:40px;display:flex;align-items:center;pointer-events:none;z-index:2">${trafficLights}</div>`;
  return skillSnap(state, edit).replace(/<\/div>$/, `${lights}</div>`);
}
/** A state's size, for a frame's `w` and `h`: `{ ...snap.size("chat"), body: snap("chat") }`. */
snap.size = (/** @type {string} */ state) => {
  const s = typeof __snapHost !== "undefined" ? __snapHost.use(state) : skillSnap.size(state);
  return { w: s.w, h: s.h };
};
