// Files, measured off the documents fixture (2026-10-10) at 1240x840. The card opens on
// a 40px top row: the sidebar toggle, the omnibar centered across the card (640 wide)
// ending in the pill that opens what is shown in its Mac app, and the open file's
// own controls at the right. Under it a folder gets the 175px sidebar of places and the
// Finder's 48px header; a file gets the 240px tree of its folder in place of the places.


const toolBtn = (inner, cls = "") =>
  `<span class="flex h-8 min-w-8 shrink-0 items-center justify-center gap-1 rounded-lg bg-card px-2 text-muted-foreground ring-1 ring-border ${cls}">${inner}</span>`;

/** Files' top row. `mark` leads the omnibar (a folder, or the open file's type), `crumbs` are its path, `open` the kind whose Mac app the open-in pill at its end wears (openIn), `right` the open file's controls (fileActions). */
const filesTop = ({
  crumbs = ["mac-user"],
  mark = fileMark("folder", "text-[15px]"),
  open = "folder",
  right = "",
  left = "",
} = {}) => `
  <div class="grid h-10 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2 border-b border-border px-2">
    <div class="flex items-center gap-1"><span class="grid size-8 place-items-center rounded-lg text-muted-foreground"><i class="ph ph-sidebar-simple text-[17px]"></i></span>${left}</div>
    <div class="flex h-8 w-[640px] min-w-0 items-center gap-2 rounded-full border border-border bg-card px-3 text-[13px] shadow-xs">
      ${mark}${crumbs.map((c, i) => `<span class="truncate ${i === crumbs.length - 1 ? "text-foreground" : "text-muted-foreground"}">${c}</span>`).join(`<i class="ph ph-caret-right text-[10px] text-muted-foreground"></i>`)}
      <span class="flex-1"></span>${openIn(open)}
    </div>
    <div class="flex items-center justify-end gap-1">${right}</div>
  </div>`;

/** The open file's controls in the top row: Viewing (or Editing), Ask and its menu. A file filling a window tab has no Expand; `expand` draws it for one that does not. */
const fileActions = ({ editing = false, ask = "Ask", expand = false } = {}) => `
  <span class="flex h-8 items-center gap-1.5 rounded-lg px-2 text-[13px] ${editing ? "bg-foreground text-background" : "text-muted-foreground"}"><i class="ph ph-${editing ? "pencil-simple" : "eye"} text-[15px]"></i>${editing ? "Editing" : "Viewing"}<i class="ph ph-caret-down text-[10px]"></i></span>
  <span class="flex h-8 items-center gap-1.5 rounded-lg px-2 text-[13px] font-medium">${brand("instrumentglyph", "size-4")}${ask}</span>
  <span class="grid size-8 place-items-center text-muted-foreground"><i class="ph ph-dots-three-vertical text-[16px]"></i></span>
  ${expand ? `<span class="grid size-8 place-items-center text-muted-foreground"><i class="ph ph-arrows-out-simple text-[15px]"></i></span>` : ""}`;

/** The Finder's sidebar of places: Recents and the Instrument folder, then the folders the person pinned (`places`) and the Locations. `starred` adds a Starred place over Recents. */
const finderSidebar = ({
  on = "mac-user",
  starred = false,
  places = ["mac-user", "Desktop", "Documents", "Downloads"],
} = {}) => {
  const item = (icon, name) =>
    `<div class="flex h-7 items-center gap-2 rounded-lg px-2 ${name === on ? "bg-foreground/8" : ""}">${icon}<span class="truncate">${name}</span></div>`;
  const placeIcon = (n) =>
    n === "Instrument"
      ? fileMark(
          "folder",
          "text-[15px] [&_path:first-child]:fill-[#5fae9c] [&_path:last-child]:stroke-[#3f9d8a]",
        )
      : n === "mac-user"
        ? `<i class="ph ph-house shrink-0 text-[15px] text-muted-foreground"></i>`
        : fileMark("folder", "text-[15px]");
  return `
  <div class="w-[175px] shrink-0 border-r border-border px-2 pt-2 text-[13px]">
    ${starred ? item(`<i class="ph ph-star shrink-0 text-[15px] text-muted-foreground"></i>`, "Starred") : ""}
    ${item(`<i class="ph ph-clock-counter-clockwise shrink-0 text-[15px] text-muted-foreground"></i>`, "Recents")}
    ${item(placeIcon("Instrument"), "Instrument")}
    <div class="px-2 pt-3 pb-1 text-[12px] text-muted-foreground">Pinned</div>
    ${places.map((n) => item(placeIcon(n), n)).join("")}
    <div class="px-2 pt-3 pb-1 text-[12px] text-muted-foreground">Locations</div>
    ${item(`<i class="ph ph-cloud shrink-0 text-[15px] text-muted-foreground"></i>`, "iCloud Drive")}
    ${item(`<i class="ph ph-hard-drive shrink-0 text-[15px] text-muted-foreground"></i>`, "Macintosh HD")}
  </div>`;
};

