// ---- inbox ---------------------------------------------------------------------

/** Chat with none selected: what sits beside the inbox. There is no Home page. */
const noChatOpen = () => `
  <div class="flex min-w-0 flex-1 flex-col items-center justify-center bg-muted/20 text-center">
    <span class="mb-5 grid size-14 place-items-center rounded-2xl text-muted-foreground/30 shadow-md inset-ring inset-ring-current/60"><i class="ph ph-chats-circle text-[28px]"></i></span>
    <span class="text-sm font-medium text-muted-foreground">No chat selected</span>
    <span class="mt-0.5 max-w-72 text-[13px] leading-6 text-muted-foreground/60">Select a chat or start a new one</span>
    <span class="mt-5 flex h-8 items-center gap-1.5 rounded-full bg-card pr-1.5 pl-2.5 text-sm font-medium shadow-sm"><i class="ph ph-note-pencil"></i>New chat<span class="ml-0.5 flex h-5 items-center rounded-full bg-black/5 px-1.5 text-[11px] text-muted-foreground ring-1 ring-black/8">⌘N</span></span>
  </div>`;

/** The views the picker names besides Chats, each led by its mark (filter-head.tsx). */
const PLACES = {
  unread: ["Unread", "ph-notification"],
  starred: ["Starred", "ph-star"],
  drafts: ["Drafts", "ph-circle-dashed"],
  archived: ["Archived", "ph-archive"],
};

/**
 * The line over the inbox, as filter-head.tsx draws it, 8px in from the card: the picker
 * naming the view the list stands in, bare on the card (a grey fill only under the pointer
 * or while its menu is up, `open`), Chats alone or a `place` (unread | starred | drafts |
 * archived) led by its mark, its name on the rows' 16px keyline; then the search, a faint
 * grey well that turns into a raised white field once typed into (`search`: the words).
 */
const inboxHead = ({ place = "", search = "", open = false } = {}) => {
  const [label, icon] = PLACES[place] ?? ["Chats"];
  return `
  <div class="flex items-center gap-1.5 p-2">
    <span class="flex h-9 shrink-0 items-center rounded-lg px-2 text-[15px] font-semibold ${open ? "bg-foreground/5 text-foreground" : "text-foreground/80"}">${icon ? `<span class="grid size-5 place-items-center"><i class="ph ${icon} text-[20px]"></i></span><span class="pl-1"></span>` : ""}${label}<i class="ph ph-caret-down ml-1 text-[14px] opacity-50"></i></span>
    <div class="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg pl-3 text-sm ${search ? "bg-card pr-1.5 text-foreground shadow-sm ring-1 ring-input" : "bg-foreground/4 pr-3 text-muted-foreground"}"><i class="ph ph-magnifying-glass shrink-0 text-[14px] text-muted-foreground"></i><span class="min-w-0 flex-1 truncate">${search || (place ? `Search ${label}` : "Search")}</span>${search ? `<span class="grid size-5 shrink-0 place-items-center text-muted-foreground"><i class="ph ph-x text-[10px]"></i></span>` : ""}</div>
  </div>`;
};

/**
 * The picker's menu, as filter-head.tsx draws it: 256px with 12px corners, 36px rows 2px
 * apart (the view the list stands in on a soft grey, its name in medium), the views with
 * their muted counts, then the topics (`topics`: [{ emoji, name, count }]) and New topic.
 * Place it with `menu`-style absolute positioning through `left`/`top`.
 */
const viewMenu = ({ on = "", counts = {}, topics = [], left = 8, top = 50 } = {}) => {
  const line = `<div class="-mx-1.5 my-0.5 h-px shrink-0 bg-black/5"></div>`;
  const item = (face, label, { isOn = false, count, muted = false } = {}) => `
    <div class="flex h-9 shrink-0 items-center gap-3 rounded-lg pr-2 pl-2.5 text-sm ${isOn ? "bg-foreground/6 font-medium" : muted ? "text-muted-foreground/70" : ""}">
      <span class="grid size-6 shrink-0 place-items-center ${isOn || muted ? "" : "text-muted-foreground"}">${face}</span>
      <span class="min-w-0 flex-1 truncate">${label}</span>${count ? `<span class="text-xs text-muted-foreground/60 tabular-nums">${count}</span>` : ""}
    </div>`;
  const views = [["", "Chats", "ph-chat-circle"], ...Object.entries(PLACES).map(([k, [l, i]]) => [k, l, i])];
  return `
  <div class="absolute z-20 flex w-64 flex-col gap-0.5 rounded-xl border border-border bg-popover p-1.5 shadow-lg" style="left:${left}px;top:${top}px">
    ${views.map(([k, l, i]) => item(`<i class="ph ${i} text-[20px]"></i>`, l, { isOn: k === on, count: counts[k] })).join("")}
    ${topics.length ? line + topics.map((t) => item(`<span class="text-lg leading-none">${t.emoji}</span>`, t.name, { count: t.count })).join("") : ""}
    ${line}${item(`<i class="ph ph-plus-square text-[20px]"></i>`, "New topic", { muted: true })}
  </div>`;
};

/** What a chat holds, on its row's third line: files as chips with their names, apps and sites as bare marks. Holds are {file}, {site} or {app} (a key of BRAND_URI). */
const holdMarks = (holds = []) =>
  holds
    .map((h) =>
      h.file
        ? `<span class="inline-flex h-5 max-w-36 shrink-0 items-center gap-1 rounded-md bg-foreground/4 pr-1.5 pl-1 text-[11px] text-muted-foreground">${fileMark(FILES[h.file].kind, "text-[12px]")}<span class="truncate">${FILES[h.file].title}</span></span>`
        : h.site
          ? `<span class="grid size-4 shrink-0 place-items-center">${SITES[h.site].mark("size-3.5 text-[7px]")}</span>`
          : `<span class="grid size-4 shrink-0 place-items-center">${brand(h.app, "size-3.5")}</span>`,
    )
    .join("");

