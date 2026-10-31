// ---- the location row ----------------------------------------------------------

/**
 * The location row over a page or file (browser-panel.tsx's tab row): three columns, with
 * the omnibar centered at up to 640px and an open-in pill at its end, then Ask and the
 * page's menu at the right. In a pane or peek (`close`) the left holds back and forward and
 * the right ends in Expand (a file's, or with `expand`) and the × that puts the view away;
 * filling the Browser place (`place`) the left holds reload, since a window tab's history
 * is the bar's back and forward, and Ask has its word.
 */
const locRow = (t, { close = false, expand = false, place = false } = {}) => `
  <div class="grid h-10 shrink-0 grid-cols-[1fr_minmax(0,640px)_1fr] items-center gap-1 border-b border-border bg-background px-2 text-foreground/60">
    <div class="flex items-center gap-1">${
      place
        ? `<span class="grid size-7 place-items-center"><i class="ph ph-arrow-clockwise text-[16px]"></i></span>`
        : `<span class="grid size-7 place-items-center"><i class="ph ph-caret-left text-[16px]"></i></span><span class="grid size-7 place-items-center text-foreground/25"><i class="ph ph-caret-right text-[16px]"></i></span>`
    }</div>
    <div class="flex h-7 min-w-0 items-center gap-2 rounded-full border border-border bg-card pr-1 pl-3 text-[12px]">
      ${
        !t || t.newtab
          ? `<span class="flex-1 text-gray-400">Search or enter address</span>`
          : t.site
            ? `<span class="min-w-0 flex-1 truncate text-foreground/70">${SITES[t.site].host}</span>${openIn("site")}`
            : `${fileMark(FILES[t.file].kind)}<span class="flex min-w-0 flex-1 items-center gap-1"><span class="text-muted-foreground">Instrument</span><i class="ph ph-caret-right text-[10px] text-muted-foreground/50"></i><span class="truncate text-foreground">${FILES[t.file].title}</span></span>${openIn(FILES[t.file].kind)}`
      }
    </div>
    <div class="flex items-center justify-end gap-1">
      ${t && !t.newtab ? askButton(place) + `<span class="grid size-7 place-items-center"><i class="ph ph-dots-three-vertical text-[16px]"></i></span>` : ""}
      ${close && (expand || t?.file) ? `<span class="grid size-7 place-items-center"><i class="ph ph-arrows-out-simple text-[16px]"></i></span>` : ""}
      ${close ? `<span class="grid size-7 place-items-center"><i class="ph ph-x text-[16px]"></i></span>` : ""}
    </div>
  </div>`;
