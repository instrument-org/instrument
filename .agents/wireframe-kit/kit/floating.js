// ---- floating ------------------------------------------------------------------

/** The small view: a chat popped out over whatever place is up, docked like the draft (420x560, 20px from the right, flush to the window's foot), its tiles over its reply box. Its head is the main chat's head (chat-window.tsx renders the same ChatHeader) with nothing at its left: the title and caret centered over the step while `working` names one, then minimize, expand and ×. `peek` is the index of the tile peeked at, drawn in a card over the conversation. */
const smallChat = ({
  title = PRICING_TITLE,
  tabs = [],
  peek = -1,
  body = pricing(2),
  working = "",
  right = 20,
  w = 420,
  h = 560,
  reply = {},
} = {}) => `
  <div class="absolute bottom-0 z-40 flex flex-col overflow-hidden rounded-t-2xl bg-background shadow-2xl ring-1 ring-black/5" style="right:${right}px;width:${w}px;height:${h}px">
    <div class="grid h-14 shrink-0 grid-cols-[96px_minmax(0,1fr)_96px] items-start gap-x-2 bg-background px-3 pt-2">
      <div></div>
      <div class="flex min-w-0 flex-col items-center">
        <span class="flex h-8 min-w-0 max-w-full items-center gap-1 text-sm font-medium"><span class="truncate">${title}</span><i class="ph ph-caret-down shrink-0 text-[12px] text-muted-foreground"></i></span>
        <div class="-mt-1 flex h-4 max-w-full min-w-0 justify-center">${working ? statusLine(working) : ""}</div>
      </div>
      <span class="flex h-8 items-center justify-end gap-0.5 text-muted-foreground">${["minus", "arrows-out-simple", "x"].map((i) => `<span class="grid size-8 place-items-center"><i class="ph ph-${i} text-[16px]"></i></span>`).join("")}</span>
    </div>
    <div class="relative flex min-h-0 flex-1 flex-col">
      <div class="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden px-3 pt-3 text-[13px]">${body}</div>
      <div class="shrink-0 p-2.5">${tabs.length ? chatTiles(tabs, peek) : ""}${replyBox(reply)}</div>
      ${peek >= 0 ? chatPeek(tabs[peek]) : ""}
    </div>
  </div>`;

/** The peek: a small view's tile open in a card over its conversation, from under the head to just over the tiles, its row ending in Expand and ×. */
const chatPeek = (t, { bottom = 180 } = {}) => `
  <div class="absolute inset-x-2 top-2 z-10 flex flex-col overflow-hidden rounded-xl bg-background shadow-xl ring-1 ring-gray-300" style="bottom:${bottom}px">
    ${locRow(t, { close: true, expand: true })}
    <div class="relative min-h-0 flex-1 overflow-hidden">${page(t)}</div>
  </div>`;

/**
 * The browser a draft sets up for the agent (measured 2026-10-16): a stone tray with
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


/** A minimized chat: a 300px dark bar on the bottom edge. */
const miniBar = ({
  title = PRICING_TITLE,
  working = false,
  right = 12,
} = {}) => `
  <div class="absolute bottom-0 z-40 flex h-10 w-[300px] items-center gap-2 rounded-t-xl bg-gray-900 px-3 text-[12px] text-white" style="right:${right}px">
    ${working ? pulse : `<i class="ph ph-chats-circle"></i>`}<span class="min-w-0 flex-1 truncate">${title}</span><i class="ph ph-caret-up"></i><i class="ph ph-x"></i>
  </div>`;