/** The view picker: Grid, List, Columns, and any `extra` views a proposal adds as [key, icon]. */
const finderViews = (view = "columns", extra = []) =>
  `<span class="flex h-8 items-center rounded-lg bg-foreground/8 p-0.5">${[["icons", "ph-squares-four"], ["list", "ph-rows"], ["columns", "ph-columns"], ...extra].map(([k, i]) => `<span class="grid h-7 w-8 place-items-center rounded-md ${k === view ? "bg-background text-foreground shadow-xs" : "text-muted-foreground"}"><i class="ph ${i} text-[15px]"></i></span>`).join("")}</span>`;

/** The Finder's 48px header: the folder's name, then Ask, the views, sort, filter, more and search. */
const finderHeader = ({
  title = "mac-user",
  views = finderViews(),
  ask = "Ask",
} = {}) => `
  <div class="flex h-12 shrink-0 items-center gap-1.5 border-b border-border px-3">
    <span class="min-w-0 flex-1 truncate text-[15px] font-semibold">${title}</span>
    ${toolBtn(`${brand("instrumentglyph", "size-4")}<span class="text-[13px] font-medium text-foreground">${ask}</span>`, "px-2.5")}
    ${views}
    ${toolBtn(`<i class="ph ph-arrows-down-up text-[15px]"></i><i class="ph ph-caret-down text-[9px]"></i>`)}
    ${toolBtn(`<i class="ph ph-funnel-simple text-[15px]"></i>`)}
    ${toolBtn(`<i class="ph ph-dots-three text-[15px]"></i>`)}
    ${toolBtn(`<i class="ph ph-magnifying-glass text-[15px]"></i>`)}
  </div>`;

/** The Finder's list view: Name, Date Modified, Size and Kind over 24px striped rows, a folder led by its disclosure caret, the picked row filled in the brand color. Rows are [kind, name, modified, size, kindText]. `cols` false keeps only Name, for a narrow pane. */
const finderListView = (rows, { pick = -1, cols = true } = {}) => {
  const tpl = cols ? "1fr 170px 70px 150px" : "1fr";
  return `
  <div class="text-[13px]">
    <div class="grid h-7 items-center border-b border-border px-3 text-[12px] text-muted-foreground" style="grid-template-columns:${tpl}"><span class="pl-6 font-medium text-foreground">Name <i class="ph ph-caret-up text-[9px]"></i></span>${cols ? `<span class="border-l border-border pl-2">Date Modified</span><span class="border-l border-border pr-2 text-right">Size</span><span class="border-l border-border pl-3">Kind</span>` : ""}</div>
    ${rows.map(([k, n, d, sz, kt], i) => `<div class="mx-1 grid h-6 items-center rounded-md px-2 ${i === pick ? "bg-brand-600 text-white" : i % 2 ? "bg-foreground/[0.03]" : ""}" style="grid-template-columns:${tpl}"><span class="flex min-w-0 items-center gap-1.5">${k === "folder" ? `<i class="ph ph-caret-right w-3 text-[10px] ${i === pick ? "" : "text-muted-foreground"}"></i>` : `<span class="w-3"></span>`}${fileMark(k)}<span class="truncate">${n}</span></span>${cols ? `<span class="${i === pick ? "" : "text-muted-foreground"}">${d}</span><span class="text-right ${i === pick ? "" : "text-muted-foreground"}">${sz}</span><span class="truncate pl-3 ${i === pick ? "" : "text-muted-foreground"}">${kt}</span>` : ""}</div>`).join("")}
  </div>`;
};

/** A file's folder as the tree beside it: 240px, 24px rows, the open file in the brand color. Rows are [depth, kind, name]. */
const fileTree = (rows, { on = "" } = {}) => `
  <div class="w-[240px] shrink-0 overflow-hidden border-r border-border px-1.5 py-1 text-[13px]">
    ${rows.map(([d, k, n]) => `<div class="flex h-6 items-center gap-1.5 rounded-md pr-2 ${n === on ? "bg-brand-600 text-white" : ""}" style="padding-left:${8 + d * 16}px">${k === "folder" ? `<i class="ph ph-caret-${d === 0 ? "down" : "right"} text-[10px] ${n === on ? "" : "text-muted-foreground"}"></i>` : `<span class="w-2.5"></span>`}${fileMark(k)}<span class="truncate">${n}</span></div>`).join("")}
  </div>`;

/**
 * Files' one 40px row, as main draws it (measured 2026-10-27): over the places (`side`,
 * 175px, or folded) the sidebar toggle; then the views, and sort, more and search as
 * 32px buttons on the card's white with a hairline ring; then the
 * omnibar across the rest, a folder (or `mark`) leading the path and the open-in pill at
 * its end; then Ask, a ringed button like the others. There is no header under it. `narrow` drops Ask's word and the sort
 * caret, for a pane.
 */
