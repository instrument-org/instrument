// ---- the inbox ------------------------------------------------------------------
// Chat's list of chats (chat-pane.tsx, filter-head.tsx, search-field.tsx,
// projects-section.tsx, chat-list.tsx, chat-row.tsx), 320px on the card's grey, and the
// new chat that stands beside it with no chat open. Re-measured 2026-11-07.

/**
 * Chat with no chat open (new-chat-view.tsx): the room a chat would have, as a new chat
 * waiting to be written, with a chat's head (the inbox toggle, "New chat", a dashed
 * + Project, the pane button at the right) and the chat's own reply box at its foot.
 * There is no Home page and no empty state.
 */
const noChatOpen = ({ project = "" } = {}) => newChat({ project });

/** The places a chat can be, as the tabs under the search name them (filter-head.tsx). */
const PLACES = {
  "": "Inbox",
  drafts: "Drafts",
  archived: "Archived",
};

/** The marks the search offers as tokens (filter-head.tsx's TAGS), each with its filled mark. */
const TOKENS = {
  unread: ["Unread", `<i class="ph ph-notification text-[14px]"></i>`],
  starred: ["Starred", `<i class="ph ph-star text-[14px] text-warning-500"></i>`],
};

const projectByName = (name) => PROJECTS.find((t) => t.name === name) ?? { name, emoji: "", color: "#007fc3" };

/** A project's mark (project-mark.tsx): its emoji on its tint in a rounded square. `size` sm (14), md (16) or lg (44); `plain` leaves the tint out, for a mark on a tile of its own. */
const projectMark = (project, size = "md", { plain = false } = {}) => {
  const t = typeof project === "string" ? projectByName(project) : project;
  const box = { lg: "size-11 rounded-xl text-[22px]", sm: "size-3.5 rounded-sm text-[9px]", md: "size-4 rounded text-[10px]" }[size];
  return `<span class="inline-grid shrink-0 place-items-center leading-none ${box} ${plain ? "" : "bg-(--project-tint-surface)"}" style="${projectTint(t.color)}">${t.emoji || `<span class="font-semibold text-(--project-tint-ink) uppercase">${t.name[0]}</span>`}</span>`;
};

/** A project as a pill no taller than its line (ProjectPill), as a chat's head wears it: `quiet` is the faint wash with the name in the project's ink. */
const projectPill = (project, { quiet = true } = {}) => {
  const t = typeof project === "string" ? projectByName(project) : project;
  return `<span class="inline-flex h-5 max-w-32 shrink-0 items-center gap-1 rounded-md text-[11px] leading-4 ${quiet ? "bg-(--project-tint-surface)/40 pr-2 pl-1.5 font-medium text-(--project-tint-ink)" : "bg-(--project-tint-surface) pr-1.5 pl-1 text-foreground/90"}" style="${projectTint(t.color)}"><span class="text-[10px]">${t.emoji}</span><span class="truncate">${t.name}</span></span>`;
};

/** The project a row's chat is filed under, as its name in the project's ink (ProjectWords). */
const projectWords = (project) => {
  const t = typeof project === "string" ? projectByName(project) : project;
  return `<span class="max-w-32 shrink-0 truncate text-[12px] leading-5 font-medium text-(--project-tint-ink)" style="${projectTint(t.color)}">${t.name}</span>`;
};

/** The head's square controls: the search's glass in a project, and the view button, wearing the rows' density. */
const DENSITY_ICONS = { three: "ph-rows", two: "ph-list-dashes", one: "ph-list" };
const headButton = (icon, { open = false } = {}) =>
  `<span class="grid size-9 shrink-0 place-items-center rounded-lg ${open ? "bg-foreground/6 text-foreground" : "text-muted-foreground"}"><i class="ph ${icon} text-[16px]"></i></span>`;

/**
 * The search (search-field.tsx): a faint grey well with the glass at its left and the view
 * named in its placeholder, raised white and ringed while it has the keyboard (`focus`) or
 * holds words (`search`) or `tokens` (keys of TOKENS, which stand in it ahead of the
 * words), with its clear × at the end once anything is in it. `offer` draws it clicked
 * into and empty, with Show only and the marks it offers under it (keys of TOKENS).
 */
