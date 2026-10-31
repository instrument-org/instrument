// ---- window --------------------------------------------------------------------

// The ground a step lighter than gray-200, and the card (`--pane`) a hair below the
// background, so a row in the card's own white stands out from the list (globals.css).
const GROUND = "bg-[light-dark(#f2f1f0,#161312)]";
const PANE = "[--color-background:light-dark(#f7f7f6,#141210)]";
const trafficLights = `<div class="flex w-20 shrink-0 items-center gap-2 pl-3"><span class="size-3 rounded-full bg-[#ff5f57]"></span><span class="size-3 rounded-full bg-[#febc2e]"></span><span class="size-3 rounded-full bg-[#28c840]"></span></div>`;

/** A window tab in the bar. `t` is a tab ({site} | {file} | {folder} | {newtab}) or {chats: true, title}. */
const barTab = (t, { on = false } = {}) => `
  <div class="relative flex h-8 max-w-60 min-w-20 shrink-0 items-center gap-2 rounded-xl px-2.5 text-sm font-medium ${on ? "bg-background shadow-xs" : "text-foreground/55"}">
    ${t.chats ? `<i class="ph ph-chat-circle text-[14px]"></i>` : tabMark(t)}
    <span class="min-w-0 flex-1 truncate">${t.chats ? t.title || "Chats" : tabTitle(t)}</span>${t.agent ? pulse : ""}
    ${on ? `<i class="ph ph-x text-[12px]"></i>` : ""}
  </div>`;

/** The 40px window bar on the ground: back and forward, the window's tabs, then the right corner. */
const winBar = ({ tabs = [{ chats: true }], active = 0, right = "" } = {}) => `
  <div class="flex h-10 shrink-0 items-center gap-1.5 pr-2">
    ${trafficLights}
    <i class="ph ph-arrow-left px-1.5 text-[16px] text-foreground/80"></i><i class="ph ph-arrow-right px-1.5 text-[16px] text-foreground/40"></i>
    <div class="flex min-w-0 flex-1 items-center gap-1 px-2">
      ${tabs.map((t, i) => barTab(t, { on: i === active })).join(`<span class="h-4 w-px shrink-0 bg-gray-300"></span>`)}
      <span class="grid size-8 shrink-0 place-items-center rounded-xl text-muted-foreground/70"><i class="ph ph-plus text-[16px]"></i></span>
    </div>
    <div class="flex shrink-0 items-center gap-2">${right}<span class="grid size-7 place-items-center text-muted-foreground/70"><i class="ph ph-bell text-[16px]"></i></span></div>
  </div>`;

// The starter loads Phosphor's regular weight only, so a lit place keeps its outline
// icon and takes the brand color, where the app also swaps to the fill weight.
const RAIL = [
  ["chat", "Chat", `<i class="ph ph-chat-circle text-[24px]"></i>`],
  ["files", "Files", `<i class="ph ph-folder-simple text-[24px]"></i>`],
  ["browser", "Browser", `<i class="ph ph-globe text-[24px]"></i>`],
  ["apps", "Apps", `<i class="ph ph-shapes text-[24px]"></i>`],
];

/** The 76px app rail on the ground. `on` is chat | files | browser | apps | "" (nothing lit). `user` draws the signed-in avatar in place of Settings. */
const rail = (on = "chat", { mark = {}, user = false } = {}) => `
  <nav class="flex w-[76px] shrink-0 flex-col items-center gap-3 pt-1 pb-2">
    <div class="flex w-15 flex-col items-center gap-0.5 py-1.5">
      <span class="grid size-11 place-items-center rounded-full bg-brand-600 text-white shadow-xs"><i class="ph ph-note-pencil text-[20px]"></i></span>
      <span class="text-[11px] leading-4 font-medium">New</span>
      ${mark.new || ""}
    </div>
    <div class="flex w-full flex-col items-center gap-1">
      ${RAIL.map(
        ([key, word, icon]) => `
        <div class="flex w-15 flex-col items-center gap-0.5 rounded-xl py-1.5 ${on === key ? "bg-foreground/8 text-brand-600" : "text-muted-foreground"}">
          <span class="flex h-6 items-center">${icon}</span>
          <span class="text-[11px] leading-4 ${on === key ? "font-medium" : ""}">${word}</span>
          ${mark[key] || ""}
        </div>`,
      ).join("")}
    </div>
    <div class="flex-1"></div>
    ${
      user
        ? `<div class="grid w-15 place-items-center rounded-xl p-2"><span class="grid size-11 place-items-center rounded-xl bg-[#c5d5d0] text-[15px] font-semibold text-brand-800">J</span></div>`
        : `<div class="flex w-15 flex-col items-center gap-0.5 py-1.5 text-muted-foreground"><span class="flex h-6 items-center"><i class="ph ph-faders-horizontal text-[24px]"></i></span><span class="text-[11px] leading-4">Settings</span></div>`
    }
  </nav>`;

/** The whole window. `over` is drawn on a layer over everything (floating chats, menus, sheets). */
const appWindow = ({
  bar = winBar(),
  on = "chat",
  body = inboxCol({ on: -1 }) + noChatOpen(),
  over = "",
  railMark = {},
  user = false,
  dark = false,
} = {}) => `
  <div class="relative flex h-full flex-col overflow-hidden ${GROUND} text-foreground ${dark ? "[color-scheme:dark]" : "[color-scheme:light]"}">
    ${bar}
    <div class="flex min-h-0 flex-1">
      ${rail(on, { mark: railMark, user })}
      <div class="relative mr-2 mb-2 flex min-w-0 flex-1 overflow-hidden rounded-[10px] ${PANE} bg-background shadow-xs">${body}</div>
    </div>
    ${over}
  </div>`;
