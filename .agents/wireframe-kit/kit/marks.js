// ---- marks ----------------------------------------------------------------------
// The small pieces every surface draws with: brand and letter marks, file-type marks,
// a tab's mark and title, the agent's dot, grey bars for incidental text, the open-in
// pill and Ask, and a topic's tint.

const brand = (key, cls = "size-4") =>
  `<img src="${BRAND_URI[key]}" class="${cls} shrink-0" alt="">`;

/** A letter mark for a site with no brand mark in BRAND_URI. Pass finished classes. */
const letterMark = (letter, cls, size = "size-4 text-[9px]") =>
  `<span class="grid ${size} shrink-0 place-items-center rounded-[4px] font-bold text-white ${cls}">${letter}</span>`;

/** The Mac's blue folder, as Files and the omnibar draw it. */
const FOLDER_SVG = `<svg class="size-[1.1em]" viewBox="0 0 16 16"><path d="M1.5 4a1.5 1.5 0 0 1 1.5-1.5h3.2l1.4 1.4h5.4A1.5 1.5 0 0 1 14.5 5.4v6.6a1.5 1.5 0 0 1-1.5 1.5H3A1.5 1.5 0 0 1 1.5 12Z" fill="#69b1f5"/><path d="M1.5 5.6h13" stroke="#4a9ff5" stroke-width=".6"/></svg>`;

/**
 * The colored file-type marks Files draws (file-type-glyphs.ts), each in the same box
 * (1.15em, from `cls`'s size) so names line up whatever the kind. Kinds: html, md, csv,
 * pdf, img, doc, xls, txt, zip, folder, and `output` for the teal Instrument folder.
 */
