// ---- places --------------------------------------------------------------------

/** Browser, an app or a skill (Files has filesPlace): the place fills the card, under its location row (none on Apps). Its tabs are the window's, in the bar. */
const placeCard = ({ tab, body, loc = true }) => `
  <div class="flex min-w-0 flex-1 flex-col">
    ${loc ? locRow(tab, { place: true }) : ""}
    <div class="relative min-h-0 flex-1 overflow-hidden">${body ?? page(tab)}</div>
  </div>`;

/** Browser with no page open: the omnibar alone in the top row, then Bookmarks and Recent pages under their ruled labels. `recent` are SITES keys. */
const browserHome = ({ recent = ["zendesk", "g2"] } = {}) => `
  <div class="flex min-w-0 flex-1 flex-col">
    <div class="grid h-10 shrink-0 grid-cols-[1fr_minmax(0,640px)_1fr] items-center border-b border-border px-2"><span></span><div class="flex h-7 items-center rounded-full border border-border bg-card px-3 text-[12px] text-gray-400">Search or enter address</div><span></span></div>
    <div class="mx-auto flex w-full max-w-[944px] flex-col gap-4 px-6 pt-20">
      <div class="flex items-center gap-3 text-[13px] text-muted-foreground">Bookmarks<span class="h-px flex-1 bg-border"></span></div>
      <div class="flex flex-col items-center gap-2 rounded-2xl bg-foreground/[0.03] py-10 text-center">
        <span class="mb-2 grid size-14 place-items-center rounded-xl bg-white text-muted-foreground shadow-sm"><i class="ph ph-globe text-[20px]"></i></span>
        <span class="text-sm font-medium">No bookmarks yet</span>
        <span class="text-[13px] text-muted-foreground">Choose <span class="font-medium text-foreground/80">Add to bookmarks</span> from the ⋮ menu on a website to add bookmarks</span>
      </div>
      <div class="mt-4 flex items-center gap-3 text-[13px] text-muted-foreground">Recent pages<span class="h-px flex-1 bg-border"></span></div>
      <div class="grid grid-cols-2 gap-2">${recent.map((k) => `<div class="flex h-9 items-center gap-2 rounded-lg bg-foreground/[0.04] px-3 text-[13px]">${SITES[k].mark()}<span class="truncate">${SITES[k].title}</span></div>`).join("")}</div>
    </div>
  </div>`;
