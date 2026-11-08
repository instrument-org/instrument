// ---- overlays ---------------------------------------------------------------------
// What draws over the window: menus, popovers, tooltips, dialogs and sheets, toasts, the
// command menu, the bell's list and a status pill's card. Pass them as appWindow's
// `over`, placed in the window's pixels (`left`, `top`). Measured 2026-10-31; the bell's
// list re-measured 2026-11-07.

/**
 * A menu (ui/dropdown-menu.tsx and ui/context-menu.tsx): 12px corners, 4px in, rows of
 * 14px words. `items` are "rule" for a divider, `[icon, label, keys]` as before, or
 * `{ label, icon, keys, head, dot, check, sub, danger, on, muted }`: `head` a small label
 * over a group, `dot` the radio's dot (sort orders), `check` a check, `sub` a caret for
 * a submenu, `danger` the destructive red, `on` the row under the pointer. `icon` is
 * HTML or a Phosphor name.
 */
const menu = (items, { left, top, w = 240 } = {}) => {
  const ico = (i) => (!i ? "" : i.startsWith("<") ? i : `<i class="ph ph-${i} text-[16px] text-muted-foreground"></i>`);
  const rowHtml = (it) => {
    if (it === "rule") return `<div class="-mx-1 my-1 h-px bg-border"></div>`;
    const o = Array.isArray(it) ? { icon: it[0], label: it[1], keys: it[2] } : it;
    if (o.head) return `<div class="px-3 pt-1.5 pb-1 text-[12px] text-muted-foreground">${o.head}</div>`;
    const lead = o.dot !== undefined ? `<span class="grid w-3 place-items-center">${o.dot ? `<span class="size-1.5 rounded-full bg-foreground"></span>` : ""}</span>` : o.check !== undefined ? `<span class="grid w-4 place-items-center">${o.check ? `<i class="ph ph-check text-[14px]"></i>` : ""}</span>` : ico(o.icon);
    return `<div class="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm ${o.on ? "bg-accent" : ""} ${o.danger ? "text-destructive" : o.muted ? "text-muted-foreground" : "text-foreground"}">${lead}<span class="min-w-0 flex-1 truncate">${o.label}</span>${o.keys ? `<span class="text-[12px] tracking-widest text-muted-foreground">${o.keys}</span>` : ""}${o.sub ? `<i class="ph ph-caret-right text-[12px] text-muted-foreground"></i>` : ""}</div>`;
  };
  return `<div class="absolute z-50 rounded-xl bg-popover p-1 text-popover-foreground shadow-xl ring-1 ring-black/8" style="left:${left}px;top:${top}px;width:${w}px">${items.map(rowHtml).join("")}</div>`;
};

/** A popover card (ui/popover.tsx, ui/hover-card.tsx): white, 12px corners, `p` padding, holding `inner`. */
const popover = (inner, { left, top, w = 320, p = 4 } = {}) =>
  `<div class="absolute z-50 rounded-xl bg-popover text-popover-foreground shadow-xl ring-1 ring-black/8 ${p === 0 ? "" : p === 3 ? "p-3" : "p-4"}" style="left:${left}px;top:${top}px;width:${w}px">${inner}</div>`;

/** The ground dimmed under a dialog, a sheet or the command menu. */
const scrim = (inner, { center = true } = {}) =>
  `<div class="absolute inset-0 z-40 bg-black/30 ${center ? "grid place-items-center" : ""}">${inner}</div>`;

/** A sheet over the dimmed window: a white card of `w` by `h` holding `inner`, for a proposal's own modal. */
const sheet = (inner, { w = 760, h = 620 } = {}) =>
  scrim(`<div class="flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl" style="width:${w}px;height:${h}px">${inner}</div>`);

/**
 * A dialog (ui/dialog.tsx and alert-dialog.tsx) over the dimmed window: 24px corners and
 * padding, the title (18px) and `line` under it, `body`, and the footer's buttons at the
 * right (`buttons`, finished HTML from `button`, the primary one last). `close` draws
 * the × in its corner; `w` its width (512 by default).
 */
const dialog = ({ title, line = "", body = "", buttons = "", close = true, w = 512 } = {}) =>
  scrim(`
  <div class="relative flex flex-col gap-4 rounded-3xl border border-border bg-background p-6 shadow-2xl" style="width:${w}px">
    ${close ? `<span class="absolute top-4 right-4 text-foreground/60"><i class="ph ph-x text-[16px]"></i></span>` : ""}
    <div class="flex flex-col gap-2 pr-6"><div class="text-lg leading-none font-medium">${title}</div>${line ? `<p class="text-sm text-muted-foreground">${line}</p>` : ""}</div>
    ${body}
    ${buttons ? `<div class="flex justify-end gap-2">${buttons}</div>` : ""}
  </div>`);

