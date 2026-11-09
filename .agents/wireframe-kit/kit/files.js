// ---- Files ------------------------------------------------------------------------
// The Files place (files-screen.tsx, extend/file-system.tsx), re-measured 2026-11-07 at
// 1280x800. Files' row is the 44px location row and there is no header: the sidebar
// toggle over the 175px places, the four views (Grid, Table, Columns, List) in a grey
// well with the one shown raised white, then sort, more and search framed the way the
// row frames every control (TOOL_SURFACE, omnibar.js), the omnibar's grey field across
// the rest, then Ask. A file opens beside its folder, the folder narrowed to a 300px
// column of its own. Rows are 24px in Table, stripes running down the whole pane; the
// picked row is filled in brand-500, and the Instrument folder's mark is teal.

/** The views as Files names them, in its picker's order: [key, label, icon]. */
const FILE_VIEWS = [
  ["icons", "Grid", "grid-four"],
  ["table", "Table", "list-bullets"],
  ["columns", "Columns", "columns"],
  ["list", "List", "rows"],
];

/** The view picker (VIEW_TAB_CLASSNAME): a grey well with the four views, the one shown raised in the card's white. `extra` adds views a proposal brings, as [key, label, icon]. */
const filesViews = (view = "table", extra = []) =>
  `<span class="flex h-8 shrink-0 items-center rounded-xl bg-foreground/8 p-0.5">${[...FILE_VIEWS, ...extra]
    .map(
      ([k, , i]) =>
        `<span class="grid h-7 w-9 place-items-center rounded-lg ${k === view ? "bg-card text-foreground shadow-xs" : "text-muted-foreground"}"><i class="ph ph-${i} text-[16px]"></i></span>`,
    )
    .join("")}</span>`;

/** A framed 32px control on the row (TOOL_SURFACE), as Files draws sort, more and search. */
const filesBtn = (inner) =>
  `<span class="flex min-w-8 shrink-0 items-center justify-center gap-1 px-1.5 ${TOOL_SURFACE}">${inner}</span>`;

/**
 * Files' one 40px row (files-screen.tsx): over the places (`side`, or folded) the sidebar
 * toggle; then the views, sort, more and search; the omnibar across the rest (`crumbs`
 * the folder's path, `fold` the crumbs folded into ···, `omni` any other omnibar
 * option: focus, typed); then Ask. `search` (the words, or true for an empty field)
 * draws the search open: a ringed field in place of the views and buttons. `narrow`
 * drops Ask's word and the sort caret, for a pane.
 */
const filesRow = ({
  crumbs = ["mac-user", "Instrument"],
  fold = 0,
  view = "table",
  side = true,
  narrow = false,
  search,
  omni = {},
} = {}) => `
  <div class="flex h-11 shrink-0 items-center gap-1.5 border-b border-border pr-1.5">
    <div class="flex h-full shrink-0 items-center ${side ? "w-[175px] border-r border-border" : ""} px-1.5"><span class="grid size-8 place-items-center rounded-md text-foreground/70"><i class="ph ph-sidebar-simple text-[16px]"></i></span></div>
    ${
      search !== undefined && search !== false
        ? `<span class="flex w-56 shrink-0 items-center gap-1 pr-2 pl-2 text-sm text-foreground ${TOOL_SURFACE} ring-2 ring-foreground/30"><i class="ph ph-magnifying-glass text-[14px] text-muted-foreground"></i><span class="min-w-0 flex-1 truncate ${search === true ? "text-muted-foreground" : ""}">${search === true ? "Search" : search}</span>${search === true ? "" : `<i class="ph ph-x text-[12px] text-muted-foreground"></i>`}</span>`
        : `${filesViews(view)}${filesBtn(`<i class="ph ph-arrows-down-up text-[16px]"></i>${narrow ? "" : `<i class="ph ph-caret-down text-[10px] text-muted-foreground"></i>`}`)}${filesBtn(`<i class="ph ph-dots-three text-[16px]"></i>`)}${filesBtn(`<i class="ph ph-magnifying-glass text-[16px]"></i>`)}`
    }
    ${omnibar({ folder: crumbs[crumbs.length - 1] }, { crumbs, fold, ...omni })}
    ${askFramed(!narrow)}
  </div>`;