const chatSearch = ({ ph = "Search", search = "", tokens = [], focus = false, offer } = {}) => {
  const isSearched = Boolean(search || tokens.length);
  const raised = focus || isSearched || offer;
  const chips = tokens
    .map((k) => `<span class="flex h-6 shrink-0 items-center gap-1 rounded-md bg-foreground/8 pr-0.5 pl-1.5 text-xs font-medium"><span class="flex size-3.5 items-center justify-center">${TOKENS[k][1]}</span>${TOKENS[k][0]}<span class="grid size-4 place-items-center text-muted-foreground"><i class="ph ph-x text-[10px]"></i></span></span>`)
    .join("");
  const words = search ? `<span class="min-w-0 flex-1 truncate">${search}</span>` : `<span class="min-w-0 flex-1 truncate text-muted-foreground">${tokens.length ? "" : ph}</span>`;
  const menu = offer?.length
    ? `<div class="absolute top-full left-0 z-30 mt-1.5 w-full min-w-48 rounded-xl bg-popover p-1 text-popover-foreground shadow-xl ring-1 ring-black/8"><div class="px-2 pt-1 pb-1 text-xs text-muted-foreground">Show only</div>${offer.map((k) => `<div class="flex h-8 items-center gap-2 rounded-md px-2 text-sm">${TOKENS[k][1].replace("text-[14px]", "text-[16px]")}${TOKENS[k][0]}</div>`).join("")}</div>`
    : "";
  return `
    <div class="relative flex h-9 min-w-0 flex-1 items-center gap-1 rounded-lg border pl-8 text-sm ${isSearched ? "pr-7" : "pr-3"} ${raised ? "border-input bg-background shadow-sm" : "border-transparent bg-foreground/4"}">
      <i class="ph ph-magnifying-glass absolute top-1/2 left-3 -translate-y-1/2 text-[14px] text-muted-foreground"></i>
      ${chips}${words}
      ${isSearched ? `<span class="absolute top-1/2 right-1.5 grid size-5 -translate-y-1/2 place-items-center text-muted-foreground"><i class="ph ph-x text-[10px]"></i></span>` : ""}
      ${menu}
    </div>`;
};

/**
 * The lines over the list (filter-head.tsx). Outside a project: the search with the view
 * button at its end, and under them the places a chat can be as tabs (`place`: "" for
 * Inbox, drafts, archived), the one up on a soft grey in medium. Inside a `project` (a
 * PROJECTS name): a 52px line with ‹ Inbox at the left, then the search folded to its
 * glass, then the view button; the search opens out in their place once it is asked for
 * (`focus`) or holds anything. `open` draws the view button pressed, under its viewMenu;
 * `density` is the rows' (three, two, one), which the view button wears.
 */
const inboxHead = ({ place = "", project = "", search = "", tokens = [], focus = false, offer, open = false, density = "three" } = {}) => {
  const view = headButton(DENSITY_ICONS[density], { open });
  if (project) {
    const t = projectByName(project);
    const shown = focus || search || tokens.length || offer;
    return `
    <div class="relative z-10 flex h-13 shrink-0 items-center gap-1.5 px-2">
      ${shown ? chatSearch({ ph: `Search ${t.name}`, search, tokens, focus, offer }) : `<span class="flex h-8 items-center gap-1 rounded-lg pr-2.5 pl-1.5 text-[13px] text-foreground/70"><i class="ph ph-caret-left text-[14px]"></i>Inbox</span><span class="flex-1"></span>${headButton("ph-magnifying-glass")}`}
      ${view}
    </div>`;
  }
  return `
  <div class="relative z-10 flex shrink-0 flex-col gap-1.5 px-2 pt-2 pb-2">
    <div class="flex items-center gap-1.5">${chatSearch({ ph: place ? `Search ${PLACES[place]}` : "Search", search, tokens, focus, offer })}${view}</div>
    <div class="flex items-center gap-0.5">${Object.entries(PLACES)
      .map(([k, l]) => `<span class="flex h-7 items-center rounded-md px-2 text-[13px] ${k === place ? "bg-foreground/7 font-medium text-foreground" : "text-foreground/60"}">${l}</span>`)
      .join("")}</div>
  </div>`;
};