/**
 * A toast (ui/sonner.tsx) at the window's bottom left, 12px in: a pill of 13px words with
 * its `action` button and × at the end, or, with `line` under the title, a card the
 * stack's width. `icon` is HTML or a Phosphor name. `bottom`/`left` move it; `stack`
 * draws two quiet cards behind it.
 */
const toast = (title, { line = "", action = "", icon = "", left = 12, bottom = 12, close = true, stack = false } = {}) => {
  const ico = !icon ? "" : icon.startsWith("<") ? icon : `<i class="ph ph-${icon} text-[16px]"></i>`;
  const act = action ? `<span class="shrink-0 rounded-md bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground shadow-xs">${action}</span>` : "";
  const x = close ? `<span class="grid size-6 shrink-0 place-items-center rounded-full text-muted-foreground"><i class="ph ph-x text-[12px]"></i></span>` : "";
  const card = line
    ? `<div class="relative flex w-[356px] items-start gap-2 rounded-xl bg-popover py-2.5 pr-1.5 pl-3 text-[13px] shadow-xl ring-1 ring-black/5">${ico ? `<span class="mt-0.5 shrink-0">${ico}</span>` : ""}<div class="min-w-0 flex-1"><div class="font-medium">${title}</div><div class="mt-0.5 text-muted-foreground">${line}</div></div>${act}${x}</div>`
    : `<div class="relative flex w-fit max-w-[356px] items-center gap-2 rounded-2xl bg-popover py-1.5 pr-1.5 pl-3 text-[13px] shadow-xl ring-1 ring-black/5">${ico}<span class="min-w-0 truncate">${title}</span>${act}${x}</div>`;
  const behind = stack ? `<div class="absolute inset-x-2 -top-2 h-6 rounded-xl bg-popover/80 shadow-md ring-1 ring-black/5"></div><div class="absolute inset-x-4 -top-3.5 h-6 rounded-xl bg-popover/60 shadow-sm ring-1 ring-black/5"></div>` : "";
  return `<div class="absolute z-50" style="left:${left}px;bottom:${bottom}px">${behind}${card}</div>`;
};

/**
 * The command menu (command-menu.tsx), ⌘K from anywhere: 510px over the dimmed window,
 * its field over Go to, Commands and Recent chats, the first row lit. `q` types into
 * it; `rows` replaces the list with [icon, label, keys] rows under `head` labels
 * (`{ head }` items), the way the New tab page shows the same list in place.
 */
const commandMenu = ({ q = "", rows, top = 188 } = {}) => {
  const list =
    rows ??
    [
      { head: "Go to" },
      ["chat-circle", "Chat", "⌃⌘1 ↩"],
      ["folder-simple", "Files", "⌃⌘2"],
      ["globe", "Browser", "⌃⌘3"],
      ["shapes", "Apps", "⌃⌘4"],
      { head: "Commands" },
      ["note-pencil", "New chat", "⌘N"],
      ["plus", "New tab", "⌘T"],
      ["gear", "Settings", "⌘,"],
      ["keyboard", "Keyboard shortcuts", "?"],
      { head: "Recent chats" },
      ["chat-circle", PRICING_TITLE, ""],
    ];
  let first = true;
  const body = list
    .map((r) => {
      if (r.head) return `<div class="px-3 pt-2.5 pb-1 text-xs font-medium text-muted-foreground">${r.head}</div>`;
      const on = first;
      first = false;
      return cmdRow(r[0], r[1], r[2] || "", { on, h: 9 });
    })
    .join("");
  return `<div class="absolute inset-0 z-40 bg-black/20"><div class="absolute left-1/2 w-[510px] -translate-x-1/2 overflow-hidden rounded-2xl bg-popover shadow-2xl ring-1 ring-black/8" style="top:${top}px"><div class="flex h-11 items-center gap-2.5 border-b border-border px-3.5 text-sm"><i class="ph ph-magnifying-glass text-[16px] text-muted-foreground"></i>${q ? `<span>${q}</span><span class="-ml-2 h-4 w-px bg-foreground"></span>` : `<span class="text-muted-foreground">Search or type an address</span>`}</div><div class="p-1">${body}</div></div></div>`;
};

/**
 * The bell's list (notifications-bell.tsx), hung under the bell at the window's top
 * right: "Notifications" over its notices, each a mark in a 28px muted tile, the title
 * with when dimmed beside it, its line, then its action (white, raised) and Dismiss
 * (outline). `items` are { icon, title, when, line, actions: [labels], tone } (tone
 * "warn" for a security warning's amber shield, "problem" for a crash's red mark);
 * none says "You don't have any notifications." Dismiss is always there, so `actions`
 * names only the notice's own.
 */
