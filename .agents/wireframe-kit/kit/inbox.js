// ---- the inbox ------------------------------------------------------------------
// Chat's list of chats (chat-list.tsx, filter-head.tsx, chat-row.tsx), 320px on the
// card's grey, and what sits beside it with no chat open. Re-measured 2026-10-31.

/** Chat with none selected: what sits beside the inbox. There is no Home page. */
const noChatOpen = () => `
  <div class="flex min-w-0 flex-1 flex-col items-center justify-center bg-muted/20 text-center">
    <span class="mb-5 grid size-14 place-items-center rounded-2xl text-muted-foreground/30 shadow-md inset-ring inset-ring-current/60"><i class="ph ph-chats-circle text-[28px]"></i></span>
    <span class="text-sm font-medium text-muted-foreground">No chat selected</span>
    <span class="mt-0.5 max-w-72 text-[13px] leading-6 text-muted-foreground/60">Select a chat or start a new one</span>
    <span class="mt-5 flex h-8 items-center gap-1.5 rounded-full bg-card pr-1.5 pl-2.5 text-sm font-medium shadow-sm"><i class="ph ph-note-pencil"></i>New chat<span class="ml-0.5 flex h-5 items-center rounded-full bg-black/5 px-1.5 text-[11px] text-muted-foreground ring-1 ring-black/8">⌘N</span></span>
  </div>`;

/** The views the picker names besides Chats, each led by its mark (filter-head.tsx). Drafts is one only while there are drafts. */
const PLACES = {
  unread: ["Unread", "ph-notification"],
  starred: ["Starred", "ph-star"],
  drafts: ["Drafts", "ph-circle-dashed"],
  archived: ["Archived", "ph-archive"],
};

const projectByName = (name) => PROJECTS.find((t) => t.name === name) ?? { name, emoji: "", color: "#007fc3" };

/** A project's mark (project-mark.tsx): its emoji on its tint in a rounded square. `size` sm (14), md (16) or lg (44). */
const projectMark = (project, size = "md") => {
  const t = typeof project === "string" ? projectByName(project) : project;
  const box = { lg: "size-11 rounded-xl text-[22px]", sm: "size-3.5 rounded-sm text-[9px]", md: "size-4 rounded text-[10px]" }[size];
  return `<span class="inline-grid shrink-0 place-items-center leading-none ${box} bg-(--project-tint-surface)" style="${projectTint(t.color)}">${t.emoji}</span>`;
};

/** A project as a pill no taller than its line (ProjectPill): `quiet` is the faint wash a row's corner wears, with the name in the project's ink. */
const projectPill = (project, { quiet = true } = {}) => {
  const t = typeof project === "string" ? projectByName(project) : project;
  return `<span class="inline-flex h-5 max-w-32 shrink-0 items-center gap-1 rounded-md text-[11px] leading-4 ${quiet ? "bg-(--project-tint-surface)/40 pr-2 pl-1.5 font-medium text-(--project-tint-ink)" : "bg-(--project-tint-surface) pr-1.5 pl-1 text-foreground/90"}" style="${projectTint(t.color)}"><span class="text-[10px]">${t.emoji}</span><span class="truncate">${t.name}</span></span>`;
};

/**
 * The line over the inbox (filter-head.tsx), 8px in from the card: the picker naming the
 * view the list stands in, bare on the card (a grey fill only under the pointer or while
 * its menu is up, `open`): Chats alone, or a `place` (unread | starred | drafts |
 * archived) or `project` (a name in PROJECTS) led by its face; then the search, a faint grey
 * well. Typing into it (`search`: the words) folds the picker to its face alone and
 * raises the field white and ringed, with its clear button. Under a project the head
 * wears the project's tint and its instructions follow on a banner, with Edit project.
 */
const inboxHead = ({ place = "", project = "", search = "", open = false } = {}) => {
  const t = project ? projectByName(project) : null;
  const [label, icon] = t ? [t.name, ""] : (PLACES[place] ?? ["Chats", "ph-chat-circle"]);
  const face = t ? projectMark(t, "md").replace("size-4", "size-5").replace("text-[10px]", "text-[13px]") : `<i class="ph ${icon} text-[20px]"></i>`;
  const hasFace = Boolean(t || place || search);
  const picker = search
    ? `<span class="grid size-9 shrink-0 place-items-center rounded-lg text-foreground/80">${face}</span>`
    : `<span class="flex h-9 max-w-48 min-w-0 shrink-0 items-center rounded-lg px-2 text-[15px] font-semibold ${open ? "bg-foreground/5 text-foreground" : "text-foreground/80"}">${hasFace ? `<span class="grid size-5 shrink-0 place-items-center">${face}</span><span class="pl-1"></span>` : ""}<span class="truncate">${label}</span><i class="ph ph-caret-down ml-1 shrink-0 text-[14px] opacity-50"></i></span>`;
  const field = search
    ? `<div class="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg bg-card pr-1.5 pl-3 text-sm text-foreground shadow-sm ring-2 ring-foreground/15"><i class="ph ph-magnifying-glass shrink-0 text-[14px] text-muted-foreground"></i><span class="min-w-0 flex-1 truncate">${search}</span><span class="grid size-5 shrink-0 place-items-center text-muted-foreground"><i class="ph ph-x text-[10px]"></i></span></div>`
    : `<div class="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg bg-foreground/4 pr-3 pl-3 text-sm text-muted-foreground"><i class="ph ph-magnifying-glass shrink-0 text-[14px]"></i><span class="min-w-0 flex-1 truncate">${t || place ? `Search ${label}` : "Search"}</span></div>`;
  const banner =
    t && !search
      ? `<div class="flex shrink-0 flex-col items-start gap-1 px-4 pb-3 text-sm leading-5">${t.instructions ? `<p class="line-clamp-2 text-foreground/75">${t.instructions}</p>` : ""}<span class="text-[13px] text-foreground/45">Edit project</span></div>`
      : "";
  return `
  <div class="${t ? "bg-(--project-tint-surface)/60" : ""}" ${t ? `style="${projectTint(t.color)}"` : ""}>
    <div class="flex items-center gap-1.5 p-2">${picker}${field}</div>
    ${banner}
  </div>`;
};