/**
 * The view button's popover (filter-head.tsx's ViewButton): 256px, the three row densities
 * with their notes (the one in use on a soft grey with a check), a rule, and Group by day
 * with its switch. Place it with `left`/`top` in the window's pixels.
 */
const viewMenu = ({ density = "three", byDay = false, left = 132, top = 90 } = {}) => {
  const rows = [
    ["three", "ph-rows", "Three lines", "Title, preview, project and files"],
    ["two", "ph-list-dashes", "Two lines", "Title, then project or last reply"],
    ["one", "ph-list", "One line", "Just the titles"],
  ];
  return `
  <div class="absolute z-50 w-64 rounded-xl bg-popover p-1.5 text-popover-foreground shadow-xl ring-1 ring-black/8" style="left:${left}px;top:${top}px">
    <div class="flex flex-col gap-0.5">${rows
      .map(
        ([k, i, l, n]) => `
      <div class="flex items-start gap-2.5 rounded-lg px-2.5 py-2 ${k === density ? "bg-foreground/6" : ""}">
        <i class="ph ${i} mt-0.5 shrink-0 text-[16px] text-muted-foreground"></i>
        <span class="min-w-0 flex-1"><span class="block text-sm">${l}</span><span class="block text-xs text-muted-foreground">${n}</span></span>
        ${k === density ? `<i class="ph ph-check mt-0.5 shrink-0 text-[14px]"></i>` : ""}
      </div>`,
      )
      .join("")}</div>
    <div class="-mx-1.5 my-1.5 h-px bg-border"></div>
    <div class="flex h-9 items-center justify-between px-2.5 text-sm">Group by day${toggle(byDay)}</div>
  </div>`;
};

/**
 * The projects over the chats (projects-section.tsx): a 32px heading, Projects with its
 * caret (folds the section, `open`) and + for a new project, then a 36px row per project
 * in its tint, 4px apart: its mark on a white tile, its name in its ink, the count of its
 * chats at the end. Past four, the rest fold under a "N more projects" row (five show
 * whole). `projects` defaults to PROJECTS.
 */
const projectsSection = ({ projects = PROJECTS, open = true } = {}) => {
  const isFolding = projects.length > 5;
  const shown = isFolding ? projects.slice(0, 4) : projects;
  return `
  <div class="px-2 pt-1 pb-2">
    <div class="flex h-8 items-center justify-between pr-0.5 pl-2">
      <span class="flex h-6 items-center gap-1 pr-1 text-xs font-medium text-muted-foreground">Projects<i class="ph ph-caret-down text-[12px] ${open ? "" : "-rotate-90"}"></i></span>
      <span class="grid size-6 place-items-center text-muted-foreground"><i class="ph ph-plus text-[14px]"></i></span>
    </div>
    ${
      open
        ? `<div class="flex flex-col gap-1">${shown
            .map(
              (t) => `
      <div class="flex h-9 items-center rounded-lg bg-(--project-tint-surface)/45" style="${projectTint(t.color)}">
        <span class="flex h-full min-w-0 flex-1 items-center gap-2.5 pl-1.5 text-sm font-medium text-(--project-tint-ink)"><span class="grid size-6 shrink-0 place-items-center rounded-md bg-background shadow-xs">${projectMark(t, "md", { plain: true }).replace("text-[10px]", "text-[13px]")}</span><span class="truncate">${t.name}</span></span>
        <span class="flex h-5 min-w-8 items-center justify-end pr-2.5 text-xs text-(--project-tint-ink)/70 tabular-nums">${t.count ?? ""}</span>
      </div>`,
            )
            .join("")}${isFolding ? `<div class="flex h-9 items-center gap-2.5 rounded-lg bg-foreground/4 pl-1.5 text-sm text-muted-foreground"><span class="grid size-6 place-items-center"><i class="ph ph-dots-three text-[16px]"></i></span>${projects.length - 4} more projects</div>` : ""}</div>`
        : ""
    }
  </div>`;
};