const filesRow = ({
  crumbs = ["mac-user"],
  mark = fileMark("folder", "text-[15px]"),
  open = "folder",
  view = "list",
  side = true,
  narrow = false,
} = {}) => {
  const btn = (inner, ring = true) =>
    `<span class="flex h-8 min-w-8 shrink-0 items-center justify-center gap-0.5 rounded-lg px-1.5 text-foreground/70 ${ring ? "bg-card ring-1 ring-border" : ""}">${inner}</span>`;
  return `
  <div class="flex h-10 shrink-0 items-center gap-1.5 border-b border-border pr-1.5">
    <div class="flex h-full shrink-0 items-center ${side ? "w-[175px] border-r border-border" : ""} px-1.5"><span class="grid size-8 place-items-center rounded-lg text-muted-foreground"><i class="ph ph-sidebar-simple text-[17px]"></i></span></div>
    <span class="ml-0.5 flex h-8 shrink-0 items-center rounded-lg bg-foreground/8 p-0.5">${[
      ["icons", "ph-squares-four"],
      ["list", "ph-rows"],
      ["columns", "ph-columns"],
    ]
      .map(
        ([k, i]) =>
          `<span class="grid h-7 w-9 place-items-center rounded-md ${k === view ? "bg-background text-foreground shadow-xs" : "text-foreground/60"}"><i class="ph ${i} text-[16px]"></i></span>`,
      )
      .join("")}</span>
    ${btn(`<i class="ph ph-arrows-down-up text-[16px]"></i>${narrow ? "" : `<i class="ph ph-caret-down text-[9px] text-muted-foreground"></i>`}`)}${btn(`<i class="ph ph-dots-three text-[16px]"></i>`)}${btn(`<i class="ph ph-magnifying-glass text-[16px]"></i>`)}
    <div class="flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-full border border-border bg-card pr-1.5 pl-3 text-[13px]">
      ${mark}${crumbs.map((c, i) => `<span class="${i === crumbs.length - 1 ? "shrink-0 text-foreground" : "min-w-0 truncate text-muted-foreground"}">${c}</span>`).join(`<i class="ph ph-caret-right shrink-0 text-[9px] text-muted-foreground/60"></i>`)}
      <span class="flex-1"></span>${openIn(open)}
    </div>
    ${btn(`${brand("instrumentglyph", "size-4")}${narrow ? "" : `<span class="pr-1 pl-1 text-[13px] font-medium text-foreground">Ask</span>`}`)}
  </div>`;
};

/** The count Files shows under a folder's listing, on a 24px foot. */
const filesFoot = (n) =>
  `<div class="flex h-6 shrink-0 items-center justify-center border-t border-border text-[11px] text-muted-foreground">${n} ${n === 1 ? "item" : "items"}</div>`;

/**
 * A file open beside its folder in Files, as main draws it (measured 2026-10-16): the
 * folder narrowed to a 300px column in its own layout (`view` "list": Name and Modified
 * over striped rows; "icons": two columns of pictures with names under them), the
 * picked file filled in the brand color; the row split at the column's edge, the
 * folder's name as a menu, the view and sort menus and search over the folder, then
 * the toggle that folds the folder away just past the edge, the file's omnibar (its
 * mark and path, the open-in pill), Ask, more and × over the file. `rows` are [kind, name, modified]; `pick` the open file's index;
 * `file` a FILES key or a tab for the body; `crumbs` the path the omnibar names. `w` is
 * the folder column's width, `folded` hides it.
 */