/**
 * The 175px places (sidebar-places.ts): Recents and the Instrument folder in its teal,
 * then Pinned (the home folder and the folders the person pinned, `places`), then
 * Locations (This Mac, iCloud Drive, the disks). `on` is the place shown; `starred` adds
 * a Starred place over Recents.
 */
const finderSidebar = ({
  on = "Instrument",
  starred = false,
  places = ["mac-user", "Desktop", "Documents", "Downloads"],
  disks = ["Macintosh HD"],
} = {}) => {
  const item = (icon, name) =>
    `<div class="flex h-7 items-center gap-2 rounded-lg px-2 ${name === on ? "bg-foreground/8" : ""}">${icon}<span class="truncate">${name}</span></div>`;
  const icon = (i) => `<i class="ph ph-${i} shrink-0 text-[15px] text-muted-foreground"></i>`;
  const placeIcon = (n) => (n === "mac-user" ? icon("house") : fileMark("folder", "text-[15px]"));
  return `
  <div class="w-[175px] shrink-0 border-r border-border px-2 pt-2 text-[13px]">
    ${starred ? item(icon("star"), "Starred") : ""}
    ${item(icon("clock-counter-clockwise"), "Recents")}
    ${item(fileMark("output", "text-[15px]"), "Instrument")}
    <div class="px-2 pt-3 pb-1 text-[12px] text-muted-foreground">Pinned</div>
    ${places.map((n) => item(placeIcon(n), n)).join("")}
    <div class="px-2 pt-3 pb-1 text-[12px] text-muted-foreground">Locations</div>
    ${item(icon("desktop"), "This Mac")}
    ${item(icon("cloud"), "iCloud Drive")}
    ${disks.map((d) => item(icon("hard-drive"), d)).join("")}
  </div>`;
};

/** A row's fill: the picked one in brand-500 with white ink, else every other row a faint stripe. */
const rowFill = (i, pick) => (i === pick ? "bg-brand-500 text-white" : i % 2 ? "bg-foreground/[0.035]" : "");

/** Empty stripes running on down the pane under a listing, the way Table draws its rows to the foot. */
const stripes = (from, count, h = "h-6") =>
  Array.from({ length: count }, (_, j) => `<div class="mx-1 ${h} rounded-md ${(from + j) % 2 ? "bg-foreground/[0.035]" : ""}"></div>`).join("");

/**
 * Table: Name, Date Modified, Size and Kind over 24px striped rows, a folder led by its
 * disclosure caret, the stripes running to the pane's foot (`fill` rows of them).
 * Rows are [kind, name, modified, size] (FOLDER_ROWS); `pick` is the picked row, `cols`
 * false keeps only Name, for a narrow pane.
 */
const finderTable = (rows = FOLDER_ROWS, { pick = -1, cols = true, fill = 18 } = {}) => {
  const tpl = cols ? "1fr 176px 90px 140px" : "1fr";
  return `
  <div class="text-[13px]">
    <div class="grid h-7 items-center border-b border-border px-3 text-[12px] text-muted-foreground" style="grid-template-columns:${tpl}"><span class="pl-6 font-medium text-foreground">Name <i class="ph ph-caret-up text-[9px]"></i></span>${cols ? `<span class="border-l border-border pl-2">Date Modified</span><span class="border-l border-border pr-2 text-right">Size</span><span class="border-l border-border pl-2">Kind</span>` : ""}</div>
    <div class="pt-0.5">
    ${rows
      .map(([k, n, d, sz], i) => {
        const dim = i === pick ? "" : "text-muted-foreground";
        return `<div class="mx-1 grid h-6 items-center rounded-md px-2 ${rowFill(i, pick)}" style="grid-template-columns:${tpl}"><span class="flex min-w-0 items-center gap-1.5">${k === "folder" ? `<i class="ph ph-caret-right w-3 text-[10px] ${dim}"></i>` : `<span class="w-3"></span>`}${fileMark(k)}<span class="truncate">${n}</span></span>${cols ? `<span class="${dim}">${d}</span><span class="pr-2 text-right ${dim}">${sz}</span><span class="truncate pl-2 ${dim}">${KIND_TEXT[k]}</span>` : ""}</div>`;
      })
      .join("")}
    ${stripes(rows.length, fill)}
    </div>
  </div>`;
};