/**
 * The top of the list inside a project (project-banner.tsx), on the wash the column wears
 * then: the project's mark on a white 44px tile, its name in 20px semibold in its ink, the
 * start of its instructions, then Edit and Open in Files.
 */
const projectBanner = (project) => {
  const t = typeof project === "string" ? projectByName(project) : project;
  return `
  <div class="flex shrink-0 flex-col items-start px-4 pt-1 pb-4" style="${projectTint(t.color)}">
    <span class="grid size-11 place-items-center rounded-xl bg-background shadow-xs">${projectMark(t, "lg", { plain: true }).replace("size-11 rounded-xl", "size-7 rounded-xl")}</span>
    <h2 class="mt-3 max-w-full truncate text-xl font-semibold text-(--project-tint-ink)">${t.name}</h2>
    ${t.instructions ? `<p class="mt-1 line-clamp-3 text-[13px] leading-5 text-foreground/65">${t.instructions}</p>` : ""}
    <div class="mt-3 flex gap-1.5">${["Edit", "Open in Files"].map((l) => `<span class="flex h-7 items-center rounded-md bg-foreground/6 px-2.5 text-[13px] text-foreground/80">${l}</span>`).join("")}</div>
  </div>`;
};

/** A line over the rows after it (chat-list.tsx's ListHeading): Chats under the projects, a day, Outside this filter. */
const listHeading = (text) => `<p class="px-4 pt-3 pb-1.5 text-xs font-medium text-muted-foreground">${text}</p>`;

