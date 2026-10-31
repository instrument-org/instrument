// ---- marks: brand and letter marks, file and tab marks, the agent's dot, bars, open-in and Ask

const brand = (key, cls = "size-4") =>
  `<img src="${BRAND_URI[key]}" class="${cls} shrink-0" alt="">`;

/** A letter mark for a site with no brand mark in BRAND_URI. Pass finished classes. */
const letterMark = (letter, cls, size = "size-4 text-[9px]") =>
  `<span class="grid ${size} shrink-0 place-items-center rounded-[4px] font-bold text-white ${cls}">${letter}</span>`;

/** The colored file-type marks the Finder draws, each in the same box (1.15em, from `cls`'s size) so names line up whatever the kind. */
const fileMark = (kind, cls = "text-[13px]") =>
  `<span class="inline-flex w-[1.15em] shrink-0 items-center justify-center ${cls}">${
    {
      html: `<span class="font-bold text-[#e8793a]">#</span>`,
      md: `<span class="text-[0.72em] font-bold tracking-tighter text-[#3f9d52]">M↓</span>`,
      csv: `<i class="ph ph-table text-[#2f8f5b]"></i>`,
      pdf: `<i class="ph ph-file-pdf text-[#d14b3f]"></i>`,
      folder: `<svg class="size-[1.1em]" viewBox="0 0 16 16"><path d="M1.5 4a1.5 1.5 0 0 1 1.5-1.5h3.2l1.4 1.4h5.4A1.5 1.5 0 0 1 14.5 5.4v6.6a1.5 1.5 0 0 1-1.5 1.5H3A1.5 1.5 0 0 1 1.5 12Z" fill="#69b1f5"/><path d="M1.5 5.6h13" stroke="#4a9ff5" stroke-width=".6"/></svg>`,
    }[kind]
  }</span>`;

/** A tab is {site}, {file}, {folder: name} (Files open on a folder), {browser: true} (Browser with no page), {apps: true, title} or {newtab: true}; `agent` marks one the task is driving. */
const tabMark = (t, size) =>
  t.site
    ? SITES[t.site].mark(size)
    : t.file
      ? fileMark(FILES[t.file].kind)
      : t.folder
        ? fileMark("folder", "text-[15px]")
        : t.browser
          ? `<i class="ph ph-globe shrink-0 text-[14px]"></i>`
          : t.apps
            ? `<i class="ph ph-shapes shrink-0 text-[14px]"></i>`
            : `<i class="ph ph-magnifying-glass shrink-0 text-[14px]"></i>`;
const tabTitle = (t) =>
  t.site
    ? SITES[t.site].title
    : t.file
      ? FILES[t.file].title
      : t.folder || t.title || (t.browser ? "Browser" : "New tab");

const pulse = `<span class="size-1.5 shrink-0 animate-pulse rounded-full bg-brand-500"></span>`;

/** The agent at work (planning-dot.tsx): a 10px brand sphere with its ring traveling out, in a 20px box. */
const planningDot = `<span class="relative grid size-5 shrink-0 place-items-center"><span class="absolute size-3.5 rounded-full border-2 border-brand-400/40"></span><span class="size-2.5 rounded-full bg-gradient-to-br from-brand-400 to-brand-700"></span></span>`;

const bars2 = (...ws) =>
  ws
    .map(
      (w) =>
        `<div class="h-[7px] rounded-full bg-gray-300" style="width:${w}"></div>`,
    )
    .join("");

/** The pill at the omnibar's end that opens what is shown in its Mac app, wearing that app's icon: the Finder for a folder, the browser for a page or an HTML file, a text editor or a spreadsheet for the rest. */
const openIn = (kind) =>
  ({
    folder: `<span class="grid size-4 shrink-0 place-items-center rounded-[4px] bg-[#1e88f0] text-white"><i class="ph ph-smiley text-[11px]"></i></span>`,
    site: `<span class="grid size-4 shrink-0 place-items-center rounded-full bg-[#1e88f0] text-white"><i class="ph ph-compass text-[11px]"></i></span>`,
    html: `<span class="grid size-4 shrink-0 place-items-center rounded-full bg-[#1e88f0] text-white"><i class="ph ph-compass text-[11px]"></i></span>`,
    md: `<span class="grid size-4 shrink-0 place-items-center rounded-[4px] bg-white text-foreground/70 ring-1 ring-border"><i class="ph ph-note-pencil text-[10px]"></i></span>`,
    csv: `<span class="grid size-4 shrink-0 place-items-center rounded-[4px] bg-[#2f8f5b] text-white"><i class="ph ph-chart-bar text-[10px]"></i></span>`,
  })[kind] ?? "";

/** Ask, which starts a chat about what is shown: the Instrument glyph, and its word where the row has room (`label`). */
const askButton = (label = true) =>
  `<span class="flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium text-foreground/70">${brand("instrumentglyph", "size-3.5")}${label ? "Ask" : ""}</span>`;