/** A file's picture on a small white page: the page itself where the kit has one (PAGES), else grey bars. `w` is the page's width in px, 3:4. */
const fileThumb = (name, { w = 30 } = {}) => {
  const key = Object.keys(FILES).find((k) => FILES[k].title === name);
  const h = Math.round((w * 4) / 3);
  const inner =
    key && PAGES[key]
      ? `<div class="absolute top-0 left-0 origin-top-left" style="width:400px;height:533px;transform:scale(${w / 400})">${PAGES[key]()}</div>`
      : `<div class="space-y-[2px] p-[3px]">${["70%", "45%", "60%"].map((x) => `<div class="h-px bg-gray-300" style="width:${x}"></div>`).join("")}</div>`;
  return `<span class="relative block shrink-0 overflow-hidden rounded-[2px] bg-white shadow-xs ring-1 ring-black/10" style="width:${w}px;height:${h}px">${inner}</span>`;
};

/**
 * List: a 52px row per item, a folder's big mark and name, a file's picture with its title
 * over its mark and name (a file with no title says its name over its kind), and the
 * modified time at the right, striped and rounded like Table's rows.
 */
const finderList = (rows = FOLDER_ROWS, { pick = -1 } = {}) => `
  <div class="flex flex-col gap-0.5 p-1 text-[13px]">
    ${rows
      .map(([k, n, d, , title], i) => {
        const dim = i === pick ? "text-white/80" : "text-muted-foreground";
        const face =
          k === "folder"
            ? `<span class="grid w-[30px] shrink-0 place-items-center">${fileMark("folder", "text-[28px]")}</span><span class="min-w-0 flex-1 truncate text-[14px]">${n}</span>`
            : `${fileThumb(n)}<span class="flex min-w-0 flex-1 flex-col"><span class="truncate text-[14px]">${title || n}</span><span class="flex items-center gap-1 text-[12px] ${dim}">${fileMark(k, "text-[12px]")}<span class="truncate">${title ? n : KIND_TEXT[k]}</span></span></span>`;
        return `<div class="flex h-[50px] items-center gap-3 rounded-md px-2 ${rowFill(i, pick)}">${face}<span class="shrink-0 text-[13px] ${dim}">${d}</span></div>`;
      })
      .join("")}
  </div>`;

/** Grid: a tile per item, the folder's mark or the file's picture over its name in two lines. */
const finderGrid = (rows = FOLDER_ROWS, { pick = -1 } = {}) => `
  <div class="flex flex-wrap content-start gap-x-1 gap-y-3 p-3 text-[12px]">
    ${rows
      .map(
        ([k, n], i) =>
          `<div class="flex w-[107px] flex-col items-center gap-1.5 text-center"><span class="grid h-[68px] w-[84px] place-items-center rounded-lg ${i === pick ? "bg-foreground/8 ring-2 ring-foreground/15" : ""}">${k === "folder" ? fileMark("folder", "text-[58px]") : fileThumb(n, { w: 48 })}</span><span class="line-clamp-2 max-w-full rounded px-1 leading-4 break-words ${i === pick ? "bg-brand-500 text-white" : ""}">${n}</span></div>`,
      )
      .join("")}
  </div>`;

/**
 * Columns: a 240px column per folder along the path, 28px rows, a folder's chevron at its
 * end; `cols` are [{ rows, pick }] (rows as FOLDER_ROWS'), and `preview` puts a file's
 * picture and Information after the last column.
 */
const finderColumns = (cols = [{ rows: FOLDER_ROWS }], { preview = "" } = {}) => `
  <div class="flex h-full text-[13px]">
    ${cols
      .map(
        ({ rows, pick = -1 }) => `
      <div class="w-[240px] shrink-0 border-r border-border p-1">${rows
        .map(
          ([k, n], i) =>
            `<div class="flex h-7 items-center gap-2 rounded-md px-2 ${i === pick ? "bg-brand-500 text-white" : ""}">${fileMark(k, "text-[14px]")}<span class="min-w-0 flex-1 truncate">${n}</span>${k === "folder" ? `<i class="ph ph-caret-right text-[11px] ${i === pick ? "" : "text-muted-foreground"}"></i>` : ""}</div>`,
        )
        .join("")}</div>`,
      )
      .join("")}
    ${preview ? `<div class="flex min-w-0 flex-1 flex-col items-center px-8 pt-4 text-center">${fileThumb(preview, { w: 300 })}<div class="mt-4 text-[14px] font-medium">${preview}</div><div class="text-[12px] text-muted-foreground">${KIND_TEXT[(FOLDER_ROWS.find((r) => r[1] === preview) || ["html"])[0]]} - 40 KB</div><div class="mt-5 w-full max-w-[580px] border-t border-border pt-3 text-left text-[12px]"><div class="mb-1 font-medium">Information</div><div class="flex justify-between text-muted-foreground"><span>Created</span><span>Oct 31, 2026 at 9:52 AM</span></div><div class="flex justify-between text-muted-foreground"><span>Modified</span><span>Today at 9:58 AM</span></div></div></div>` : ""}
  </div>`;