/** What a chat holds, on its row's third line: files as chips with their names (`bare`: their marks alone, as a two-line row has them), apps and sites as bare marks. Holds are {file}, {site} or {app} (a key of BRAND_URI). */
const holdMarks = (holds = [], { bare = false } = {}) =>
  holds
    .map((h) =>
      h.file && bare
        ? `<span class="grid size-4 shrink-0 place-items-center">${fileMark(FILES[h.file].kind, "text-[14px]")}</span>`
        : h.file
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
const ROW_ACTIONS = ["ph-cards-three", "ph-picture-in-picture", "ph-archive", "ph-notification", "ph-star"];

/** The agent's latest line (chat-row.tsx's Peek): the `step` shimmering while it works, `ask` behind a question mark while it waits, `failed` behind a red warning, else the `preview`. */
const peek = (r, search = "") =>
  r.working
    ? `<span class="truncate text-brand-600">${r.step || "Instrument is working"}</span>`
    : r.failed
      ? `<i class="ph ph-warning-circle shrink-0 text-[14px] text-error-700"></i><span class="truncate text-error-700">Stopped on an error</span>`
      : r.ask
        ? `<i class="ph ph-question shrink-0 text-[14px] text-foreground/80"></i><span class="truncate text-foreground/80">${r.ask}</span>`
        : `<span class="truncate text-muted-foreground">${matched(r.preview || "", search)}</span>`;

/**
 * An inbox row (chat-row.tsx). At `density` "three" (the default): the title (semibold
 * only while something in it is unseen, with "Draft" in red after it while a reply waits
 * unsent) and the time at the line's end, then a starred chat's star; the agent's latest
 * line (see `peek`); then the project's name in its ink (`project`, left out with
 * `noProject`, as inside that project's own list) and what it holds. "two" keeps the
 * title's line and puts the project there (or the latest line when it works, waits or has
 * none) with the holds' marks at the right; "one" is the title alone, the project just
 * before the time. An unread chat wears the rail's green dot in the gutter; at one line
 * the dot also pulses while it works and is grey while it waits. A hairline above every
 * row, under the last one too. `on` is the open row, the card's own white; `hover` is
 * halfway there, with the row's controls in place of the time and star. `search` marks
 * the words a search matched. `r` may be finished HTML.
 */
const row = (r, { on = false, last = false, hover = false, search = "", density = "three", noProject = false } = {}) => {
  if (typeof r === "string") return r;
  const proj = r.project && !noProject ? projectWords(r.project) : "";
  const end = hover
    ? `<span class="-my-0.5 ml-auto flex shrink-0 items-center gap-0.5 text-foreground/50">${ROW_ACTIONS.map((i) => `<span class="grid size-6 place-items-center"><i class="${i === "ph-star" && r.starred ? "ph text-warning-500" : "ph"} ${i} text-[16px]"></i></span>`).join("")}</span>`
    : `<span class="ml-auto flex shrink-0 items-center gap-1"><span class="shrink-0 text-right text-[11px] text-muted-foreground/70 tabular-nums ${r.unread ? "font-semibold" : ""}">${r.time || ""}</span>${r.starred ? `<span class="-my-0.5 grid size-6 shrink-0 place-items-center"><i class="ph ph-star text-[16px] text-warning-500"></i></span>` : ""}</span>`;
  const dot =
    density === "one" && r.ask ? "bg-foreground/70" : density === "one" && r.working ? "bg-brand-500 animate-pulse" : r.unread ? "bg-brand-500" : "";
  const busy = r.working || r.ask || r.failed;
  return `
  <div class="relative flex items-start gap-2 border-t border-border/70 bg-clip-padding px-4 py-2.5 ${last ? "border-b" : ""} ${on ? (noProject ? "bg-card/65" : "bg-card") : hover ? "bg-card/50" : ""}">
    <div class="min-w-0 flex-1">
      <div class="flex h-5 items-center gap-1.5">
        <span class="min-w-0 truncate text-[13px] leading-5 tracking-[-0.005em] ${r.unread ? "font-semibold text-foreground" : "font-medium text-foreground/85"}">${matched(r.title, search)}</span>
        ${r.draft ? `<span class="shrink-0 text-[13px] text-error-700">Draft</span>` : ""}
        ${density === "one" && proj && !hover ? `<span class="flex shrink-0 grow justify-end pl-1">${proj}</span>` : ""}
        ${end}
      </div>
      ${
        density === "three"
          ? `<div class="flex h-5 min-w-0 items-center gap-1.5 text-[12px] leading-5">${peek(r, search)}</div>
      <div class="mt-1 flex h-5 min-w-0 items-center gap-2">${proj}<span class="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">${holdMarks(r.holds)}</span></div>`
          : density === "two"
            ? `<div class="flex h-5 min-w-0 items-center gap-2"><span class="flex min-w-0 flex-1 items-center gap-1.5 text-[12px] leading-5">${busy || !proj ? peek(r, search) : proj}</span>${r.holds?.length ? `<span class="flex max-w-[45%] shrink-0 items-center justify-end gap-1 overflow-hidden">${holdMarks(r.holds, { bare: true })}</span>` : ""}</div>`
            : ""
      }
    </div>
    ${dot ? `<span class="absolute top-4.5 left-1.5 size-1.5 rounded-full ${dot}"></span>` : ""}
  </div>`;
};

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
 * The inbox column (chat-pane.tsx): head, then the list, on the card's grey with a faint
 * line at its right edge. In the Inbox with nothing searched, the projects (`projects`,
 * PROJECTS by default; `[]` for none, which also drops the Chats heading) sit over the
 * chats under a "Chats" heading. `on` is the open row's index (-1 for none), `hover` the
 * row under the pointer. `place` stands it in Drafts or Archived; `drafts` ([{ title,
 * time, holds }]) stands it in Drafts and lists those. `project` (a PROJECTS name) steps
 * into a project: its tint washes down from the top, its banner heads the list, and rows
 * leave its name off. `search` and `tokens` (keys of TOKENS) narrow the list and put the
 * projects away; `focus` draws the search clicked into, `offer` with its Show only menu
 * (keys of TOKENS). `density` (three, two, one) and `byDay` (a heading per day, given as
 * `day` on the rows) are the view button's, `picking` draws that button pressed (pair it
 * with viewMenu). `empty` is the line an empty list says (with `rows: []`). `rows` may
 * mix row objects and finished HTML, and `before` puts HTML (a proposal's own rows) over
 * them.
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
  tokens = [],
  focus = false,
  offer,
  density = "three",
  byDay = false,
  projects = PROJECTS,
  empty,
  picking = false,
  before = "",
} = {}) => {
  const where = drafts ? "drafts" : place;
  const t = project ? projectByName(project) : null;
  const narrowed = Boolean(search || tokens.length);
  const showProjects = !t && !where && !narrowed && projects.length > 0;
  const line =
    empty ??
    (search
      ? `No chats match “${search}”`
      : where === "drafts"
        ? "You don't have any drafts right now"
        : tokens.includes("unread")
          ? "You're all caught up"
          : tokens.includes("starred")
            ? "Chats you star will show up here"
            : where === "archived"
              ? "Chats you archive will show up here"
              : t
                ? `Chats you file under ${t.name} will show up here`
                : "Press New to start a chat");
  let lastDay;
  const listed = drafts
    ? drafts.map((d, i) => draftRow(d, { last: i === drafts.length - 1 })).join("")
    : rows
        .map((r, i) => {
          const day = byDay && typeof r === "object" && r.day && r.day !== lastDay ? listHeading(r.day) : "";
          if (day) lastDay = r.day;
          return day + row(r, { on: i === on, hover: i === hover && i !== on, last: i === rows.length - 1, search, density, noProject: Boolean(t) });
        })
        .join("");
  const isEmpty = (drafts ?? rows).length === 0 && !before;
  return `
  <div class="relative isolate flex shrink-0 flex-col bg-background pr-px after:absolute after:inset-y-0 after:right-0 after:w-px after:bg-border/70" style="width:${w}px;${t ? projectTint(t.color) : ""}">
    ${t ? `<div class="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[calc(20%+14rem)] bg-linear-to-b from-(--project-tint-surface)/50 to-transparent"></div>` : ""}
    ${inboxHead({ place: where, project, search, tokens, focus, offer, open: picking, density })}
    ${
      isEmpty
        ? `${t ? projectBanner(t) : ""}<div class="grid flex-1 place-items-center px-8 pb-16"><div class="flex flex-col items-center text-center text-[13px]"><span class="mb-3 grid size-11 place-items-center rounded-xl text-muted-foreground/30 inset-ring inset-ring-current/60"><i class="ph ph-chat-circle text-[24px]"></i></span><p class="max-w-56 leading-5 text-balance text-muted-foreground/60">${line}</p></div></div>`
        : `<div class="flex flex-col">${t ? projectBanner(t) : ""}${showProjects ? projectsSection({ projects }) + (byDay && !drafts ? "" : listHeading("Chats")) : ""}${before}${listed}</div>`
    }
  </div>`;
};

