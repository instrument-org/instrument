// Pieces in Studio's look for what rounds kept redrawing by hand: the window with its slots
// moved or swapped, the chat's cards, and the reply box with what proposals add. They load
// after the skill's neutral pieces (box, bar, chip, pill, crop) and replace its win, card
// and composer. Each takes what goes inside it first and its options second; a part may
// define a piece of the same name, and its own wins. Only a part of frames loads this
// file: a JS part pastes the kit into one scope, where these names would collide.

/**
 * The window as appWindow draws it, with every slot open: `bar` on the ground over it
 * (winBar() unless given, "" for none), `side` in place of the rail (the rail lit at `on`
 * unless given, "" for none), `top` across the card over `children`, and `over` on a
 * layer over everything. `win(body, opts)` or `win({ body, ...opts })`.
 */
const win = (children, opts = {}) => {
  const o = typeof children === "object" && children !== null ? children : { ...opts, body: children };
  const { bar = winBar(), on = "chat", side, top = "", over = "", dark = false, railMark = {}, railExtra = [], user = false } = o;
  const body = o.body ?? inboxCol({ on: -1 }) + noChatOpen();
  return `
  <div class="relative flex h-full flex-col overflow-hidden ${GROUND} text-foreground ${dark ? "[color-scheme:dark]" : "[color-scheme:light]"}">
    ${bar}
    <div class="flex min-h-0 flex-1 ${bar ? "" : "pt-2"}">
      ${side ?? rail(on, { mark: railMark, user, extra: railExtra })}
      <div class="relative mr-2 mb-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-[10px] ${side === "" ? "ml-2" : ""} ${PANE} bg-background shadow-xs">${top}<div class="relative flex min-h-0 flex-1">${body}</div></div>
    </div>
    ${over}
  </div>`;
};

/**
 * A card as the chat draws its own (the permission and question cards): `title` and an
 * `icon` head it with `end` at the head's right, a `line` under the title, `children`
 * under that and `foot` for its buttons. `w` in pixels; `tint` for a card at work.
 */
const card = (children = "", { title = "", line = "", icon = "", end = "", foot = "", w, tint = false, cls = "" } = {}) =>
  `<div class="rounded-2xl border border-border ${tint ? "bg-brand-50/60" : "bg-card"} p-3 shadow-xs ${cls}"${w ? ` style="width:${w}px"` : ""}>${
    title || end
      ? `<div class="flex items-start justify-between gap-3"><p class="flex min-w-0 items-center gap-2 text-sm font-medium">${icon ? `<i class="ph ph-${icon} text-[16px] text-muted-foreground"></i>` : ""}<span class="truncate">${title}</span></p>${end}</div>`
      : ""
  }${line ? `<p class="mt-1 text-xs leading-5 text-muted-foreground">${line}</p>` : ""}${children ? `<div class="${title || line ? "mt-2.5" : ""}">${children}</div>` : ""}${foot ? `<div class="mt-3 flex items-center gap-2">${foot}</div>` : ""}</div>`;

/**
 * The reply box (replyBox) with what proposals add: `text` typed, with the caret when
 * `focus`, or `ph` waiting; `chips` over the words; `above` inside the box over them (a
 * note, a suggestion row); `start` in place of the plus and `end` in place of the mic and
 * arrow; `working` swaps the arrow for stop. `w` in pixels.
 */
const composer = ({ text = "", ph = "Talk to Instrument", chips = "", above = "", start = plusButton, end, working = false, focus = false, w, cls = "" } = {}) => {
  const stop = `<span class="grid size-7 shrink-0 place-items-center text-foreground/55"><i class="ph ph-microphone text-[16px]"></i></span><span class="grid size-7 shrink-0 place-items-center rounded-full bg-foreground"><span class="size-2.5 rounded-[2px] bg-background"></span></span>`;
  const caret = focus ? `<span class="inline-block h-4 w-px translate-y-0.5 bg-foreground"></span>` : "";
  return `<div class="flex flex-col rounded-[22px] bg-[light-dark(#ffffff,#262624)] p-1.5 shadow-sm ${focus ? "ring-1 ring-foreground/15" : ""} ${cls}"${w ? ` style="width:${w}px"` : ""}>
    ${above ? `<div class="px-2 pt-1 pb-1.5">${above}</div>` : ""}
    ${chips ? `<div class="flex flex-wrap items-center gap-1 px-1 pb-1.5">${chips}</div>` : ""}
    <div class="flex items-center gap-2">${start}<span class="min-w-0 flex-1 truncate text-[13px] ${text ? "" : "text-gray-400"}">${text}${caret}${text ? "" : ph}</span>${end ?? (working ? stop : replyEnds)}</div>
  </div>`;
};