/** The count Files shows under a listing, on a 24px foot: how many, or how many of them are picked. */
const filesFoot = (n, { picked = 0 } = {}) =>
  `<div class="flex h-6 shrink-0 items-center justify-center border-t border-border text-[11px] text-muted-foreground">${picked ? `${picked} of ${n} selected` : `${n} ${n === 1 ? "item" : "items"}`}</div>`;

/** Files filling the card: its row, then `side` (finderSidebar, or nothing when folded), then `head` over `body` over `foot`. */
const filesPlace = ({
  top = filesRow(),
  side = finderSidebar(),
  head = "",
  body = "",
  foot = "",
} = {}) => `
  <div class="flex min-w-0 flex-1 flex-col">
    ${top}
    <div class="flex min-h-0 flex-1">
      ${side}
      <div class="relative flex min-w-0 flex-1 flex-col">${head}<div class="relative min-h-0 flex-1 overflow-hidden">${body}</div>${foot}</div>
    </div>
  </div>`;

/**
 * Files open on the Instrument folder, as built: `view` (icons | table | columns |
 * list), `pick` a row picked, `side` false folds the places, `search` opens the search
 * (see filesRow), `omni` the omnibar's options, `rows` another folder's rows.
 */
const finder = ({ view = "table", pick = -1, side = true, search, omni = {}, rows = FOLDER_ROWS, crumbs = ["mac-user", "Instrument"] } = {}) =>
  filesPlace({
    top: filesRow({ crumbs, view, side, search, omni }),
    side: side ? finderSidebar({ on: crumbs[crumbs.length - 1] }) : "",
    body:
      view === "list"
        ? finderList(rows, { pick })
        : view === "icons"
          ? finderGrid(rows, { pick })
          : view === "columns"
            ? finderColumns([{ rows, pick }], { preview: pick >= 0 && rows[pick][0] !== "folder" ? rows[pick][1] : "" })
            : finderTable(rows, { pick }),
    foot: filesFoot(rows.length, { picked: pick >= 0 ? 1 : 0 }),
  });

/** The sort menu (Sort by, Group by, Show hidden files), hung from the sort button. */
const sortMenu = ({ sort = "Name", group = "None", left = 282, top = 88 } = {}) =>
  menu(
    [
      { head: "Sort by" },
      ...["Name", "Kind", "Date created", "Date modified", "Size"].map((l) => ({ label: l, dot: l === sort })),
      "rule",
      { head: "Group by" },
      ...["None", "Kind", "Date modified", "Date created", "Size"].map((l) => ({ label: l, dot: l === group })),
      "rule",
      { label: "Show hidden files" },
    ],
    { left, top, w: 176 },
  );

/** The search's Show only menu: the kinds the folder has, each with its mark. */
const kindMenu = ({ kinds = ["folder", "html", "md", "csv"], left = 256, top = 88 } = {}) =>
  menu([{ head: "Show only" }, ...kinds.map((k) => ({ icon: fileMark(k, "text-[14px]"), label: k === "folder" ? "Folder" : KIND_TEXT[k] }))], { left, top, w: 226 });

/**
 * A file open beside its folder (files-screen.tsx), as built: the folder narrowed to a
 * 300px column (`view` table: Name and Modified over striped rows; icons: two columns of
 * pictures), the picked file in brand-500, and its count at the column's foot; the row
 * split at the column's edge, the folder's name as a menu, the view and sort menus and
 * search over the folder, then the fold toggle and reload, the file's omnibar, Viewing
 * (or Editing), Ask, more and × over the file. `rows` are FOLDER_ROWS-shaped; `pick` the
 * open file's index; `file` a FILES key or a tab for the body; `crumbs` the omnibar's
 * path; `fold` folds its crumbs; `folded` hides the column; `editing` lights Editing.
 */