const notificationsPop = ({ items = [], right = 8, top = 38 } = {}) =>
  `<div class="absolute z-50 w-[380px] overflow-hidden rounded-xl bg-popover shadow-xl ring-1 ring-black/8" style="right:${right}px;top:${top}px">
    <div class="flex h-10 items-center border-b border-border px-4 text-[13px] font-semibold">Notifications</div>
    ${
      items.length
        ? `<div class="divide-y divide-border">${items
            .map(
              (n) => `
    <div class="flex gap-3 px-4 py-3">
      <span class="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-muted ${n.tone === "warn" ? "text-warning-700" : n.tone === "problem" ? "text-destructive" : "text-muted-foreground"}"><i class="ph ph-${n.icon || "megaphone-simple"} text-[16px]"></i></span>
      <div class="min-w-0 flex-1">
        <div class="flex items-baseline gap-2"><span class="min-w-0 flex-1 text-[13px] font-medium">${n.title}</span><span class="shrink-0 text-[11px] text-muted-foreground/60">${n.when || ""}</span></div>
        ${n.line ? `<p class="mt-0.5 text-xs text-muted-foreground">${n.line}</p>` : ""}
        <div class="mt-2 flex gap-1.5">${(n.actions ?? []).map((a) => button(a, { size: "xs" })).join("")}${button("Dismiss", { size: "xs", tone: "outline" })}</div>
      </div>
    </div>`,
            )
            .join("")}</div>`
        : `<p class="px-4 py-8 text-center text-[13px] text-muted-foreground">You don't have any notifications.</p>`
    }
  </div>`;

/** The card a warning pill opens (network-status-pill.tsx): what is out and what still works. */
const statusCard = (title, line, { right = 44, top = 38, extra = "" } = {}) =>
  `<div class="absolute z-50 w-80 rounded-xl bg-popover p-4 shadow-xl ring-1 ring-black/8" style="right:${right}px;top:${top}px"><p class="text-sm font-semibold">${title}</p><p class="mt-1 text-sm text-muted-foreground">${line}</p>${extra}</div>`;

/**
 * Send feedback (feedback-dialog): 960x640 over the dimmed window. At the left the
 * title and its line, Comments, Add images, and the checklist of what goes with it
 * (`items`: [label, size, checked, depth]); at the right the item picked (`preview`:
 * its title, size and body, a JSON block by default); Cancel and Send at the foot.
 */
const feedbackDialog = ({
  comment = "",
  items = [["Diagnostics", "3 KB", true, 0], ["About this Mac and app", "1 KB", true, 1], ["Recent errors", "3 KB", true, 1]],
  picked = 1,
  preview = { title: "About this Mac and app", size: "1 KB", body: `<pre class="rounded-lg bg-foreground/[0.03] p-3 font-mono text-[11px] leading-[17px] text-[#2c5aa0]">{
  "app": { "version": "2.0.0-beta.119" },
  "locale": "en-US",
  "os": { "arch": "arm64", "platform": "darwin", "version": "26.6.2" }
}</pre>` },
} = {}) =>
  scrim(`
  <div class="flex h-[640px] w-[960px] flex-col overflow-hidden rounded-3xl bg-background shadow-2xl ring-1 ring-black/5">
    <div class="flex min-h-0 flex-1">
      <div class="flex w-[352px] shrink-0 flex-col gap-3 border-r border-border p-6">
        <div><div class="text-lg font-medium">Send feedback</div><p class="mt-1 text-sm text-muted-foreground">Only the Instrument team will see what you send. Pick anything below to read it first, and uncheck what you’d rather keep to yourself.</p></div>
        <div class="text-[13px] font-medium">Comments</div>
        ${textArea({ value: comment, ph: "What happened, and what did you expect?", rows: 2, focus: !comment })}
        <span>${button("Add images", { tone: "outline", size: "sm", icon: "image" })}</span>
        <div class="flex flex-col">${items
          .map(
            ([label, size, on, depth], i) =>
              `<div class="flex h-8 items-center gap-2.5 rounded-lg pr-2 ${depth ? "pl-8" : "pl-2"} text-[13px] ${i === picked ? "bg-foreground/6" : ""}">${checkbox(on)}${depth ? `<i class="ph ph-info text-[14px] text-muted-foreground"></i>` : ""}<span class="flex-1 ${depth ? "" : "font-medium"}">${label}</span><span class="text-[12px] text-muted-foreground">${size}</span></div>`,
          )
          .join("")}</div>
      </div>
      <div class="flex min-w-0 flex-1 flex-col">
        <div class="flex h-12 shrink-0 items-center border-b border-border px-4 text-sm font-medium"><span class="flex-1">${preview.title}</span><span class="text-[12px] font-normal text-muted-foreground">${preview.size}</span></div>
        <div class="min-h-0 flex-1 overflow-hidden p-3">${preview.body}</div>
      </div>
    </div>
    <div class="flex shrink-0 justify-end gap-2 border-t border-border px-6 py-3">${button("Cancel", { tone: "outline" })}${button("Send", { tone: "brand" })}</div>
  </div>`);