const fileMark = (kind, cls = "text-[13px]") =>
  `<span class="inline-flex w-[1.15em] shrink-0 items-center justify-center ${cls}">${
    {
      html: `<span class="grid size-[0.95em] place-items-center rounded-[3px] bg-[#e8793a]/15 text-[0.78em] leading-none font-bold text-[#e8793a]">#</span>`,
      md: `<span class="text-[0.72em] font-bold tracking-tighter text-[#3f9d52]">M↓</span>`,
      csv: `<i class="ph ph-file-text text-[#2b9aa0]"></i>`,
      pdf: `<i class="ph ph-file-pdf text-[#d14b3f]"></i>`,
      video: `<i class="ph ph-film-strip text-[#6d5bd0]"></i>`,
      audio: `<i class="ph ph-waveform text-[#d0457a]"></i>`,
      captions: `<i class="ph ph-closed-captioning text-[#6b7280]"></i>`,
      img: `<i class="ph ph-image text-[#8a6bd1]"></i>`,
      doc: `<i class="ph ph-file-doc text-[#2f6fd6]"></i>`,
      xls: `<i class="ph ph-file-xls text-[#1f8a4c]"></i>`,
      txt: `<i class="ph ph-file-text text-foreground/55"></i>`,
      zip: `<i class="ph ph-file-zip text-foreground/55"></i>`,
      folder: FOLDER_SVG,
      output: FOLDER_SVG.replace('fill="#69b1f5"', 'fill="#5fae9c"').replace(
        'stroke="#4a9ff5"',
        'stroke="#3f9d8a"',
      ),
    }[kind] ?? `<i class="ph ph-file text-foreground/50"></i>`
  }</span>`;

/** The words Files' Kind column and List view say for a kind. */
const KIND_TEXT = {
  folder: "Folder",
  output: "Folder",
  html: "HTML Document",
  md: "Markdown Document",
  csv: "CSV Document",
  pdf: "PDF Document",
  img: "PNG Image",
  doc: "Word Document",
  xls: "Excel Workbook",
  txt: "Plain Text",
  zip: "ZIP Archive",
};

/**
 * A tab is one of: `{ chats: true, title }` (Chat, on a chat when `title` names one),
 * `{ site }` (a SITES key), `{ file }` (a FILES key), `{ folder: name }` (Files on a
 * folder), `{ browser: true }` (Browser with no page), `{ apps: true, title }`,
 * `{ newtab: true }`, `{ notes: true }` (release notes) or `{ title, icon }` for
 * anything else. `agent: true` marks one a task is driving.
 */
const tabMark = (t, size) =>
  t.icon
    ? t.icon
    : t.chats
      ? `<i class="ph ph-chat-circle shrink-0 text-[15px]"></i>`
      : t.site
        ? SITES[t.site].mark(size)
        : t.file
          ? fileMark(FILES[t.file].kind)
          : t.folder
            ? fileMark("folder", "text-[15px]")
            : t.browser
              ? `<i class="ph ph-globe shrink-0 text-[15px]"></i>`
              : t.apps
                ? `<i class="ph ph-shapes shrink-0 text-[15px]"></i>`
                : t.notes
                  ? `<i class="ph ph-file-text shrink-0 text-[15px]"></i>`
                  : `<i class="ph ph-magnifying-glass shrink-0 text-[15px]"></i>`;
const tabTitle = (t) =>
  t.chats
    ? t.title || "Chats"
    : t.site
      ? SITES[t.site].title
      : t.file
        ? FILES[t.file].title
        : t.folder ||
          t.title ||
          (t.browser
            ? "Browser"
            : t.apps
              ? "Apps"
              : t.notes
                ? "Release notes"
                : "New tab");

const pulse = `<span class="size-1.5 shrink-0 animate-pulse rounded-full bg-brand-500"></span>`;

/** The agent at work (planning-dot.tsx): a 10px brand sphere with its ring traveling out, in a 20px box. */
const planningDot = `<span class="relative grid size-5 shrink-0 place-items-center"><span class="absolute size-3.5 rounded-full border-2 border-brand-400/40"></span><span class="size-2.5 rounded-full bg-gradient-to-br from-brand-400 to-brand-700"></span></span>`;

/** Grey bars standing for incidental text, at the widths given. */
const bars2 = (...ws) =>
  ws
    .map(
      (w) =>
        `<div class="h-[7px] rounded-full bg-gray-300" style="width:${w}"></div>`,
    )
    .join("");

/** The icon at the omnibar's round end that opens what is shown in its Mac app: the Finder for a folder, the browser for a page or an HTML file, a text editor or a spreadsheet for the rest. */
const openIn = (kind) =>
  ({
    folder: `<span class="grid size-4 shrink-0 place-items-center rounded-[4px] bg-gradient-to-b from-[#5fb4ff] to-[#1e7ae8] text-white"><i class="ph ph-smiley text-[11px]"></i></span>`,
    site: `<span class="grid size-4 shrink-0 place-items-center rounded-full bg-gradient-to-b from-[#5fb4ff] to-[#1e7ae8] text-white"><i class="ph ph-compass text-[11px]"></i></span>`,
    html: `<span class="grid size-4 shrink-0 place-items-center rounded-full bg-gradient-to-b from-[#5fb4ff] to-[#1e7ae8] text-white"><i class="ph ph-compass text-[11px]"></i></span>`,
    md: `<span class="grid size-4 shrink-0 place-items-center rounded-[4px] bg-white text-foreground/70 ring-1 ring-border"><i class="ph ph-note-pencil text-[10px]"></i></span>`,
    csv: `<span class="grid size-4 shrink-0 place-items-center rounded-[4px] bg-[#2f8f5b] text-white"><i class="ph ph-chart-bar text-[10px]"></i></span>`,
    video: `<span class="grid size-4 shrink-0 place-items-center rounded-[4px] bg-[#2b2b2e] text-white"><i class="ph ph-play text-[9px]"></i></span>`,
    audio: `<span class="grid size-4 shrink-0 place-items-center rounded-[4px] bg-[#fa3e5f] text-white"><i class="ph ph-music-note text-[10px]"></i></span>`,
  })[kind] ?? "";

/** Ask, which starts a chat about what is shown: the Instrument glyph, and its word where the row has room (`label`). */
const askButton = (label = true) =>
  `<span class="flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[13px] font-medium text-foreground">${brand("instrumentglyph", "size-4")}${label ? "Ask" : ""}</span>`;

/** A key cap, as kbd.tsx draws a chord: `kbd("⌘K")`. */
const kbd = (keys) =>
  `<span class="inline-flex h-5 items-center rounded-md bg-foreground/6 px-1.5 text-[11px] font-medium text-muted-foreground ring-1 ring-foreground/8">${keys}</span>`;

/**
 * A topic's tint (topic-tint.ts and the `topic-tint` utility): put the returned
 * style on an element, then color it with `bg-(--topic-tint-surface)`,
 * `text-(--topic-tint-ink)` or `border-(--topic-tint-edge)` inside it. `color` is
 * one of TOPIC_COLORS; the first eight are the pale tier.
 */
const TOPIC_COLORS = [
  "#f2a7a6",
  "#ebaf86",
  "#d4bc79",
  "#99ce9a",
  "#78d1c0",
  "#82c7f0",
  "#bcb4f4",
  "#e8a7cb",
  "#c0434c",
  "#b85300",
  "#996d00",
  "#218b30",
  "#009178",
  "#007fc3",
  "#765fca",
  "#b2468a",
];
const topicTint = (color) => {
  const pale = TOPIC_COLORS.indexOf(color) > -1 && TOPIC_COLORS.indexOf(color) < 8;
  const c = pale ? 0.09 : 0.16;
  return [
    `--topic-tint-surface:oklch(from ${color} 0.93 ${(c * 0.42).toFixed(3)} h)`,
    `--topic-tint-edge:oklch(from ${color} 0.86 ${(c * 0.7).toFixed(3)} h)`,
    `--topic-tint-ink:oklch(from ${color} 0.48 ${(c * 0.95).toFixed(3)} h)`,
    `--topic-tint-base:oklch(from ${color} ${pale ? 0.8 : 0.56} ${c} h)`,
  ].join(";");
};