const fileBeside = ({
  folder = "Instrument",
  rows = FOLDER_ROWS,
  pick = 6,
  view = "table",
  file = "comparison",
  crumbs,
  fold = 0,
  w = 300,
  folded = false,
  close = true,
  editing = false,
  body,
} = {}) => {
  const f = FILES[file] ? { file } : file;
  const path = crumbs ?? ["mac-user", folder, tabTitle(f)];
  const ico = (i) => filesBtn(`<i class="ph ${i} text-[16px]"></i><i class="ph ph-caret-down text-[10px] text-muted-foreground"></i>`);
  const btn = (i) => `<span class="grid size-8 shrink-0 place-items-center rounded-md text-foreground/70"><i class="ph ph-${i} text-[16px]"></i></span>`;
  const list = `<div class="grid h-7 grid-cols-[1fr_80px] items-center border-b border-border px-3 text-[12px] text-muted-foreground"><span class="pl-4 font-medium text-foreground">Name <i class="ph ph-caret-up text-[9px]"></i></span><span class="border-l border-border pl-2">Modified</span></div><div class="pt-0.5">${rows
    .map(
      ([k, n, d], i) =>
        `<div class="mx-1 grid h-6 grid-cols-[1fr_72px] items-center rounded-md px-2 ${rowFill(i, pick)}"><span class="flex min-w-0 items-center gap-1.5">${k === "folder" ? `<i class="ph ph-caret-right w-3 text-[10px] ${i === pick ? "" : "text-muted-foreground"}"></i>` : `<span class="w-3"></span>`}${fileMark(k)}<span class="truncate">${n}</span></span><span class="${i === pick ? "" : "text-muted-foreground"}">${(d || "").replace(/^.* at /, "")}</span></div>`,
    )
    .join("")}${stripes(rows.length, 18)}</div>`;
  const grid = `<div class="grid grid-cols-2 gap-x-2 gap-y-3 p-3">${rows
    .map(
      ([k, n], i) =>
        `<div class="flex flex-col items-center gap-1.5 text-center"><span class="grid h-16 w-14 place-items-center">${k === "folder" ? fileMark("folder", "text-[52px]") : fileThumb(n, { w: 44 })}</span><span class="line-clamp-2 max-w-full rounded px-1 text-[12px] leading-4 break-words ${i === pick ? "bg-brand-500 text-white" : ""}">${n}</span></div>`,
    )
    .join("")}</div>`;
  return `
  <div class="flex min-w-0 flex-1 flex-col">
    <div class="flex h-11 shrink-0 items-center border-b border-border">
      ${
        folded
          ? ""
          : `<div class="flex h-full shrink-0 items-center gap-1.5 border-r border-border px-1.5" style="width:${w}px"><span class="flex h-7 min-w-0 items-center gap-1.5 rounded-md px-1.5 text-[13px] font-medium">${fileMark("folder", "text-[15px]")}<span class="truncate">${folder}</span><i class="ph ph-caret-down text-[10px] text-muted-foreground"></i></span><span class="flex-1"></span>${ico(view === "icons" ? "ph-grid-four" : "ph-list-bullets")}${ico("ph-arrows-down-up")}${filesBtn(`<i class="ph ph-magnifying-glass text-[16px]"></i>`)}</div>`
      }
      <div class="flex min-w-0 flex-1 items-center gap-1.5 px-1.5">
        ${btn("sidebar-simple")}${toolGroup(toolGlyph("arrow-clockwise"))}
        ${omnibar(f, { crumbs: path, fold })}
        <span class="flex h-7 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-[13px] ${editing ? "bg-foreground text-background" : "text-muted-foreground"}"><i class="ph ph-${editing ? "pencil-simple" : "eye"} text-[15px]"></i>${editing ? "Editing" : "Viewing"}<i class="ph ph-caret-down text-[10px]"></i></span>
        ${askFramed(true)}${toolIcon("dots-three-vertical")}${close ? btn("x") : ""}
      </div>
    </div>
    <div class="flex min-h-0 flex-1">
      ${folded ? "" : `<div class="flex shrink-0 flex-col border-r border-border text-[13px]" style="width:${w}px"><div class="min-h-0 flex-1 overflow-hidden">${view === "icons" ? grid : list}</div>${filesFoot(rows.length, { picked: pick >= 0 ? 1 : 0 })}</div>`}
      <div class="relative min-w-0 flex-1 overflow-hidden bg-white">${body ?? page(f)}</div>
    </div>
  </div>`;
};