/**
 * The picker's menu (filter-head.tsx): 256px with 12px corners, 36px rows 2px apart (the
 * view the list stands in on a soft grey, its name in medium), the views with their
 * muted counts (Drafts only with `counts.drafts`), then the projects (PROJECTS by default,
 * `[]` for none) and New project. Place it with `left`/`top` in the window's pixels.
 */
const viewMenu = ({ on = "", counts = {}, projects = PROJECTS, left = 84, top = 88 } = {}) => {
  const line = `<div class="-mx-1.5 my-0.5 h-px shrink-0 bg-black/5"></div>`;
  const item = (face, label, { isOn = false, count, muted = false } = {}) => `
    <div class="flex h-9 shrink-0 items-center gap-3 rounded-lg pr-2 pl-2.5 text-sm ${isOn ? "bg-foreground/6 font-medium" : muted ? "text-muted-foreground/70" : ""}">
      <span class="grid size-6 shrink-0 place-items-center ${isOn || muted ? "" : "text-muted-foreground"}">${face}</span>
      <span class="min-w-0 flex-1 truncate">${label}</span>${count ? `<span class="text-xs text-muted-foreground/60 tabular-nums">${count}</span>` : ""}
    </div>`;
  const views = [
    ["", "Chats", "ph-chat-circle"],
    ...Object.entries(PLACES)
      .filter(([k]) => k !== "drafts" || counts.drafts || on === "drafts")
      .map(([k, [l, i]]) => [k, l, i]),
  ];
  return `
  <div class="absolute z-30 flex w-64 flex-col gap-0.5 rounded-xl border border-border bg-popover p-1.5 shadow-lg" style="left:${left}px;top:${top}px">
    ${views.map(([k, l, i]) => item(`<i class="ph ${i} text-[20px]"></i>`, l, { isOn: k === on, count: counts[k] })).join("")}
    ${projects.length ? line + projects.map((t) => item(projectMark(t, "md").replace("size-4", "size-6").replace("text-[10px]", "text-[15px]"), t.name, { isOn: on === t.name, count: t.count })).join("") : ""}
    ${line}${item(`<i class="ph ph-plus-square text-[20px]"></i>`, "New project", { muted: true })}
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

/** Words with the part a search matched in the foreground's semibold, the way FuzzyHighlight marks it. */
const matched = (text, q) => {
  if (!q) return text;
  const at = text.toLowerCase().indexOf(q.toLowerCase());
  return at < 0 ? text : `${text.slice(0, at)}<b class="font-semibold text-foreground">${text.slice(at, at + q.length)}</b>${text.slice(at + q.length)}`;
};

/** The controls a row shows at its title's end under the pointer (row-action-bar.tsx): file under a project, pop out, archive, mark unread, star. */
const ROW_ACTIONS = ["ph-tag", "ph-picture-in-picture", "ph-archive", "ph-notification", "ph-star"];

/**
 * An inbox row (chat-row.tsx), three lines every row keeps: the title (semibold only
 * while something in it is unseen), "Draft" in red after it while a reply waits unsent
 * (`draft`), and the project pill (`project`) and the starred chat's star in the corner; the
 * agent's latest line (the `step` in the brand's shimmer while it works, `ask` behind a
 * question mark while it waits on you, otherwise the `preview`); then what it holds,
 * with the time in the corner. A hairline above every row, under the last one too. `on`
 * is the open row, the card's own white on the list's grey; `hover` is halfway there,
 * with the row's controls in place of its pill and star. `search` marks the words a
 * search matched. `r` may be finished HTML.
 */
const row = (r, { on = false, last = false, hover = false, search = "" } = {}) =>
  typeof r === "string"
    ? r
    : `
  <div class="relative flex flex-col border-t border-border/70 bg-clip-padding px-4 py-2.5 ${last ? "border-b" : ""} ${on ? "bg-card" : hover ? "bg-card/50" : ""}">
    <div class="flex h-5 items-center gap-1.5">
      <span class="min-w-0 truncate text-[13px] tracking-[-0.005em] ${r.unread ? "font-semibold" : "font-medium text-foreground/85"}">${matched(r.title, search)}</span>
      ${r.draft ? `<span class="shrink-0 text-[13px] text-error-700">Draft</span>` : ""}
      <span class="flex-1"></span>
      ${
        hover
          ? `<span class="-my-0.5 flex shrink-0 items-center text-foreground/50">${ROW_ACTIONS.map((i) => `<span class="grid size-6 place-items-center"><i class="ph ${i} text-[16px] ${i === "ph-star" && r.starred ? "text-warning-500" : ""}"></i></span>`).join("")}</span>`
          : `${r.project ? projectPill(r.project) : ""}${r.starred ? `<span class="-my-0.5 grid size-6 shrink-0 place-items-center"><i class="ph ph-star text-[16px] text-warning-500"></i></span>` : ""}`
      }
    </div>
    <div class="flex h-5 min-w-0 items-center gap-1.5 text-[12px]">${
      r.working && r.step
        ? `<span class="truncate text-brand-600">${r.step}</span>`
        : r.ask
          ? `<i class="ph ph-question shrink-0 text-[14px] text-foreground/80"></i><span class="truncate text-foreground/80">${r.ask}</span>`
          : `<span class="truncate text-muted-foreground">${matched(r.preview || "", search)}</span>`
    }</div>
    <div class="mt-1 flex h-5 items-center gap-2">
      <span class="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">${holdMarks(r.holds)}</span>
      <span class="ml-auto w-14 shrink-0 text-right text-[11px] text-muted-foreground/70 tabular-nums ${r.unread ? "font-semibold" : ""}">${r.time || ""}</span>
    </div>
  </div>`;

/**
 * A draft in the Drafts place (draft-row.tsx): a dashed circle in the gutter where a chat
 * wears its state, the first line of its words as the title, when it was last touched at
 * the right, and "Draft" where a chat's latest line goes, then the marks of what it holds
 * (`holds`, as a chat row's).
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
 * stands it in another view (unread | starred | drafts | archived) and `project` in a
 * project (a PROJECTS name); `drafts` ([{ title, time, holds }]) stands it in Drafts and lists
 * those instead. `search` types words into the search and marks them in the rows;
 * `empty` is the line an empty list says (with `rows: []`); `picking` draws the picker
 * pressed, under its `viewMenu`. `rows` may mix row objects and finished HTML, and
 * `before` puts HTML (a proposal's own rows) over them.
 */
const inboxCol = ({
  on = 0,
  hover = -1,
  w = 320,
  rows = ROWS,
  place = "",
  project = "",
  drafts,
  search = "",
  empty = "Press New to start a chat",
  picking = false,
  before = "",
} = {}) => `
  <div class="relative flex shrink-0 flex-col bg-background pr-px after:absolute after:inset-y-0 after:right-0 after:w-px after:bg-border/70" style="width:${w}px">
    ${inboxHead({ place: drafts ? "drafts" : place, project, search, open: picking })}
    ${
      (drafts ?? rows).length === 0 && !before
        ? `<div class="grid flex-1 place-items-center px-8 pb-16"><div class="flex flex-col items-center text-center text-[13px]"><span class="mb-3 grid size-11 place-items-center rounded-xl text-muted-foreground/30 inset-ring inset-ring-current/60"><i class="ph ph-chat-circle text-[24px]"></i></span><p class="max-w-56 leading-5 text-balance text-muted-foreground/60">${empty}</p></div></div>`
        : `<div class="flex flex-col">${before}${
            drafts
              ? drafts.map((d, i) => draftRow(d, { last: i === drafts.length - 1 })).join("")
              : rows.map((r, i) => row(r, { on: i === on, hover: i === hover && i !== on, last: i === rows.length - 1, search })).join("")
          }</div>`
    }
  </div>`;

/** A chat's menu (chat-row.tsx's right click, and the caret by a chat's title), as built. `starred` and `unread` flip their rows. */
const chatMenu = ({ left = 120, top = 140, starred = false, unread = false } = {}) =>
  menu(
    [
      { label: "Open" },
      { icon: "app-window", label: "Open in New Tab" },
      { icon: "picture-in-picture", label: "Pop Out" },
      "rule",
      { icon: "notification", label: unread ? "Mark as read" : "Mark as unread" },
      { icon: "star", label: starred ? "Unstar" : "Star" },
      "rule",
      { icon: "pencil-simple", label: "Rename" },
      { icon: "tag", label: "Project", sub: true },
      "rule",
      { icon: "folder-simple", label: "Show in Finder" },
      "rule",
      { icon: "chat-text", label: "Send feedback…" },
      "rule",
      { icon: "archive", label: "Archive" },
      "rule",
      { icon: "trash", label: "Delete chat…", danger: true },
    ],
    { left, top, w: 220 },
  );
