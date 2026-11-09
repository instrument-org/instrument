// ---- floating --------------------------------------------------------------------
// What floats over a place: the popped-out chat (chat-window.tsx), and, for proposals,
// the tile peek and the draft's browser tray the app had before.

/** The small view (chat-window.tsx), re-measured 2026-11-07: a chat popped out over whatever place is up, docked like a draft (420x560, 20px from the right, flush to the window's foot) on the page's ground. Its head is the chat's own head with nothing at its left: the title and caret, the project pill, then minimize, expand and ×. Then the transcript at 13px and the reply box. The app has no tiles here and no peek since e4eced2b1; `tabs` and `peek` still draw them for a proposal that brings them back. */
const smallChat = ({
  title = PRICING_TITLE,
  tabs = [],
  peek = -1,
  body = pricing(2),
  working = "",
  project = "",
  right = 20,
  w = 420,
  h = 560,
  reply = {},
} = {}) => `
  <div class="absolute bottom-0 z-40 flex flex-col overflow-hidden rounded-t-2xl bg-background shadow-2xl ring-1 ring-gray-300" style="right:${right}px;width:${w}px;height:${h}px">
    ${threadHead(title, { toggle: false, pane: null, project, right: `<span class="flex shrink-0 items-center gap-0.5 text-muted-foreground">${windowButton("minus")}${windowButton("arrows-out-simple")}${windowButton("x")}</span>` })}
    <div class="relative flex min-h-0 flex-1 flex-col">
      <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-3 pt-3 text-[13px] [&_.reply]:text-[13px] [&_.text-sm]:text-[13px]">${body}${working ? activityRow(working, { live: true }) : ""}</div>
      <div class="shrink-0 p-2.5">${tabs.length ? chatTiles(tabs, peek) : ""}${replyBox(reply)}</div>
      ${peek >= 0 ? chatPeek(tabs[peek]) : ""}
    </div>
  </div>`;

/** The peek the small view had before e4eced2b1: a tile open in a card over its conversation, its row ending in Expand and ×. Kept for proposals. */
const chatPeek = (t, { bottom = 180 } = {}) => `
  <div class="absolute inset-x-2 top-2 z-10 flex flex-col overflow-hidden rounded-xl bg-background shadow-xl ring-1 ring-gray-300" style="bottom:${bottom}px">
    ${locRow(t, { close: true, expand: true })}
    <div class="relative min-h-0 flex-1 overflow-hidden">${page(t)}</div>
  </div>`;

/**
 * The browser tray a draft had before b5481e1e2 (measured 2026-10-16); a draft now opens
 * what it holds in a well under its composer (composeWin's `well`). A stone tray with
 * rounded top corners, its tabs as white pills on the tray (mark, title, ×) and + after
 * them, then a white card holding back, forward and a full-width omnibar over the page.
 * `tabs` are tabs as tabMark takes them; `active` the one shown; `body` replaces the page.
 */
const agentTray = ({ tabs = [{ browser: true }], active = 0, body } = {}) => `
  <div class="flex h-full min-h-0 flex-col rounded-t-xl bg-gray-200 px-2 pt-2">
    <div class="flex h-9 shrink-0 items-center gap-1.5 pb-1">
      ${tabs
        .map(
          (t, i) =>
            `<span class="flex h-8 max-w-48 min-w-0 items-center gap-2 rounded-lg px-2.5 text-[13px] ${i === active ? "bg-white font-medium shadow-xs" : "text-foreground/60"}">${tabMark(t)}<span class="min-w-0 flex-1 truncate">${tabTitle(t)}</span>${i === active ? `<i class="ph ph-x text-[12px] text-muted-foreground"></i>` : ""}</span>`,
        )
        .join("")}
      <span class="grid size-7 shrink-0 place-items-center text-foreground/60"><i class="ph ph-plus text-[15px]"></i></span>
    </div>
    <div class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-t-lg bg-white">
      <div class="flex h-10 shrink-0 items-center gap-1 border-b border-border px-2 text-foreground/50">
        <i class="ph ph-caret-left px-1 text-[15px]"></i><i class="ph ph-caret-right px-1 text-[15px] text-foreground/25"></i>
        <span class="flex h-7 min-w-0 flex-1 items-center rounded-full border border-border px-3 text-[12px] ${tabs[active]?.site ? "text-foreground/70" : "text-gray-400"}">${tabs[active]?.site ? SITES[tabs[active].site].host : "Search or enter address"}</span>
      </div>
      <div class="relative min-h-0 flex-1 overflow-hidden">${body ?? page(tabs[active] ?? { newtab: true })}</div>
    </div>
  </div>`;