const fileBeside = ({
  folder = "work",
  rows = [],
  pick = 0,
  view = "list",
  file = "comparison",
  crumbs,
  w = 300,
  folded = false,
  close = true,
  body,
} = {}) => {
  const f = FILES[file] ? { file } : file;
  const kind = f.file ? FILES[f.file].kind : "html";
  const path = crumbs ?? [folder, tabTitle(f)];
  const ico = (i) =>
    `<span class="flex h-7 shrink-0 items-center gap-0.5 rounded-lg px-1.5 text-muted-foreground ring-1 ring-border"><i class="ph ${i} text-[15px]"></i><i class="ph ph-caret-down text-[9px]"></i></span>`;
  const list = rows
    .map(
      ([k, n, d], i) =>
        `<div class="mx-1 grid h-6 grid-cols-[1fr_70px] items-center rounded-md px-2 ${i === pick ? "bg-brand-600 text-white" : i % 2 ? "bg-foreground/[0.03]" : ""}"><span class="flex min-w-0 items-center gap-1.5">${k === "folder" ? `<i class="ph ph-caret-right w-3 text-[10px] ${i === pick ? "" : "text-muted-foreground"}"></i>` : `<span class="w-3"></span>`}${fileMark(k)}<span class="truncate">${n}</span></span><span class="${i === pick ? "" : "text-muted-foreground"}">${d || ""}</span></div>`,
    )
    .join("");
  const grid = `<div class="grid grid-cols-2 gap-x-2 gap-y-3 p-3">${rows
    .map(
      ([k, n], i) =>
        `<div class="flex flex-col items-center gap-1.5 text-center"><span class="grid h-16 w-14 place-items-center ${k === "folder" ? "" : "rounded-sm bg-white shadow-xs ring-1 ring-border"} ${i === pick ? "outline-4 outline-foreground/10" : ""}">${k === "folder" ? `<i class="ph ph-folder text-[52px] text-[#4a9ff5]"></i>` : fileMark(k, "text-[20px]")}</span><span class="line-clamp-2 max-w-full rounded px-1 text-[12px] leading-4 break-all ${i === pick ? "bg-brand-600 text-white" : ""}">${n}</span></div>`,
    )
    .join("")}</div>`;
  return `
  <div class="flex min-w-0 flex-1 flex-col">
    <div class="flex h-10 shrink-0 items-center border-b border-border">
      ${
        folded
          ? ""
          : `<div class="flex h-full shrink-0 items-center gap-1 border-r border-border px-1.5" style="width:${w}px"><span class="flex h-7 min-w-0 items-center gap-1 rounded-md px-1 text-[13px] font-medium">${fileMark("folder", "text-[15px]")}<span class="truncate">${folder}</span><i class="ph ph-caret-down text-[9px] text-muted-foreground"></i></span><span class="flex-1"></span>${ico(view === "icons" ? "ph-squares-four" : "ph-rows")}${ico("ph-arrows-down-up")}<span class="grid size-7 shrink-0 place-items-center rounded-lg text-muted-foreground ring-1 ring-border"><i class="ph ph-magnifying-glass text-[14px]"></i></span></div>`
      }
      <div class="flex min-w-0 flex-1 items-center gap-1 px-1.5">
        <span class="grid size-7 shrink-0 place-items-center text-muted-foreground"><i class="ph ph-sidebar-simple text-[16px]"></i></span>
        <div class="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-full border border-border bg-card pr-1 pl-2.5 text-[12px]">${fileMark(kind)}${path.map((c, i) => `<span class="${i === path.length - 1 ? "shrink-0 text-foreground" : "min-w-0 truncate text-muted-foreground"}">${c}</span>`).join(`<i class="ph ph-caret-right shrink-0 text-[9px] text-muted-foreground/60"></i>`)}<span class="flex-1"></span>${openIn(kind)}</div>
        <span class="flex h-7 shrink-0 items-center gap-1.5 px-1.5 text-[12px] font-medium text-foreground/80">${brand("instrumentglyph", "size-4")}Ask</span>
        <span class="grid size-7 place-items-center text-muted-foreground"><i class="ph ph-dots-three-vertical text-[16px]"></i></span>
        ${close ? `<span class="grid size-7 place-items-center text-muted-foreground"><i class="ph ph-x text-[16px]"></i></span>` : ""}
      </div>
    </div>
    <div class="flex min-h-0 flex-1">
      ${folded ? "" : `<div class="shrink-0 overflow-hidden border-r border-border bg-foreground/[0.015] text-[13px]" style="width:${w}px">${view === "icons" ? grid : `<div class="grid h-7 grid-cols-[1fr_70px] items-center border-b border-border px-3 text-[12px] text-muted-foreground"><span class="pl-4">Name <i class="ph ph-caret-up text-[9px]"></i></span><span>Modified</span></div>${list}`}</div>`}
      <div class="relative min-w-0 flex-1 overflow-hidden">${body ?? page(f)}</div>
    </div>
  </div>`;
};

/** Files filling the card: its top row, then `side` (finderSidebar, fileTree, or nothing), then `head` over `body`. */
const filesPlace = ({
  top = filesTop(),
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

/** The Finder as Files opens it on the Instrument folder, in list view. */
const finder = ({ pick = -1 } = {}) =>
  filesPlace({
    top: filesRow({ crumbs: ["mac-user", "Instrument"] }),
    side: finderSidebar({ on: "Instrument" }),
    body: finderListView(
      FINDER_FILES.map(([k, n], i) => [
        k,
        n,
        `Oct ${8 - (i % 5)}, 2026 at ${9 + (i % 4)}:${10 + i * 5} AM`,
        k === "folder" ? "--" : `${12 + i * 7} KB`,
        {
          folder: "Folder",
          html: "HTML Document",
          md: "Markdown Document",
          csv: "CSV Document",
        }[k],
      ]),
      { pick },
    ),
    foot: filesFoot(FINDER_FILES.length),
  });
