// ---- the omnibar and the location row ---------------------------------------------
// The field every place puts its address in (tab-location-row.tsx, omnibar.tsx,
// folding-trail.tsx), and the 40px row it stands in over a page, a file or a pane.
// Re-measured 2026-11-07: the row is 44px; the field is a 32px well a shade darker than
// the row (white with a firmer ring while typing) and runs the row's whole width; a page
// says its host quiet and the rest loud; a folder or file walks its path as crumbs that
// fold their middle into ··· when the field runs short; the Mac app it opens in sits at
// its end. Every control around it is framed the same way (toolbar-control.ts): a 32px
// card with a hairline ring and 12px corners, several of them (back, forward, reload)
// sharing one frame as bare 28px glyphs.

/** The frame every control around the row stands on (TOOLBAR_SURFACE_CLASSNAME). */
const TOOL_SURFACE = "h-8 rounded-xl bg-card text-foreground/70 shadow-[0_1px_2px_rgb(0_0_0/0.04)] ring-1 ring-border";

/** A bare 28px glyph inside a shared frame (TabRowControl); `dim` for one that can't be pressed. */
const toolGlyph = (icon, { dim = false } = {}) =>
  `<span class="grid size-7 shrink-0 place-items-center rounded-lg ${dim ? "text-foreground/25" : "text-foreground/60"}"><i class="ph ph-${icon} text-[16px]"></i></span>`;

/** Several controls framed as one (TOOLBAR_GROUP_CLASSNAME): back, forward and reload, or the extensions' buttons. `inner` is finished HTML, usually toolGlyphs. */
const toolGroup = (inner) => `<span class="flex shrink-0 items-center gap-0.5 px-0.5 ${TOOL_SURFACE}">${inner}</span>`;

/** A framed 32px icon button (TOOLBAR_ICON_BUTTON_CLASSNAME): a page's ⋮, Files' ··· and search. */
const toolIcon = (icon) => `<span class="grid size-8 shrink-0 place-items-center ${TOOL_SURFACE}"><i class="ph ph-${icon} text-[16px]"></i></span>`;

/** Ask framed like the row's other buttons (file-ask-button.tsx), the mark saying who it asks; `label` false for the mark alone, as a narrow row draws it. */
const askFramed = (label = true) =>
  `<span class="flex shrink-0 items-center gap-1.5 ${label ? "px-2.5" : "px-1.5"} text-[13px] font-medium text-foreground ${TOOL_SURFACE}">${brand("instrumentglyph", "size-3.5")}${label ? "Ask" : ""}</span>`;

/** The browser's extensions (browser-extension-buttons.tsx): the pinned ones' marks (HTML) and the puzzle piece, in one frame. With none installed the puzzle piece stands alone. */
const extensionsPill = (marks = []) =>
  toolGroup(`${marks.map((m) => `<span class="grid size-7 shrink-0 place-items-center">${m}</span>`).join("")}${toolGlyph("puzzle-piece")}`);

/**
 * The omnibar's field. `t` is what it stands on: a tab (see tabMark) for a page, a
 * file, a folder or a new tab, or null for an empty one. `crumbs` overrides the path a
 * folder or file walks (the place last), `fold` folds the crumbs before that index
 * into ···, and `mark` overrides the mark leading it. `focus` draws it pressed, the
 * whole address selected the way clicking into it does; `typed` draws words being
 * typed with the caret after them (its menu is omniMenu). `size` is kept for older
 * parts and ignored, since every row's field is 32px; `end` replaces the open-in icon.
 */
