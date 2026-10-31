// ---- Browser and the places that fill the card ---------------------------------------
// Browser (browser-panel.tsx), re-measured 2026-10-31: a page fills the card under its
// location row (reload, the omnibar across the row, Ask and the page's menu; back and
// forward are the bar's). With no page it is the omnibar alone over Bookmarks and
// Recent pages.

/** Browser, an app or a skill filling the card under its location row (none on Apps). `omni` passes options to the omnibar (focus, typed, url). Files has filesPlace. */
const placeCard = ({ tab, body, loc = true, omni = {} }) => `
  <div class="flex min-w-0 flex-1 flex-col">
    ${loc ? locRow(tab, { place: true, omni }) : ""}
    <div class="relative min-h-0 flex-1 overflow-hidden bg-white">${body ?? page(tab)}</div>
  </div>`;

/** The bookmark the empty Bookmarks shelf draws: two cards fanned behind a globe, a ribbon in the brand's sage. */
const bookmarkArt = `<span class="relative mb-3 block h-16 w-24"><span class="absolute top-2 left-1 h-12 w-14 -rotate-6 rounded-lg bg-white shadow-sm ring-1 ring-black/5"></span><span class="absolute top-2 right-1 h-12 w-14 rotate-6 rounded-lg bg-white shadow-sm ring-1 ring-black/5"></span><span class="absolute top-0 left-1/2 grid h-16 w-16 -translate-x-1/2 place-items-center rounded-xl bg-white shadow-md ring-1 ring-black/5"><i class="ph ph-globe text-[22px] text-muted-foreground"></i></span><span class="absolute -top-1 left-[60%] h-5 w-3 bg-brand-300 [clip-path:polygon(0_0,100%_0,100%_100%,50%_75%,0_100%)]"></span></span>`;

/**
 * Browser with no page open: the omnibar across the top row, then
 * Bookmarks (`bookmarks`: SITES keys, else its empty shelf) and Recent pages (`recent`:
 * SITES keys; [] hides the section) under their ruled labels. `omni` passes options to
 * the omnibar (focus, typed).
 */
const browserHome = ({ recent = ["zendesk", "g2"], bookmarks = [], omni = {} } = {}) => `
  <div class="flex min-w-0 flex-1 flex-col">
    <div class="flex h-10 shrink-0 items-center border-b border-border px-2">${omnibar({ browser: true }, omni)}</div>
    <div class="mx-auto flex w-full max-w-[944px] flex-col gap-4 px-0 pt-[86px]">
      <div class="flex items-center gap-3 text-[13px] text-muted-foreground">Bookmarks<span class="h-px flex-1 bg-border"></span></div>
      ${
        bookmarks.length
          ? `<div class="grid grid-cols-6 gap-3">${bookmarks.map((k) => `<div class="flex flex-col items-center gap-2 rounded-xl p-3 text-center text-[12px]"><span class="grid size-12 place-items-center rounded-xl bg-white shadow-sm ring-1 ring-black/5">${SITES[k].mark("size-6 text-[11px]")}</span><span class="w-full truncate">${SITES[k].title.split(" · ").pop()}</span></div>`).join("")}</div>`
          : `<div class="flex flex-col items-center gap-1 rounded-2xl bg-foreground/[0.03] py-10 text-center">${bookmarkArt}<span class="text-sm font-medium">No bookmarks yet</span><span class="text-[13px] text-muted-foreground">Choose <span class="font-medium text-foreground/80">Add to bookmarks</span> from the ${kbd("⋮")} menu on a website to add bookmarks</span></div>`
      }
      ${
        recent.length
          ? `<div class="mt-4 flex items-center gap-3 text-[13px] text-muted-foreground">Recent pages<span class="h-px flex-1 bg-border"></span></div>
      <div class="grid grid-cols-3 gap-2">${recent.map((k) => `<div class="flex h-9 items-center gap-2 rounded-lg bg-foreground/[0.04] px-3 text-[13px]">${SITES[k].mark()}<span class="truncate">${SITES[k].title}</span></div>`).join("")}</div>`
          : ""
      }
    </div>
  </div>`;

/** The page's ⋮ menu in Browser (browser-panel.tsx), as built. */
const pageMenu = ({ left = 1004, top = 84, bookmarked = false } = {}) =>
  menu(
    [
      { icon: "bookmark-simple", label: bookmarked ? "Remove bookmark" : "Add to bookmarks" },
      { icon: "broom", label: "Clear browsing data…" },
      "rule",
      { icon: "printer", label: "Print…", keys: "⌘P" },
      { icon: "magnifying-glass", label: "Find in page", keys: "⌘F" },
      { icon: "floppy-disk", label: "Save page as…", keys: "⌘S" },
      { icon: "copy", label: "Copy URL" },
      { icon: "export", label: "Share…", sub: true },
      { icon: "device-mobile", label: "View as", sub: true },
      "rule",
      { icon: "arrow-counter-clockwise", label: "Hard reload" },
      { icon: "shield-check", label: "Block ads" },
      { icon: "terminal-window", label: "Developer tools" },
    ],
    { left, top, w: 232 },
  );