/**
 * An inbox row, as chat-row.tsx lays it out, three lines every row keeps: the title
 * (semibold only while something in it is unseen) with the star at its end; the agent's
 * latest line (the `step` shimmering while it works, `ask` behind a question mark while it
 * waits on you, otherwise the `preview`); then what it holds, with the time in the corner.
 * Every row has a faint hairline above it, the last one under it too; the open row (`on`)
 * is the card's own white on the list's grey, and `hover` is halfway there, with the row's
 * controls in line at the title's end: tag, archive, unread, star.
 */
const row = (r, { on = false, last = false, hover = false } = {}) => `
  <div class="relative flex flex-col border-t border-border/70 bg-clip-padding px-4 py-2.5 ${last ? "border-b" : ""} ${on ? "bg-card" : hover ? "bg-card/50" : ""}">
    <div class="flex h-5 items-center gap-1.5">
      <span class="min-w-0 flex-1 truncate text-[13px] tracking-[-0.005em] ${r.unread ? "font-semibold" : "font-medium text-foreground/85"}">${r.title}</span>
      ${
        hover
          ? `<span class="-my-0.5 flex shrink-0 items-center text-foreground/50">${["ph-tag", "ph-archive", "ph-notification", "ph-star"].map((i) => `<span class="grid size-6 place-items-center"><i class="ph ${i} text-[16px] ${i === "ph-star" && r.starred ? "text-warning-500" : ""}"></i></span>`).join("")}</span>`
          : r.starred
            ? `<span class="-my-0.5 grid size-6 shrink-0 place-items-center"><i class="ph ph-star text-[16px] text-warning-500"></i></span>`
            : ""
      }
    </div>
    <div class="flex h-5 min-w-0 items-center gap-1.5 text-[12px]">${
      r.working && r.step
        ? `<span class="truncate text-brand-600">${r.step}</span>`
        : r.ask
          ? `<i class="ph ph-question shrink-0 text-[14px] text-foreground/80"></i><span class="truncate text-foreground/80">${r.ask}</span>`
          : `<span class="truncate text-muted-foreground">${r.preview || ""}</span>`
    }</div>
    <div class="mt-1 flex h-5 items-center gap-2">
      <span class="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">${holdMarks(r.holds)}</span>
      <span class="ml-auto w-14 shrink-0 text-right text-[11px] text-muted-foreground/70 tabular-nums ${r.unread ? "font-semibold" : ""}">${r.time || ""}</span>
    </div>
  </div>`;

/**
 * A draft in the Drafts place, as draft-row.tsx lays it out: a dashed circle in the gutter
 * where a chat wears its state, the first line of its words as the title, when it was last
 * touched at the right, and "Draft" where a chat's latest line goes, then the marks of
 * what it holds (`holds`, as a chat row's) the way a chat row shows them.
 */
const draftRow = (d, { last = false } = {}) => `
  <div class="flex gap-2 border-t border-border/70 px-4 py-2.5 ${last ? "border-b" : ""}">
    <span class="flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground"><i class="ph ph-circle-dashed text-[14px]"></i></span>
    <div class="min-w-0 flex-1">
      <div class="flex h-5 items-center gap-1.5"><span class="min-w-0 flex-1 truncate text-[13px] text-foreground/90">${d.title}</span><span class="shrink-0 text-right text-[11px] text-muted-foreground/70 tabular-nums">${d.time || ""}</span></div>
      <div class="mt-0.5 flex items-center gap-2 text-[12px] leading-5 text-muted-foreground">Draft${d.holds ? `<span class="flex min-w-0 items-center gap-1">${holdMarks(d.holds)}</span>` : ""}</div>
    </div>
  </div>`;

/**
 * The inbox column: head, rows, on the card's grey with a faint line at its right edge.
 * `on` is the open row's index (-1 for none), `hover` the row under the pointer. `place`
 * stands it in another view (unread | starred | drafts | archived); `drafts` ([{ title,
 * time, holds }]) stands it in Drafts and lists those instead. `search` types words into
 * the search; `empty` is the line an empty list says (with `rows: []`); `picking` draws
 * the picker pressed, under its `viewMenu`.
 */
const inboxCol = ({
  on = 0,
  hover = -1,
  w = 320,
  rows = ROWS,
  place = "",
  drafts,
  search = "",
  empty = "Press New to start a chat",
  picking = false,
} = {}) => `
  <div class="relative flex shrink-0 flex-col bg-background pr-px after:absolute after:inset-y-0 after:right-0 after:w-px after:bg-border/70" style="width:${w}px">
    ${inboxHead({ place: drafts ? "drafts" : place, search, open: picking })}
    ${
      (drafts ?? rows).length === 0
        ? `<div class="grid flex-1 place-items-center px-8 pb-16"><div class="flex flex-col items-center text-center text-[13px]"><span class="mb-3 grid size-11 place-items-center rounded-xl text-muted-foreground/30 inset-ring inset-ring-current/60"><i class="ph ph-chat-circle text-[24px]"></i></span><p class="max-w-56 leading-5 text-balance text-muted-foreground/60">${empty}</p></div></div>`
        : `<div class="flex flex-col">${
            drafts
              ? drafts.map((d, i) => draftRow(d, { last: i === drafts.length - 1 })).join("")
              : rows.map((r, i) => row(r, { on: i === on, hover: i === hover && i !== on, last: i === rows.length - 1 })).join("")
          }</div>`
    }
  </div>`;