/** Safari's New Tab mark, as the app draws it (new-tab-icon.tsx). */
const NEW_TAB_ICON = `<svg class="size-4 shrink-0 text-muted-foreground" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16" viewBox="0 0 256 256"><path d="M168 68V56a24 24 0 0 0-24-24H56a24 24 0 0 0-24 24v88a24 24 0 0 0 24 24h12"/><rect height="136" rx="24" width="136" x="88" y="88"/><path d="M156 124v64M124 156h64"/></svg>`;

/** A chat's menu (chat-row.tsx's right click), as built. `starred` and `unread` flip their rows; `archived` offers Unarchive. */
const chatMenu = ({ left = 120, top = 140, starred = false, unread = false, archived = false } = {}) =>
  menu(
    [
      { label: "Open" },
      { icon: NEW_TAB_ICON, label: "Open in New Tab" },
      { icon: "app-window", label: "Open in New Window" },
      { icon: "picture-in-picture", label: "Pop Out" },
      "rule",
      { icon: "notification", label: unread ? "Mark as read" : "Mark as unread" },
      { icon: "star", label: starred ? "Unstar" : "Star" },
      "rule",
      { icon: "pencil-simple", label: "Rename" },
      { icon: "cards-three", label: "Project", sub: true },
      "rule",
      { icon: "folder-simple", label: "Open in Files" },
      "rule",
      { icon: "chat-text", label: "Send feedback…" },
      "rule",
      { icon: archived ? "arrow-counter-clockwise" : "archive", label: archived ? "Unarchive" : "Archive" },
      "rule",
      { icon: "trash", label: "Delete chat…", danger: true },
    ],
    { left, top, w: 220 },
  );