const omnibar = (
  t,
  { crumbs, fold = 0, mark, focus = false, typed = "", ph, size = 8, end, url } = {},
) => {
  // Every row's field is 32px now; `size` stays for parts that pass it.
  void size;
  const box = `flex h-8 min-w-0 flex-1 items-center gap-2 rounded-xl px-3 text-[13px] ring-1 ${focus || typed ? "bg-card ring-foreground/20" : "bg-[color-mix(in_oklab,var(--color-foreground)_4.5%,var(--color-background))] ring-foreground/[0.06]"}`;
  const kind = t?.site ? "site" : t?.file ? FILES[t.file].kind : t?.folder ? "folder" : "";
  const tail = end ?? (kind ? openIn(kind) : "");
  if (typed)
    return `<div class="${box}"><span class="min-w-0 truncate text-foreground">${typed}</span><span class="-ml-2 h-3.5 w-px shrink-0 bg-foreground"></span><span class="flex-1"></span></div>`;
  if (!t || t.newtab || t.browser)
    return `<div class="${box}"><span class="min-w-0 truncate text-muted-foreground">${ph ?? (t?.browser ? "Search or enter address" : "Search, open a file, or ask")}</span></div>`;
  if (t.site) {
    const [host, rest] = url ? [url.split("/")[0], url.slice(url.split("/")[0].length)] : [SITES[t.site].host, ""];
    return `<div class="${box}"><span class="min-w-0 flex-1 truncate ${focus ? "bg-[#b4d5fe]" : ""}"><span class="text-muted-foreground">${host}</span><span class="text-foreground">${rest}</span></span>${tail}</div>`;
  }
  if (focus) {
    const path = `/Users/mac-user/${(crumbs ?? [tabTitle(t)]).slice(crumbs ? 1 : 0).join("/")}`;
    return `<div class="${box}"><span class="min-w-0 flex-1 truncate"><span class="bg-[#b4d5fe]">${path}</span></span>${tail}</div>`;
  }
  const path = crumbs ?? (t.file ? ["mac-user", "Instrument", FILES[t.file].title] : ["mac-user", t.folder]);
  const lead = mark ?? (t.file ? fileMark(FILES[t.file].kind, "text-[14px]") : fileMark("folder", "text-[15px]"));
  const sep = `<i class="ph ph-caret-right shrink-0 text-[12px] text-muted-foreground/50"></i>`;
  const parts = path.map((c, i) =>
    i === path.length - 1
      ? `<span class="shrink-0 px-1 text-foreground">${c}</span>`
      : `<span class="min-w-0 truncate px-1 text-muted-foreground">${c}</span>`,
  );
  const shown = fold > 0 ? [parts[0], `<span class="shrink-0 px-1 text-muted-foreground"><i class="ph ph-dots-three text-[15px]"></i></span>`, ...parts.slice(fold)] : parts;
  return `<div class="${box}">${lead}<span class="-mx-1 flex min-w-0 flex-1 items-center">${shown.join(sep)}</span>${tail}</div>`;
};

/**
 * What the omnibar offers under it as you type (omnibar.tsx): a white panel as wide as
 * the field, its rows 28px, the first one lit. `rows` are [mark, words, hint] (a mark is
 * HTML: `searchMark`, a fileMark, a site mark); place it with `left`, `top` and `w` in
 * the window's pixels.
 */
const searchMark = `<i class="ph ph-magnifying-glass text-[15px] text-muted-foreground"></i>`;
const omniMenu = (rows, { left, top, w = 640, on = 0 } = {}) => `
  <div class="absolute z-30 overflow-hidden rounded-xl border border-border bg-popover p-1 shadow-lg" style="left:${left}px;top:${top}px;width:${w}px">
    ${rows
      .map(
        ([m, words, hint = ""], i) =>
          `<div class="flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13px] ${i === on ? "bg-foreground/8" : ""}"><span class="grid w-4 shrink-0 place-items-center">${m}</span><span class="min-w-0 flex-1 truncate">${words}</span>${hint ? `<span class="shrink-0 text-[12px] text-muted-foreground">${hint}</span>` : ""}</div>`,
      )
      .join("")}
  </div>`;

/**
 * The 44px location row over a page, a file or a pane (tab-location-row.tsx): `lead` (a
 * proposal's own controls, or a toggle at the far left), then back and forward in a pane
 * (`close`) and reload where a page fills a window tab (`place`), framed together; the
 * omnibar across the rest; then for a page the extensions (`extensions`, their marks);
 * Ask (a site's only at the window's level, a file's anywhere); the ⋮; and Expand for a
 * file in a pane (or with `expand`). `trail` goes
 * last. `omni` passes options to the omnibar (focus, typed, crumbs, fold, url). A pane's
 * × is in its tab strip now, not in this row.
 */
const locRow = (t, { close = false, expand = false, place = false, lead = "", trail = "", omni = {}, extensions = [] } = {}) => {
  const isEmpty = !t || t.newtab || t.browser;
  const nav = (close ? toolGlyph("arrow-left") + toolGlyph("arrow-right", { dim: true }) : "") + (place && !isEmpty ? toolGlyph("arrow-clockwise") : "");
  return `
  <div class="flex h-11 shrink-0 items-center gap-1.5 border-b border-border bg-background px-1.5">
    ${lead}${nav ? toolGroup(nav) : ""}
    ${omnibar(t, omni)}
    ${t?.site || t?.browser ? extensionsPill(extensions) : ""}${isEmpty || (t.site && close) ? "" : askFramed(true)}${(t && !t.newtab) ? toolIcon("dots-three-vertical") : ""}
    ${close && (expand || t?.file) ? toolGroup(toolGlyph("arrows-out-simple")) : ""}${trail}
  </div>`;
};
