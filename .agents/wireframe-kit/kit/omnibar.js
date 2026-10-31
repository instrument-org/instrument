// ---- the omnibar and the location row ---------------------------------------------
// The field every place puts its address in (tab-location-row.tsx, omnibar.tsx,
// folding-trail.tsx), and the 40px row it stands in over a page, a file or a pane.
// Measured 2026-10-31: the field runs the row's whole width; a page says its host
// quiet and the rest loud; a folder or file walks its path as crumbs that fold their
// middle into ··· when the field runs short; the Mac app it opens in sits at its end.

/**
 * The omnibar's field. `t` is what it stands on: a tab (see tabMark) for a page, a
 * file, a folder or a new tab, or null for an empty one. `crumbs` overrides the path a
 * folder or file walks (the place last), `fold` folds the crumbs before that index
 * into ···, and `mark` overrides the mark leading it. `focus` draws it pressed, the
 * whole address selected the way clicking into it does; `typed` draws words being
 * typed with the caret after them (its menu is omniMenu). `size` is 7 (28px, the
 * location row's) or 8 (32px, Files' row); `end` replaces the open-in icon.
 */
const omnibar = (
  t,
  { crumbs, fold = 0, mark, focus = false, typed = "", ph, size = 7, end, url } = {},
) => {
  const text = size === 8 ? "text-[13px]" : "text-xs";
  const box = `flex ${size === 8 ? "h-8" : "h-7"} min-w-0 flex-1 items-center gap-2 rounded-full border bg-card px-3 ${text} shadow-xs ${focus || typed ? "border-transparent ring-2 ring-brand-500/45" : "border-border"}`;
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
  const lead = mark ?? (t.file ? fileMark(FILES[t.file].kind, size === 8 ? "text-[14px]" : "text-[13px]") : fileMark("folder", "text-[15px]"));
  const sep = `<i class="ph ph-caret-right shrink-0 text-[11px] text-muted-foreground/50"></i>`;
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
 * The 40px location row over a page or file (tab-location-row.tsx): `lead` (a proposal's
 * own controls), back and forward in a pane or peek (`close`), reload where the page
 * fills a window tab (`place`), the omnibar across the rest, Ask and the page's menu,
 * then Expand (a file's in a pane, or with `expand`) and the × that puts a pane away.
 * `omni` passes options to the omnibar (focus, typed, crumbs, fold, url).
 */
const locRow = (t, { close = false, expand = false, place = false, lead = "", trail = "", omni = {} } = {}) => {
  const btn = (i, dim = false) => `<span class="grid size-7 shrink-0 place-items-center rounded-md ${dim ? "text-foreground/25" : "text-foreground/60"}"><i class="ph ph-${i} text-[16px]"></i></span>`;
  const isEmpty = !t || t.newtab || t.browser;
  return `
  <div class="flex h-10 shrink-0 items-center gap-1 border-b border-border bg-background px-2">
    ${lead}${close ? btn("caret-left") + btn("caret-right", true) : ""}${place && !isEmpty ? btn("arrow-clockwise") : ""}
    ${omnibar(t, omni)}
    ${isEmpty ? "" : askButton(true) + btn("dots-three-vertical")}${trail}
    ${close && (expand || t?.file) ? btn("arrows-out-simple") : ""}${close ? btn("x") : ""}
  </div>`;
};
